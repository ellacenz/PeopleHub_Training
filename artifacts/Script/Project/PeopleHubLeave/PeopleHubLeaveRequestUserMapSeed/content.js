// PeopleHubLeaveRequestUserMapSeed
// Links each training participant (Neptune user name) to a SAP employee (PERNR) in peoplehubusermap.
// Run it before the training, after adding the participants to MAPPING. Safe to run repeatedly.
// - Each PERNR is checked in SAP (getEmployees) before it is saved; SAP is only read.
// - A user that is already mapped gets the new PERNR; other rows in the table are left alone.
// - ROLE is informational only (MANAGER when SAP says IS_MANAGER). What a user can do in the
//   apps comes from the Cockpit roles PeopleHubEmployeeTrainingME / PeopleHubManagerTrainingME.
//
// SAP hierarchy that works for the exercise (sap-client 100):
//   00000030 Bill West (manager) -> 00000029, 00000031-00000035, 00000055 report to him.

const SAP_CLIENT = "100";

// Neptune user name -> SAP personnel number (8 digits)
const MAPPING = [
    { username: "veronica.fernandez@neptune-software.com", pernr: "00000029" }, // Bruce Smith (employee of 30)
    { username: "joao.salvador@neptune-software.com", pernr: "00000030" }, // Bill West (manager)
];

const UserMap = entities.peoplehubusermap;

const pad8 = (v) => String(v || "").trim().replace(/^0+/, "").padStart(8, "0");

async function sapEmployee(pernr) {
    try {
        const res = await apis.getEmployees({ parameters: { "sap-client": SAP_CLIENT, IV_PERNR: pernr } });
        const rows = (res.data && res.data.result && res.data.result.GT_EMPLOYEES) || [];
        return rows[0] || null;
    } catch (e) {
        return null; // the SAP API answers 404 when the personnel number does not exist
    }
}

async function main() {
    const report = [];
    for (const m of MAPPING) {
        const username = String(m.username).trim().toLowerCase();
        const pernr = pad8(m.pernr);

        const user = await p9.manager.findOne("users", { where: { username } });
        if (!user) {
            report.push({ username, pernr, result: "SKIPPED: no Neptune user with this user name" });
            continue;
        }
        const emp = await sapEmployee(pernr);
        if (!emp) {
            report.push({ username, pernr, result: "SKIPPED: personnel number not found in SAP" });
            continue;
        }

        const role = emp.IS_MANAGER ? "MANAGER" : "EMPLOYEE";
        const existing = await UserMap.find({ where: { USER_NAME: username } });
        if (existing.length > 0) {
            for (const row of existing) {
                row.PERNR = pernr;
                row.ROLE = role;
                await UserMap.save(row);
            }
        } else {
            await UserMap.save({ USER_NAME: username, PERNR: pernr, ROLE: role });
        }
        report.push({
            username,
            pernr,
            sapName: `${emp.FIRST_NAME} ${emp.LAST_NAME}`,
            sapManager: emp.MANAGER ? pad8(emp.MANAGER) : null,
            role,
            result: existing.length > 0 ? "UPDATED" : "CREATED",
        });
    }
    return { status: 200, data: { mapped: report.filter((r) => !r.result.startsWith("SKIPPED")).length, report } };
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
