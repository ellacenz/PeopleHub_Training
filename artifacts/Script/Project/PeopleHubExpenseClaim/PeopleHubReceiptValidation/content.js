// PeopleHubReceiptValidation
// POST { lineid } -> validates the receipt attached to one expense line.
//   1. The AI agent reads the receipt (PDF or image) and compares it with the claimed line.
//   2. Code checks compare what the AI read with the line: amount, currency, date, merchant, category.
//   3. The result is saved ON THE RECEIPT (validationstatus, validationresult, validatedat),
//      so replacing or deleting the receipt also replaces or deletes its validation (1 line = 1 receipt).
// Who may validate: the owner of the claim, or a user with the Cockpit role PeopleHubApproverClaim.

const ROLE_APPROVER = "PeopleHubApproverClaim";
const MAX_AGE_DAYS = 90;
const AMOUNT_TOLERANCE = 0.05;

const Claims = entities.peoplehubexpenseclaim;
const Lines = entities.peoplehubexpenseline;
const Receipts = entities.peoplehubexpensereceipt;

// ---------- Helpers ----------
const toKey = (v) => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(String(v).length === 10 ? v + "T00:00:00Z" : v);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

// "42.50", "42,50", "1.234,50", "1,234.50", 42.5 -> number
const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    let s = String(v).replace(/[^0-9.,\-]/g, "");
    const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
    if (lastDot >= 0 && lastComma >= 0) s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    else if (lastComma >= 0) s = s.replace(",", ".");
    const n = Number(s);
    return s && Number.isFinite(n) ? n : null;
};

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// The merchant matches if one name contains the other, or they share a significant word
function merchantMatches(claimed, read) {
    const a = norm(claimed), b = norm(read);
    if (!a || !b) return false;
    if (a.includes(b) || b.includes(a)) return true;
    const words = (s) => s.split(" ").filter((w) => w.length > 3);
    return words(a).some((w) => words(b).includes(w));
}

// The agent answers JSON as text (sometimes inside ```json fences)
function readAgentOutput(response) {
    const out = response && response.output !== undefined ? response.output : response;
    if (out && typeof out.structuredOutput === "object" && out.structuredOutput) return out.structuredOutput;
    const text = String((out && out.text) || (response && response.text) || (typeof out === "string" ? out : ""));
    const cleaned = text.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
        try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (e) { /* not JSON */ }
    }
    return null;
}

async function isApprover(userId) {
    const assigned = await p9.user.getRolesAndGroups(userId);
    const role = await p9.manager.findOne("role", { where: { name: ROLE_APPROVER } });
    if (!role) return false;
    const roleId = String(role.id).toUpperCase();
    return (assigned.roles || []).some((r) => String(r.id).toUpperCase() === roleId);
}

// ---------- Code checks: the AI reads, the code decides ----------
function runChecks(ai, line, claim) {
    const x = (ai && ai.extraction) || {};
    const checks = [];
    const add = (id, label, status, expected, actual, message) => checks.push({ id, label, status, expected, actual, message });

    if (!ai || ai.success === false) {
        add("readable", "Receipt readable", "fail", "A readable receipt", "-", "The AI could not read the document or it is not a receipt.");
        return checks;
    }

    // Amount (in the line's original currency)
    const total = num(x.total);
    const claimedAmount = Number(line.amount);
    if (total === null) add("amount", "Amount", "fail", claimedAmount.toFixed(2), "-", "No total found on the receipt.");
    else if (Math.abs(total - claimedAmount) <= AMOUNT_TOLERANCE) add("amount", "Amount", "pass", claimedAmount.toFixed(2), total.toFixed(2), "The receipt total matches the claimed amount.");
    else add("amount", "Amount", "fail", claimedAmount.toFixed(2), total.toFixed(2), "The receipt total differs from the claimed amount.");

    // Currency
    const cur = String(x.currency || "").toUpperCase();
    if (!cur) add("currency", "Currency", "warning", line.currency, "-", "No currency found on the receipt.");
    else if (cur === String(line.currency).toUpperCase()) add("currency", "Currency", "pass", line.currency, cur, "Same currency.");
    else add("currency", "Currency", "fail", line.currency, cur, "The receipt currency differs from the claimed currency.");

    // Date: same day = pass; inside the claim period = warning; outside, future or too old = fail
    const rDate = toKey(x.date), lDate = toKey(line.expensedate);
    const from = toKey(claim.datefrom), to = toKey(claim.dateto), today = toKey(new Date());
    const oldest = toKey(new Date(new Date(claim.datefrom).getTime() - MAX_AGE_DAYS * 86400000)); // counted from the claim's Date from
    if (!rDate) add("date", "Date", "warning", lDate, "-", "No date found on the receipt.");
    else if (rDate === lDate) add("date", "Date", "pass", lDate, rDate, "Same date as the expense line.");
    else if (rDate > today) add("date", "Date", "fail", lDate, rDate, "The receipt date is in the future.");
    else if (rDate < oldest) add("date", "Date", "fail", lDate, rDate, `The receipt is more than ${MAX_AGE_DAYS} days older than the claim period.`);
    else if (rDate < from || rDate > to) add("date", "Date", "fail", lDate, rDate, "The receipt date is outside the claim period.");
    else add("date", "Date", "warning", lDate, rDate, "The receipt date is inside the claim period but differs from the expense date.");

    // Merchant
    if (merchantMatches(line.merchant, x.vendor)) add("merchant", "Merchant", "pass", line.merchant, x.vendor, "The vendor matches the claimed merchant.");
    else add("merchant", "Merchant", "warning", line.merchant || "-", x.vendor || "-", "The vendor on the receipt does not match the claimed merchant.");

    // Category
    const cat = String(x.suggestedCategory || "");
    if (!cat) add("category", "Category", "warning", line.category, "-", "The AI could not suggest a category.");
    else if (cat.toLowerCase() === String(line.category).toLowerCase()) add("category", "Category", "pass", line.category, cat, "The receipt fits the claimed category.");
    else add("category", "Category", "warning", line.category, cat, "The receipt looks like a different category.");

    return checks;
}

function overallStatus(checks, redFlags) {
    if (checks.some((c) => c.status === "fail")) return "fail";
    if (checks.some((c) => c.status === "warning") || redFlags.length) return "warning";
    return "pass";
}

// ---------- Main ----------
async function main() {
    const user = req.user || {};
    if (!user.id) return { status: 401, data: { error: "Not logged in" } };

    const input = req.body && Object.keys(req.body).length ? req.body : req.query || {};
    if (!input.lineid) return { status: 400, data: { error: "lineid is required" } };

    const line = await Lines.findOne({ where: { lineid: input.lineid } });
    if (!line) return { status: 404, data: { error: "Expense line not found" } };
    const claim = await Claims.findOne({ where: { claimid: line.claimid } });
    if (!claim) return { status: 404, data: { error: "Claim not found" } };
    if (claim.createdByPerson !== user.username && !(await isApprover(user.id))) {
        return { status: 403, data: { error: "You cannot validate receipts of this claim" } };
    }

    const receipt = line.receiptid ? await Receipts.findOne({ where: { receiptid: line.receiptid } }) : null;
    if (!receipt || !receipt.content) return { status: 404, data: { error: "This line has no receipt" } };

    // Data URI -> file for the agent
    const comma = receipt.content.indexOf(",");
    const mimetype = receipt.mimetype || receipt.content.substring(5, receipt.content.indexOf(";"));
    const files = [{ mimetype, data: Buffer.from(receipt.content.substring(comma + 1), "base64") }];
    const agent = mimetype === "application/pdf" ? agents.PeopleHubInvoiceExtractionPDF : agents.PeopleHubInvoiceExtractionImage;

    const prompt = [
        "Validate the attached receipt against this CLAIMED EXPENSE LINE.",
        `- category: ${line.category}`,
        `- merchant: ${line.merchant || "-"}`,
        `- amount: ${Number(line.amount).toFixed(2)} ${line.currency}`,
        `- expense date: ${toKey(line.expensedate)}`,
        `- description: ${line.description || "-"}`,
        `- claim period: ${toKey(claim.datefrom)} to ${toKey(claim.dateto)}`,
        `- reference date (today): ${toKey(new Date())}`,
        "Answer with the JSON object only.",
    ].join("\n");

    const response = await agent({ input: prompt, files });
    const ai = readAgentOutput(response);
    // When the answer cannot be read, keep a short preview of it to see what the agent returned
    let rawPreview = null;
    if (!ai) {
        try { rawPreview = JSON.stringify(response).slice(0, 1500); } catch (e) { rawPreview = String(response).slice(0, 1500); }
    }

    const checks = runChecks(ai, line, claim);
    const redFlags = (ai && ai.extraction && Array.isArray(ai.extraction.redFlags)) ? ai.extraction.redFlags : [];
    const status = overallStatus(checks, redFlags);
    const failed = checks.filter((c) => c.status === "fail").length;
    const warnings = checks.filter((c) => c.status === "warning").length + redFlags.length;
    const summary = status === "pass"
        ? "The receipt matches the expense line."
        : `${failed} failed check(s), ${warnings} warning(s).`;

    const result = {
        status,
        summary,
        checks,
        redFlags,
        similarity: ai ? ai.similarity : null,
        confidence: ai ? ai.confidence : null,
        qualityScore: ai ? ai.qualityScore : null,
        extraction: ai ? ai.extraction : null,
        validatedAt: new Date().toISOString(),
        validatedBy: user.username,
        rawPreview,
    };

    receipt.validationstatus = status;
    receipt.validationresult = JSON.stringify(result);
    receipt.validatedat = new Date();
    await Receipts.save(receipt);

    return { status: 200, data: Object.assign({ lineid: line.lineid, receiptid: receipt.receiptid }, result) };
}

main()
    .then(({ status, data }) => {
        result.statusCode = status;
        result.data = data;
        complete();
    })
    .catch((e) => {
        log.error(e);
        result.statusCode = 500;
        result.data = { error: e.message || String(e) };
        complete();
    });
