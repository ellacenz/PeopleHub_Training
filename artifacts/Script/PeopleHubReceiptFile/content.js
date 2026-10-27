// PeopleHubReceiptFile
// GET ?receiptid=XXX -> the receipt file as binary with its own Content-Type, shown inline.
// Use the URL directly as the source of sap.m.PDFViewer (PDF) or sap.m.Image (JPG/PNG):
//   /api/serverscript/PeopleHubReceiptFileApi/?receiptid=XXX
// (A blob: URL does not work in sap.m.PDFViewer; a real URL with the right Content-Type does.)
// Who may open it: the owner of the claim, or a user with the Cockpit role PeopleHubApproverClaim.

const ROLE_APPROVER = "PeopleHubApproverClaim";

async function isApprover(userId) {
    const assigned = await p9.user.getRolesAndGroups(userId);
    const role = await p9.manager.findOne("role", { where: { name: ROLE_APPROVER } });
    if (!role) return false;
    const roleId = String(role.id).toUpperCase();
    return (assigned.roles || []).some((r) => String(r.id).toUpperCase() === roleId);
}

function fail(status, error) {
    result.statusCode = status;
    result.data = { error };
    complete();
}

async function main() {
    const user = req.user || {};
    if (!user.id) return fail(401, "Not logged in");

    const receiptid = req.query && req.query.receiptid;
    if (!receiptid) return fail(400, "receiptid is required");

    const receipt = await entities.peoplehubexpensereceipt.findOne({ where: { receiptid } });
    if (!receipt || !receipt.content) return fail(404, "Receipt not found");

    const line = await entities.peoplehubexpenseline.findOne({ where: { lineid: receipt.lineid } });
    const claim = line ? await entities.peoplehubexpenseclaim.findOne({ where: { claimid: line.claimid } }) : null;
    if (!claim) return fail(404, "Claim not found");
    if (claim.createdByPerson !== user.username && !(await isApprover(user.id))) return fail(403, "You cannot open this receipt");

    // The table keeps the file as a data URI: "data:<mimetype>;base64,<data>"
    const comma = receipt.content.indexOf(",");
    const safeName = String(receipt.filename || "receipt").replace(/["\\\r\n]/g, "_");

    result.contentType = receipt.mimetype || "application/octet-stream";
    result.headers = {
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
    };
    result.data = Buffer.from(receipt.content.substring(comma + 1), "base64");
    complete();
}

main().catch((e) => {
    log.error(e);
    fail(500, e.message || String(e));
});
