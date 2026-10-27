// PeopleHubLeaveRequestSend
// POST { id }: the employee sends their own DRAFT leave request for approval.
// - Only users with the Cockpit role PeopleHubEmployeeTrainingME, only their own request (createdBy).
// - Only a DRAFT can be sent, and only once: the status becomes PENDING (409 otherwise).
// - Every user with the Cockpit role PeopleHubManagerTrainingME (unlocked, with an email address)
//   gets the email template PeopleHubLeaveRequestApproval. The managers decide in the
//   Approve Leave Request app (no process flow).
// - If the email fails, the request stays PENDING and the answer says so (emailSent = false).

const dayjs = modules.dayjs;

const ROLE_EMPLOYEE = "PeopleHubEmployeeTrainingME";
const ROLE_MANAGER = "PeopleHubManagerTrainingME";
const TEMPLATE = "PeopleHubLeaveRequestApproval";

const Requests = entities.peoplehubleaverequest;

async function hasRole(userId, roleName) {
    const assigned = await p9.user.getRolesAndGroups(userId);
    const ids = (assigned.roles || []).map((r) => String(r.id).toUpperCase());
    const role = await p9.manager.findOne("role", { where: { name: roleName } });
    return !!role && ids.includes(String(role.id).toUpperCase());
}

// The managers: users of the manager role, unlocked and with an email address
async function managerEmails() {
    const role = await p9.manager.findOne("role", { where: { name: ROLE_MANAGER }, relations: ["users"] });
    const users = (role && role.users) || [];
    return [...new Set(users.filter((u) => !u.locked && u.email).map((u) => u.email.trim()))];
}

const periodText = (r) => {
    const a = dayjs(r.START_DATE).format("D MMM YYYY");
    const b = dayjs(r.END_DATE).format("D MMM YYYY");
    return a === b ? a : `${a} - ${b}`;
};

function fail(status, error) {
    return { status, data: { ok: false, error } };
}

async function main() {
    const user = req.user || {};
    if (!user.id) return fail(401, "Not logged in");
    const username = String(user.username).toLowerCase();
    if (!(await hasRole(user.id, ROLE_EMPLOYEE))) return fail(403, `You need the role ${ROLE_EMPLOYEE} to send a leave request.`);

    const id = String((req.body && req.body.id) || "").trim();
    if (!id) return fail(400, "The leave request id is missing.");
    const request = await Requests.findOne({ where: { id } });
    if (!request) return fail(404, "The leave request was not found.");
    if (String(request.createdBy || "").toLowerCase() !== username) return fail(403, "You can only send your own leave requests.");
    if (request.STATUS !== "DRAFT") return fail(409, `This request is ${String(request.STATUS).toLowerCase()} and cannot be sent again.`);

    // 1. Status: DRAFT -> PENDING
    request.STATUS = "PENDING";
    request.updatedBy = username;
    await Requests.save(request);

    // 2. Email every manager with the template (the request stays PENDING even if the email fails)
    const to = await managerEmails();
    const requester = await p9.manager.findOne("users", { where: { username } });
    const tokens = {
        requesterName: (requester && requester.name) || username,
        employeeName: request.EMPLOYEE_NAME,
        pernr: request.PERNR,
        typeText: request.TYPE_TEXT,
        periodText: periodText(request),
        workingDays: String(Number(request.WORKING_DAYS)),
        comment: request.COMMENT || "-",
    };
    let emailSent = false;
    let emailMessage = "";
    if (to.length === 0) {
        emailMessage = `No user has the role ${ROLE_MANAGER} with an email address, so no email was sent.`;
    } else {
        try {
            const template = await p9.manager.findOne("wf_notifications", { where: { name: TEMPLATE } });
            if (!template) throw new Error(`email template ${TEMPLATE} not found`);
            await sendEmail({
                to: to.join(","),
                subject: `Leave request from ${tokens.requesterName}: ${tokens.periodText}`,
                templateId: template.id,
                primitives: tokens,
            });
            emailSent = true;
            emailMessage = `Email sent to ${to.length} manager(s).`;
        } catch (e) {
            emailMessage = `The request is pending, but the email could not be sent: ${e.message || e}`;
        }
    }
    if (!emailSent) log.warn(`PeopleHubLeaveRequestSend ${id}: ${emailMessage}`);
    log.info(`Leave request ${id} sent for approval by ${username}. ${emailMessage}`);
    return { status: 200, data: { ok: true, id, STATUS: "PENDING", emailSent, emailMessage, managers: to.length } };
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
