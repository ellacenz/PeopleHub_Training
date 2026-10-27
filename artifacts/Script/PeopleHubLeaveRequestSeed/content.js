// PeopleHubLeaveRequestSeed
// Creates 3 test leave requests (Pending, Approved, Rejected) for the user who runs the script,
// so the Register and Approve apps have data before the create step exists.
// - The requests belong to the runner (createdBy = runner) and use the runner's SAP employee
//   from peoplehubusermap (name and manager read from SAP; SAP is only read).
// - Safe to run repeatedly: the runner's earlier seed rows (SOURCE = SEED) are replaced.

const SAP_CLIENT = "100";

const UserMap = entities.peoplehubusermap;
const Requests = entities.peoplehubleaverequest;

const pad8 = (v) => String(v || "").trim().replace(/^0+/, "").padStart(8, "0");

async function sapEmployee(pernr) {
    try {
        const res = await apis.getEmployees({ parameters: { "sap-client": SAP_CLIENT, IV_PERNR: pernr } });
        const rows = (res.data && res.data.result && res.data.result.GT_EMPLOYEES) || [];
        return rows[0] || null;
    } catch (e) {
        return null;
    }
}

// type, text, from, to, working days, comment, status, decision comment
const SAMPLES = [
    ["0100", "Leave", "2026-12-21", "2026-12-23", 3, "Christmas with the family", "PENDING", null],
    ["0100", "Leave", "2026-11-16", "2026-11-20", 5, "Autumn holiday", "APPROVED", "Enjoy your holiday"],
    ["0190", "Educational Leave", "2026-09-21", "2026-09-22", 2, "Course in Lisbon", "REJECTED", "You already have leave in SAP on these days"],
];

async function main() {
    const username = String((req.user && req.user.username) || "").toLowerCase();
    if (!username) return { status: 401, data: { error: "Not logged in" } };

    const map = await UserMap.find({ where: { USER_NAME: username } });
    if (map.length === 0) return { status: 400, data: { error: `${username} is not in peoplehubusermap` } };
    const pernr = pad8(map[0].PERNR);

    const emp = await sapEmployee(pernr);
    if (!emp) return { status: 400, data: { error: `PERNR ${pernr} not found in SAP` } };
    const managerPernr = emp.MANAGER ? pad8(emp.MANAGER) : "";

    const old = await Requests.find({ where: { createdBy: username, SOURCE: "SEED" } });
    for (const row of old) await Requests.delete({ id: row.id });

    const now = Date.now();
    const created = [];
    for (let i = 0; i < SAMPLES.length; i++) {
        const [awart, text, from, to, days, comment, status, decisionComment] = SAMPLES[i];
        const decided = status !== "PENDING";
        const row = await Requests.save({
            PERNR: pernr,
            EMPLOYEE_NAME: `${emp.FIRST_NAME} ${emp.LAST_NAME}`.trim(),
            MANAGER_PERNR: managerPernr,
            AWART: awart,
            TYPE_TEXT: text,
            START_DATE: from,
            END_DATE: to,
            WORKING_DAYS: days,
            COMMENT: comment,
            STATUS: status,
            DECISION_COMMENT: decisionComment,
            DECIDED_BY: decided ? username : null,
            DECIDED_AT: decided ? now - i * 3600000 : null,
            CREATED_AT_APP: now - (i + 1) * 86400000,
            SOURCE: "SEED",
            createdBy: username,
            updatedBy: username,
        });
        created.push({ id: row.id, status, period: `${from} - ${to}`, createdBy: row.createdBy });
    }
    return { status: 200, data: { username, pernr, removed: old.length, created } };
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
