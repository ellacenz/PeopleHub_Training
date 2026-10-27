// PeopleHubLeaveRequestUser
// Who is the current user in the leave request apps?
// The apps call this once at start-up and store the answer in their View model.
// - username:   the logged-in Neptune user (read on the server, never sent by the app)
// - PERNR:      the SAP employee this user is linked to in peoplehubusermap (set up before the training)
// - employee:   name, org unit and position from SAP; manager: the SAP manager (PERNR + name)
// - isEmployee / isManager: Cockpit roles PeopleHubEmployeeTrainingME / PeopleHubManagerTrainingME
//   (assigned by hand in the Cockpit; one user can hold both)
// SAP is only read. A user without a mapping gets mapped = false, so the app can show a message.

const SAP_CLIENT = "100";
const ROLE_EMPLOYEE = "PeopleHubEmployeeTrainingME";
const ROLE_MANAGER = "PeopleHubManagerTrainingME";

const UserMap = entities.peoplehubusermap;

const pad8 = (v) => String(v || "").trim().replace(/^0+/, "").padStart(8, "0");

async function sapEmployee(pernr) {
    try {
        const res = await apis.getEmployees({ parameters: { "sap-client": SAP_CLIENT, IV_PERNR: pernr } });
        const rows = (res.data && res.data.result && res.data.result.GT_EMPLOYEES) || [];
        return rows[0] || null;
    } catch (e) {
        return null; // 404 when the personnel number does not exist
    }
}

async function hasRole(userRoleIds, roleName) {
    const role = await p9.manager.findOne("role", { where: { name: roleName } });
    return !!role && userRoleIds.includes(String(role.id).toUpperCase());
}

async function main() {
    const user = req.user || {};
    if (!user.id) return { status: 401, data: { error: "Not logged in" } };

    const assigned = await p9.user.getRolesAndGroups(user.id);
    const userRoleIds = (assigned.roles || []).map((r) => String(r.id).toUpperCase());

    const data = {
        username: user.username,
        isEmployee: await hasRole(userRoleIds, ROLE_EMPLOYEE),
        isManager: await hasRole(userRoleIds, ROLE_MANAGER),
        mapped: false,
        PERNR: "",
        EMPLOYEE_NAME: "",
        ORG_TEXT: "",
        POS_TEXT: "",
        MANAGER_PERNR: "",
        MANAGER_NAME: "",
        message: "",
    };

    const rows = await UserMap.find({ where: { USER_NAME: String(user.username).toLowerCase() } });
    if (rows.length === 0) {
        data.message = "Your user is not linked to a SAP employee yet. Ask the trainer to add you to the mapping.";
        return { status: 200, data };
    }

    data.PERNR = pad8(rows[0].PERNR);
    const emp = await sapEmployee(data.PERNR);
    if (!emp) {
        data.message = `Personnel number ${data.PERNR} was not found in SAP. Ask the trainer to check the mapping.`;
        return { status: 200, data };
    }

    data.mapped = true;
    data.EMPLOYEE_NAME = `${emp.FIRST_NAME} ${emp.LAST_NAME}`.trim();
    data.ORG_TEXT = emp.ORG_TEXT || "";
    data.POS_TEXT = emp.POS_TEXT || "";
    if (emp.MANAGER) {
        data.MANAGER_PERNR = pad8(emp.MANAGER);
        const mgr = await sapEmployee(data.MANAGER_PERNR);
        data.MANAGER_NAME = mgr ? `${mgr.FIRST_NAME} ${mgr.LAST_NAME}`.trim() : "";
    }
    return { status: 200, data };
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
