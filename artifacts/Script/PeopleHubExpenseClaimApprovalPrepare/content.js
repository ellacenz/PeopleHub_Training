// PeopleHubExpenseClaimApprovalPrepare
// Process flow PeopleHubExpenseClaimApproval, step 1 (Run Script "Prepare approval").
// interfaceData: { claimid, requesterEmail, requesterName } (sent by script PeopleHubExpenseClaimSend,
// which already checked the claim and set it to Submitted).
// It summarises the claim and the AI validation of its receipts for the approver, and finds the approvers' emails.
// Output (used by the email nodes, the user task and its embedded app):
//   { claimid, title, purpose, periodText, requesterName, requesterEmail, approverEmails, totalText, currency,
//     lineCount, receiptCount, passCount, warningCount, failCount, notValidatedCount, checksText,
//     recommendation, recommendationText, recommendationColor, recommendationBg, summary }

const ROLE_APPROVER = "PeopleHubApproverClaim"; // the approvers: users with this Cockpit role

const Claims = entities.peoplehubexpenseclaim;
const Lines = entities.peoplehubexpenseline;
const Receipts = entities.peoplehubexpensereceipt;

const fmtDate = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "-");
const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const { globals } = p9.processFlow.getData() || {};
const claimid = String((globals && globals.claimid) || "").trim();
if (!claimid) throw new Error("claimid is required in interfaceData");

const claim = await Claims.findOne({ where: { claimid } });
if (!claim) throw new Error(`Claim ${claimid} not found`);

const lines = await Lines.find({ where: { claimid } });

// AI validation summary of the receipts (without the file content)
const receipts = [];
for (const l of lines.filter((x) => x.receiptid)) {
    const r = await Receipts.findOne({ select: ["receiptid", "validationstatus"], where: { receiptid: l.receiptid } });
    if (r) receipts.push(r);
}
const count = (s) => receipts.filter((r) => r.validationstatus === s).length;
const passCount = count("pass"), warningCount = count("warning"), failCount = count("fail");
const notValidatedCount = receipts.length - passCount - warningCount - failCount;

const recommendation = failCount > 0 ? "reject" : (warningCount > 0 || notValidatedCount > 0) ? "review" : "approve";
const look = {
    approve: { text: "Approve", color: "#107e3e", bg: "#e8f5ec" },
    review: { text: "Review", color: "#a45d00", bg: "#fef3e6" },
    reject: { text: "Reject", color: "#bb0000", bg: "#fdeeee" },
}[recommendation];

const parts = [];
if (passCount) parts.push(`${passCount} passed`);
if (warningCount) parts.push(`${warningCount} with warnings`);
if (failCount) parts.push(`${failCount} failed`);
if (notValidatedCount) parts.push(`${notValidatedCount} not validated`);
const checksText = receipts.length ? `${receipts.length} receipt(s): ${parts.join(", ")}` : "no receipts";

// Approver emails: the users of the approver role, unlocked and with an email address
let approverEmails = "";
try {
    const role = await p9.manager.findOne("role", { where: { name: ROLE_APPROVER }, relations: ["users"] });
    approverEmails = [...new Set(((role && role.users) || []).filter((u) => !u.locked && u.email).map((u) => u.email.trim()))].join(",");
    if (!approverEmails) log.warn(`ApprovalPrepare: role ${ROLE_APPROVER} has no users with an email address`);
} catch (e) {
    log.warn(`ApprovalPrepare: approver emails could not be read: ${e.message}`);
}

const totalText = money(claim.totaleur);
const periodText = `${fmtDate(claim.datefrom)} to ${fmtDate(claim.dateto)}`;
const summary = `${claim.title} (${periodText}), ${lines.length} line(s), ${totalText} EUR. ${checksText}. AI recommendation: ${look.text}.`;

log.info(`Expense claim approval prepared: ${claimid} "${claim.title}", ${summary}, approvers ${approverEmails || "-"}`);

result.data = {
    claimid,
    title: claim.title,
    purpose: claim.purpose || "-",
    periodText,
    requesterName: (globals && globals.requesterName) || claim.createdByPerson,
    requesterEmail: (globals && globals.requesterEmail) || null,
    approverEmails,
    totalText,
    currency: "EUR",
    lineCount: lines.length,
    receiptCount: receipts.length,
    passCount,
    warningCount,
    failCount,
    notValidatedCount,
    checksText,
    recommendation,
    recommendationText: look.text,
    recommendationColor: look.color,
    recommendationBg: look.bg,
    summary,
};
