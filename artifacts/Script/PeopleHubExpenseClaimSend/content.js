// PeopleHubExpenseClaimSend
// POST { claimid } -> "Send for approval" button of the claims app.
//   1. Checks the claim: status Draft or Rejected, at least one line, and a receipt on every line
//      whose policy requires one (EUR amount above the category's receipt threshold).
//   2. Sets the claim to Submitted. From now on the app locks it, so the button works only ONCE:
//      a second click (or a second user) gets "already sent" from this check.
//   3. Starts the process flow PeopleHubExpenseClaimApproval with { claimid, requesterEmail, requesterName }.
//      The flow is found by its name, so no ids are copied into the code.
// Who may send: the owner of the claim, or a user with the Cockpit role PeopleHubApproverClaim.

const ROLE_APPROVER = "PeopleHubApproverClaim";
const FLOW_NAME = "PeopleHubExpenseClaimApproval";
const EDITABLE = ["Draft", "Rejected"];

const Claims = entities.peoplehubexpenseclaim;
const Lines = entities.peoplehubexpenseline;
const Policies = entities.peoplehubexpensepolicy;

async function isApprover(userId) {
    const assigned = await p9.user.getRolesAndGroups(userId);
    const role = await p9.manager.findOne("role", { where: { name: ROLE_APPROVER } });
    if (!role) return false;
    const roleId = String(role.id).toUpperCase();
    return (assigned.roles || []).some((r) => String(r.id).toUpperCase() === roleId);
}

async function main() {
    const user = req.user || {};
    if (!user.id) return { status: 401, data: { error: "Not logged in" } };

    const input = req.body && Object.keys(req.body).length ? req.body : req.query || {};
    const claimid = String(input.claimid || "").trim();
    if (!claimid) return { status: 400, data: { error: "claimid is required" } };

    const claim = await Claims.findOne({ where: { claimid } });
    if (!claim) return { status: 404, data: { error: "Claim not found" } };
    if (claim.createdByPerson !== user.username && !(await isApprover(user.id))) {
        return { status: 403, data: { error: "You cannot send this claim for approval" } };
    }
    if (!EDITABLE.includes(claim.status)) {
        return { status: 409, data: { error: `The claim is already ${claim.status}. It can only be sent once.`, status: claim.status } };
    }

    const lines = await Lines.find({ where: { claimid } });
    if (!lines.length) return { status: 400, data: { error: "Add at least one expense line before you send the claim." } };

    // A receipt is required when the EUR amount is above the category's receipt threshold
    const policyByCategory = {};
    (await Policies.find()).forEach((p) => (policyByCategory[p.category] = p));
    const missing = lines.filter((l) => {
        const p = policyByCategory[l.category];
        const needs = p && p.receiptthreshold !== null && p.receiptthreshold !== undefined && Number(l.amounteur || 0) > Number(p.receiptthreshold);
        return needs && !l.receiptid;
    });
    if (missing.length) {
        return { status: 400, data: { error: `Upload the receipt for: ${missing.map((l) => `${l.category} ${l.merchant || ""}`.trim()).join(", ")}` } };
    }

    const flow = await p9.manager.findOne("workflow", { where: { name: FLOW_NAME } });
    if (!flow) return { status: 500, data: { error: `Process flow ${FLOW_NAME} not found` } };

    // The requester is the owner of the claim (an approver may send it for them)
    let requesterName = claim.createdByPerson, requesterEmail = null;
    try {
        const owner = await p9.manager.findOne("users", { where: { username: claim.createdByPerson } });
        if (owner) {
            requesterName = owner.name || requesterName;
            requesterEmail = owner.email || null;
        }
    } catch (e) {
        log.warn(`Send: requester details failed: ${e.message}`);
    }

    // Lock the claim first, so the button works only once
    const previousStatus = claim.status;
    const total = Math.round(lines.reduce((s, l) => s + Number(l.amounteur || 0), 0) * 100) / 100;
    claim.status = "Submitted";
    claim.submittedat = new Date();
    claim.totaleur = total;
    claim.approver = null;
    claim.decidedat = null;
    claim.rejectionreason = null;
    await Claims.save(claim);

    let run;
    try {
        run = await p9.processFlow.run(flow.id, { interfaceData: { claimid, requesterEmail, requesterName } });
    } catch (e) {
        // The flow did not start: give the claim back to the user
        claim.status = previousStatus;
        claim.submittedat = null;
        await Claims.save(claim);
        throw e;
    }

    log.info(`Expense claim ${claimid} "${claim.title}" sent for approval by ${user.username}, execution ${run && run.executionId}`);
    return { status: 200, data: { ok: true, claimid, status: "Submitted", submittedat: claim.submittedat, totaleur: total, executionId: run && run.executionId } };
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
