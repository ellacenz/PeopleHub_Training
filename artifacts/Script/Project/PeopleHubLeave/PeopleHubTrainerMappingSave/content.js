// PeopleHubTrainerMappingSave
// POST, trainer only (role PeopleHubTrainerTrainingME, 403). Writes the table peoplehubusermap; SAP is only read.
// - { action: "save", username, pernr }  maps one user to a SAP employee (creates or replaces the row).
//   The user must exist in Neptune and the PERNR must be Bill West (00000030) or one of his reports (400 otherwise).
// - { action: "remove", username }       deletes the mapping of that user.
// - { action: "automap", preview }       maps every participant without a mapping (users of the two leave roles)
//   to a recommended SAP employee (the reports of 00000030 Bill West), always picking the least used one, so the
//   participants are spread evenly. preview: true only returns the plan; preview: false saves it.

const SAP_CLIENT = "100";
const ROLE_TRAINER = "PeopleHubTrainerTrainingME";
const ROLE_EMPLOYEE = "PeopleHubEmployeeTrainingME";
const ROLE_MANAGER = "PeopleHubManagerTrainingME";
const RECOMMENDED_MANAGER = "00000030";

const UserMap = entities.peoplehubusermap;

const pad8 = (v) => (v === null || v === undefined || v === "" ? "" : String(v).trim().replace(/^0+/, "").padStart(8, "0"));
const lower = (v) => String(v || "").trim().toLowerCase();
const fullName = (e) => (e ? `${e.FIRST_NAME || ""} ${e.LAST_NAME || ""}`.trim() : "");

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

// Create or replace the mapping of one user (one row per user)
async function writeMapping(username, emp) {
    const rows = await UserMap.find({ where: { USER_NAME: username } });
    const role = emp.IS_MANAGER ? "MANAGER" : "EMPLOYEE";
    const pernr = pad8(emp.PERNR);
    if (rows.length) {
        rows[0].PERNR = pernr;
        rows[0].ROLE = role;
        await UserMap.save(rows[0]);
        for (const extra of rows.slice(1)) await UserMap.delete({ id: extra.id });
        return "UPDATED";
    }
    await UserMap.save({ USER_NAME: username, PERNR: pernr, ROLE: role });
    return "CREATED";
}

function fail(status, error) {
    return { status, data: { ok: false, error } };
}

async function main() {
    const me = req.user || {};
    if (!me.id) return fail(401, "Not logged in");
    if (!(await hasRole(me.id, ROLE_TRAINER))) return fail(403, `You need the role ${ROLE_TRAINER} to change the mapping.`);

    const body = req.body || {};
    const action = lower(body.action);

    if (action === "remove") {
        const username = lower(body.username);
        if (!username) return fail(400, "username is required.");
        const rows = await UserMap.find({ where: { USER_NAME: username } });
        if (!rows.length) return fail(404, `${username} has no mapping.`);
        for (const r of rows) await UserMap.delete({ id: r.id });
        return { status: 200, data: { ok: true, action, username, message: `Mapping of ${username} removed.` } };
    }

    if (action !== "save" && action !== "automap") return fail(400, 'action must be "save", "remove" or "automap".');

    const sap = await sapEmployees();
    if (!sap) return fail(502, "SAP is not available: the employees could not be read. Try again later.");
    const byPernr = {};
    for (const e of sap) byPernr[pad8(e.PERNR)] = e;

    if (action === "save") {
        const username = lower(body.username);
        const pernr = pad8(body.pernr);
        if (!username || !pernr) return fail(400, "username and pernr are required.");
        const user = await p9.manager.findOne("users", { where: { username } });
        if (!user) return fail(404, `There is no Neptune user ${username}.`);
        const emp = byPernr[pernr];
        if (!emp) return fail(404, `Personnel number ${pernr} does not exist in SAP.`);
        const valid = pad8(emp.MANAGER) === RECOMMENDED_MANAGER || pernr === RECOMMENDED_MANAGER;
        if (!valid) return fail(400, `${pernr} ${fullName(emp)} can't be used: only Bill West (00000030) and his reports have the manager and leave quota the exercises need.`);
        const result = await writeMapping(username, emp);
        return {
            status: 200,
            data: { ok: true, action, result, username, PERNR: pernr, SAP_NAME: fullName(emp), message: `${username} mapped to ${pernr} ${fullName(emp)}.` },
        };
    }

    // automap: participants of the two leave roles without a mapping
    const participants = {};
    for (const u of [...(await roleUsers(ROLE_EMPLOYEE)), ...(await roleUsers(ROLE_MANAGER))]) {
        const key = lower(u.username);
        if (key && !participants[key]) participants[key] = u;
    }
    const maps = await UserMap.find();
    const mapped = new Set(maps.map((m) => lower(m.USER_NAME)));
    const todo = Object.keys(participants).filter((k) => !mapped.has(k)).sort();

    const recommended = sap.filter((e) => pad8(e.MANAGER) === RECOMMENDED_MANAGER).map((e) => pad8(e.PERNR)).sort();
    if (!recommended.length) return fail(409, "SAP returned no recommended employees (reports of 00000030).");
    const usage = {};
    for (const p of recommended) usage[p] = 0;
    for (const m of maps) if (usage[pad8(m.PERNR)] !== undefined) usage[pad8(m.PERNR)]++;

    const plan = todo.map((username) => {
        const pernr = recommended.reduce((best, p) => (usage[p] < usage[best] ? p : best), recommended[0]);
        usage[pernr]++;
        const u = participants[username];
        return { USER_NAME: username, NAME: u.name || "", PERNR: pernr, SAP_NAME: fullName(byPernr[pernr]) };
    });

    const preview = body.preview !== false && body.preview !== "false";
    if (!preview) {
        for (const p of plan) await writeMapping(p.USER_NAME, byPernr[p.PERNR]);
    }
    const message = !plan.length
        ? "Every participant is already mapped."
        : preview
            ? `${plan.length} participant(s) will be mapped.`
            : `${plan.length} participant(s) mapped.`;
    return { status: 200, data: { ok: true, action, preview, count: plan.length, plan, message } };
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
