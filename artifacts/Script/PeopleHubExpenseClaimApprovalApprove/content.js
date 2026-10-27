// PeopleHubExpenseClaimApprovalApprove
// Process flow PeopleHubExpenseClaimApproval - approve branch (Run Script).
// Same as PeopleHubExpenseClaimApprovalReject except DECISION. Records the approver's decision on the claim
// and outputs the texts and colours for the decision email to the requester.
// Output: { claimid, title, decision, decisionText, decidedBy, statusColor, statusBg, statusNote, requesterEmail }

const DECISION = "approve";
const PREPARE_STEP = "Activity_prepare";
const TASK_STEP = "Activity_approval";

const pfData = p9.processFlow.getData() || {};
const outputs = pfData.outputs || {};
const prep = outputs[PREPARE_STEP] || {};
const task = outputs[TASK_STEP] || {};

// Who decided: the user task output, else the user running this step (the approver)
const reqUser = typeof req !== "undefined" && req && req.user ? req.user.username || req.user.name || null : null;
const decidedBy = task.completedBy || task.user || task.userName || task.approver || task.username || reqUser || null;

const claim = prep.claimid ? await entities.peoplehubexpenseclaim.findOne({ where: { claimid: prep.claimid } }) : null;
if (!claim) throw new Error(`Claim ${prep.claimid} not found`);

const approved = DECISION === "approve";
claim.status = approved ? "Approved" : "Rejected";
claim.approver = decidedBy;
claim.decidedat = new Date();
claim.rejectionreason = approved ? null : "Rejected by the approver in My Approvals. Check the receipts flagged by the AI validation, fix the claim and send it again.";
await entities.peoplehubexpenseclaim.save(claim);

log.info(`Expense claim ${claim.claimid} "${claim.title}" ${claim.status} by ${decidedBy || "-"}`);

result.data = {
    claimid: claim.claimid,
    title: claim.title,
    decision: DECISION,
    decisionText: approved ? "Approved" : "Rejected",
    decidedBy: decidedBy || "the approver",
    statusColor: approved ? "#107e3e" : "#bb0000",
    statusBg: approved ? "#e8f5ec" : "#fdeeee",
    statusNote: approved
        ? "Your expense claim is approved and will be reimbursed with the next payroll."
        : "Your expense claim was rejected. Open it in PeopleHub, fix the receipts or lines and send it for approval again.",
    requesterEmail: prep.requesterEmail || null,
};
