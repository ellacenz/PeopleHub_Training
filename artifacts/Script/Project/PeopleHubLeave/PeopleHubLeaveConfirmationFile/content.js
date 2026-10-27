// PeopleHubLeaveConfirmationFile
// GET ?id=XXX -> the leave confirmation PDF of an APPROVED request, from the PDF Archive, shown inline.
// Use the URL directly as the source of sap.m.PDFViewer, or open it in a new tab:
//   /api/serverscript/peoplehubleaveconfirmationfileapi/?id=XXX
// Who may open it: the employee who asked (createdBy), or a user with the role PeopleHubManagerTrainingME.
// The PDF is created by PeopleHubLeaveRequestDecide (template PeopleHubLeaveConfirmation, archive key = request id).

const ROLE_MANAGER = "PeopleHubManagerTrainingME";
const PDF_TEMPLATE = "PeopleHubLeaveConfirmation";

const Requests = entities.peoplehubleaverequest;

async function hasRole(userId, roleName) {
    const assigned = await p9.user.getRolesAndGroups(userId);
    const role = await p9.manager.findOne("role", { where: { name: roleName } });
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

    const id = String((req.query && req.query.id) || "").trim();
    if (!id) return fail(400, "id is required");

    const request = await Requests.findOne({ where: { id } });
    if (!request) return fail(404, "Leave request not found");
    const isOwner = String(request.createdBy || "").toLowerCase() === String(user.username).toLowerCase();
    if (!isOwner && !(await hasRole(user.id, ROLE_MANAGER))) return fail(403, "You cannot open this confirmation");
    if (request.STATUS !== "APPROVED") return fail(409, "There is a confirmation only for an approved request");

    const pdf = await p9.pdf.getPdf({ pdfName: PDF_TEMPLATE, objectKey: id, securityKey: id });
    if (!pdf || pdf.error || !pdf.content) return fail(404, "The confirmation PDF was not found in the PDF Archive");

    result.contentType = "application/pdf";
    result.headers = {
        "Content-Disposition": `inline; filename="Leave_confirmation_${request.START_DATE}.pdf"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
    };
    result.data = Buffer.from(pdf.content, "base64");
    complete();
}

main().catch((e) => {
    log.error(e);
    fail(500, e.message || String(e));
});
