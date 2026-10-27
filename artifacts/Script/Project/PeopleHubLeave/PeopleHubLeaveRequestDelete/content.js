// PeopleHubLeaveRequestDelete
// POST { id }: the employee deletes their own DRAFT leave request.
// - Only users with the Cockpit role PeopleHubEmployeeTrainingME, only their own request (createdBy).
// - Only a DRAFT can be deleted: once it is sent for approval it stays in the history (409 otherwise).

const ROLE_EMPLOYEE = "PeopleHubEmployeeTrainingME";

const Requests = entities.peoplehubleaverequest;

async function hasRole(userId, roleName) {
    const assigned = await p9.user.getRolesAndGroups(userId);
    const ids = (assigned.roles || []).map((r) => String(r.id).toUpperCase());
    const role = await p9.manager.findOne("role", { where: { name: roleName } });
    return !!role && ids.includes(String(role.id).toUpperCase());
}

function fail(status, error) {
    return { status, data: { ok: false, error } };
}

async function main() {
    const user = req.user || {};
    if (!user.id) return fail(401, "Not logged in");
    const username = String(user.username).toLowerCase();
    if (!(await hasRole(user.id, ROLE_EMPLOYEE))) return fail(403, `You need the role ${ROLE_EMPLOYEE} to delete a leave request.`);

    const id = String((req.body && req.body.id) || "").trim();
    if (!id) return fail(400, "The leave request id is missing.");
    const request = await Requests.findOne({ where: { id } });
    if (!request) return fail(404, "The leave request was not found.");
    if (String(request.createdBy || "").toLowerCase() !== username) return fail(403, "You can only delete your own leave requests.");
    if (request.STATUS !== "DRAFT") return fail(409, `Only a draft can be deleted; this request is ${String(request.STATUS).toLowerCase()}.`);

    await Requests.delete({ id });
    log.info(`Leave request ${id} (${request.START_DATE} - ${request.END_DATE}) deleted by ${username}`);
    return { status: 200, data: { ok: true, id, deleted: true } };
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
        result.data = { ok: false, error: e.message || String(e) };
        complete();
    });
