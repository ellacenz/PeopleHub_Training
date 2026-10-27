// PeopleHubTrainerParticipants
// GET: everything the trainer's mapping app needs, in one call. Only for the role PeopleHubTrainerTrainingME (403).
// - participants: the users with PeopleHubEmployeeTrainingME and/or PeopleHubManagerTrainingME, plus users already
//   in peoplehubusermap; each with their roles, their mapping and the SAP employee it points to.
// - employees: all SAP employees (getEmployees, sap-client 100, read only) for the pick list. RECOMMENDED marks
//   the reports of the manager 00000030 Bill West: the only hierarchy with leave data that works in the exercise.
//   VALID = Bill West or one of his reports (validEmployees: the only ones the trainer can pick); USED_COUNT = users
//   already mapped to it; suggestedPernr = the least used recommended employee.
// - ?search=<text>: also returns users (any Neptune user, max 20) whose user name, name or email contains the text,
//   so the trainer can map someone who doesn't have the roles yet.

const SAP_CLIENT = "100";
const ROLE_TRAINER = "PeopleHubTrainerTrainingME";
const ROLE_EMPLOYEE = "PeopleHubEmployeeTrainingME";
const ROLE_MANAGER = "PeopleHubManagerTrainingME";
const RECOMMENDED_MANAGER = "00000030";

const UserMap = entities.peoplehubusermap;

const pad8 = (v) => (v === null || v === undefined || v === "" ? "" : String(v).trim().replace(/^0+/, "").padStart(8, "0"));
const lower = (v) => String(v || "").trim().toLowerCase();

async function hasRole(userId, roleName) {
    const assigned = await p9.user.getRolesAndGroups(userId);
    const ids = (assigned.roles || []).map((r) => String(r.id).toUpperCase());
    const role = await p9.manager.findOne("role", { where: { name: roleName } });
    return !!role && ids.includes(String(role.id).toUpperCase());
}

async function roleUsers(roleName) {
    const role = await p9.manager.findOne("role", { where: { name: roleName }, relations: ["users"] });
    return (role && role.users) || [];
}

async function sapEmployees() {
    try {
        const res = await apis.getEmployees({ parameters: { "sap-client": SAP_CLIENT } });
        return (res.data && res.data.result && res.data.result.GT_EMPLOYEES) || [];
    } catch (e) {
        log.error("getEmployees failed: " + (e.message || e));
        return null;
    }
}

function fail(status, error) {
    return { status, data: { ok: false, error } };
}

async function main() {
    const me = req.user || {};
    if (!me.id) return fail(401, "Not logged in");
    if (!(await hasRole(me.id, ROLE_TRAINER))) return fail(403, `You need the role ${ROLE_TRAINER} to use the mapping app.`);

    // SAP employees for the pick list and the names in the list
    const sap = await sapEmployees();
    const byPernr = {};
    for (const e of sap || []) byPernr[pad8(e.PERNR)] = e;
    const fullName = (e) => (e ? `${e.FIRST_NAME || ""} ${e.LAST_NAME || ""}`.trim() : "");
    // How many users are mapped to each PERNR: the suggestion is the least used recommended employee
    const maps = await UserMap.find();
    const used = {};
    for (const m of maps) used[pad8(m.PERNR)] = (used[pad8(m.PERNR)] || 0) + 1;
    const employees = (sap || [])
        .map((e) => {
            const pernr = pad8(e.PERNR);
            const manager = pad8(e.MANAGER);
            const recommended = manager === RECOMMENDED_MANAGER;
            const valid = recommended || pernr === RECOMMENDED_MANAGER; // Bill West and his reports
            return {
                PERNR: pernr,
                NAME: fullName(e),
                ORG_TEXT: e.ORG_TEXT || "",
                POS_TEXT: e.POS_TEXT || "",
                MANAGER: manager,
                MANAGER_NAME: fullName(byPernr[manager]),
                IS_MANAGER: !!e.IS_MANAGER,
                RECOMMENDED: recommended,
                VALID: valid,
                USED_COUNT: used[pernr] || 0,
                TEXT: `${pernr} ${fullName(e)}${recommended ? " (recommended)" : valid ? " (manager)" : ""}${used[pernr] ? ` · ${used[pernr]} mapped` : ""}`,
            };
        })
        .sort((a, b) => (a.VALID === b.VALID ? a.PERNR.localeCompare(b.PERNR) : a.VALID ? -1 : 1));
    const validEmployees = employees.filter((e) => e.VALID);
    const suggested = employees
        .filter((e) => e.RECOMMENDED)
        .reduce((best, e) => (!best || e.USED_COUNT < best.USED_COUNT ? e : best), null);

    // Participants: users of the two leave roles + users already mapped
    const employeesRole = await roleUsers(ROLE_EMPLOYEE);
    const managersRole = await roleUsers(ROLE_MANAGER);
    const people = {};
    const add = (u) => {
        const key = lower(u.username);
        if (key && !people[key]) people[key] = { user: u };
        return people[key];
    };
    for (const u of employeesRole) add(u).isEmployee = true;
    for (const u of managersRole) add(u).isManager = true;
    for (const m of maps) {
        const key = lower(m.USER_NAME);
        if (!people[key]) {
            const u = await p9.manager.findOne("users", { where: { username: key } });
            people[key] = { user: u || { username: key } };
        }
        people[key].map = m;
    }

    const participants = Object.values(people)
        .map((p) => {
            const u = p.user || {};
            const pernr = p.map ? pad8(p.map.PERNR) : "";
            const emp = byPernr[pernr];
            const mapped = !!pernr;
            const bothRoles = !!p.isEmployee && !!p.isManager;
            let statusText = "Ready";
            let statusState = "Success";
            if (!mapped) { statusText = "Not mapped"; statusState = "Error"; }
            else if (sap && !emp) { statusText = "PERNR not in SAP"; statusState = "Error"; }
            else if (sap && pad8(emp.MANAGER) !== RECOMMENDED_MANAGER && pernr !== RECOMMENDED_MANAGER) { statusText = "Invalid employee"; statusState = "Error"; }
            else if (!bothRoles) {
                statusText = `Missing role: ${[p.isEmployee ? null : "Employee", p.isManager ? null : "Manager"].filter(Boolean).join(" + ")}`;
                statusState = "Warning";
            }
            return {
                USER_NAME: lower(u.username),
                NAME: u.name || "",
                EMAIL: u.email || "",
                LOCKED: !!u.locked,
                IS_EMPLOYEE: !!p.isEmployee,
                IS_MANAGER: !!p.isManager,
                HAS_BOTH_ROLES: bothRoles,
                ROLES_TEXT: [p.isEmployee ? "Employee" : null, p.isManager ? "Manager" : null].filter(Boolean).join(", ") || "None",
                MAP_ID: p.map ? p.map.id : null,
                PERNR: pernr,
                MAPPED: mapped,
                SAP_NAME: fullName(emp),
                SAP_ORG: emp ? emp.ORG_TEXT || "" : "",
                SAP_MANAGER: emp ? pad8(emp.MANAGER) : "",
                SAP_MANAGER_NAME: emp ? fullName(byPernr[pad8(emp.MANAGER)]) : "",
                RECOMMENDED: !!emp && pad8(emp.MANAGER) === RECOMMENDED_MANAGER,
                STATUS_TEXT: statusText,
                STATUS_STATE: statusState,
            };
        })
        .sort((a, b) => (a.MAPPED === b.MAPPED ? a.USER_NAME.localeCompare(b.USER_NAME) : a.MAPPED ? 1 : -1));

    const data = {
        ok: true,
        trainer: lower(me.username),
        sapAvailable: !!sap,
        suggestedPernr: suggested ? suggested.PERNR : "",
        suggestedText: suggested ? `${suggested.PERNR} ${suggested.NAME}` : "",
        summary: {
            participants: participants.length,
            mapped: participants.filter((p) => p.MAPPED).length,
            notMapped: participants.filter((p) => !p.MAPPED).length,
            missingRole: participants.filter((p) => !p.HAS_BOTH_ROLES).length,
        },
        participants,
        employees,
        validEmployees,
    };

    // Optional user search, for mapping someone who has no leave role yet
    const search = lower(req.query && req.query.search);
    if (search) {
        const all = await p9.manager.find("users", { select: ["id", "username", "name", "email", "locked"] });
        data.users = all
            .filter((u) => [u.username, u.name, u.email].some((v) => lower(v).includes(search)))
            .slice(0, 20)
            .map((u) => ({
                USER_NAME: lower(u.username),
                NAME: u.name || "",
                EMAIL: u.email || "",
                LOCKED: !!u.locked,
                IS_PARTICIPANT: !!people[lower(u.username)],
            }));
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
        result.data = { ok: false, error: e.message || String(e) };
        complete();
    });
