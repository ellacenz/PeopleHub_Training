// PeopleHubLeaveRequestCreate
// POST { AWART, START_DATE, END_DATE, COMMENT, preview }
//   preview = true  -> only calculate and check, nothing is saved (the dialog shows the result)
//   preview = false -> the same checks, then the request is saved as DRAFT
//                      (the employee sends it for approval with PeopleHubLeaveRequestSend)
// Who: only users with the Cockpit role PeopleHubEmployeeTrainingME, for their own SAP employee
//      (peoplehubusermap). The request belongs to the logged-in user (createdBy).
// SAP is only read: employee + manager, absence types, public holidays, absences, quota check.
// Working days are counted with dayjs: Monday-Friday, minus SAP public holidays (a half holiday counts 0.5).
// Balance: SAP does not know the requests in Neptune, so for types with a quota the days already
//          booked in Neptune (my PENDING + APPROVED requests) are subtracted from the SAP remaining days.

const dayjs = modules.dayjs;

const SAP_CLIENT = "100";
const ROLE_EMPLOYEE = "PeopleHubEmployeeTrainingME";
// Absence types offered in the training (all exist in SAP for the demo employees)
const ALLOWED_TYPES = ["0100", "0190", "0300", "0620"];
// Absence types that use a SAP quota (KTART in getLeaveBalance)
const QUOTA_OF_TYPE = { "0100": 10, "0190": 12 };

const UserMap = entities.peoplehubusermap;
const Requests = entities.peoplehubleaverequest;

const pad8 = (v) => String(v || "").trim().replace(/^0+/, "").padStart(8, "0");
const sapDate = (d) => d.format("YYYYMMDD");

// SAP answers { result: {...} }; on 404/409 the body is in the error
async function sap(fn, params) {
    try {
        const res = await fn({ parameters: Object.assign({ "sap-client": SAP_CLIENT }, params) });
        return { ok: true, data: (res.data && res.data.result) || {} };
    } catch (e) {
        const body = e.response && e.response.data;
        return { ok: false, status: e.response && e.response.status, data: (body && body.result) || {} };
    }
}

function sapMessage(data, fallback) {
    const msgs = (data.GT_RETURN || []).filter((m) => m.TYPE === "E" || m.TYPE === "S" || m.TYPE === "W");
    return msgs.length ? msgs[msgs.length - 1].MESSAGE : fallback;
}

// Working days from start to end (both included): Monday-Friday, minus SAP public holidays (a half holiday counts 0.5).
// holidays: [{ date: "YYYY-MM-DD", text, value }]. No await inside, so it can be tested on its own in the debugger.
function countWorkingDays(start, end, holidays) {
    let workingDays = 0;
    const holidaysInPeriod = [];
    for (let d = start; !d.isAfter(end, "day"); d = d.add(1, "day")) {
        if (d.day() === 0 || d.day() === 6) continue; // Saturday or Sunday
        const h = holidays.find((x) => x.date === d.format("YYYY-MM-DD"));
        if (h) holidaysInPeriod.push(h);
        workingDays += h ? 1 - h.value : 1;
    }
    return { workingDays, holidaysInPeriod };
}

async function hasRole(userId, roleName) {
    const assigned = await p9.user.getRolesAndGroups(userId);
    const ids = (assigned.roles || []).map((r) => String(r.id).toUpperCase());
    const role = await p9.manager.findOne("role", { where: { name: roleName } });
    return !!role && ids.includes(String(role.id).toUpperCase());
}

function fail(status, error, extra) {
    return { status, data: Object.assign({ ok: false, error }, extra || {}) };
}

async function main() {
    const user = req.user || {};
    if (!user.id) return fail(401, "Not logged in");
    const username = String(user.username).toLowerCase();
    if (!(await hasRole(user.id, ROLE_EMPLOYEE))) return fail(403, `You need the role ${ROLE_EMPLOYEE} to request leave.`);

    const body = req.body || {};
    const preview = body.preview === true || body.preview === "true";
    const awart = String(body.AWART || "").trim();
    const comment = String(body.COMMENT || "").trim();
    const startText = String(body.START_DATE || "");
    const endText = String(body.END_DATE || body.START_DATE || "");
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    const start = isoDate.test(startText) ? dayjs(startText) : dayjs("invalid");
    const end = isoDate.test(endText) ? dayjs(endText) : dayjs("invalid");

    // 1. Input
    if (!ALLOWED_TYPES.includes(awart)) return fail(400, "Choose an absence type.");
    if (!start.isValid() || !end.isValid()) return fail(400, "Choose a start and an end date.");
    if (end.isBefore(start, "day")) return fail(400, "The end date is before the start date.");
    if (start.isBefore(dayjs(), "day")) return fail(400, "The start date is in the past.");
    if (end.diff(start, "day") > 60) return fail(400, "A request can cover at most 60 days.");

    // 2. Who am I in SAP
    const map = await UserMap.find({ where: { USER_NAME: username } });
    if (map.length === 0) return fail(400, "Your user is not linked to a SAP employee. Ask the trainer.");
    const pernr = pad8(map[0].PERNR);
    const emp = await sap(apis.getEmployees, { IV_PERNR: pernr });
    const employee = (emp.data.GT_EMPLOYEES || [])[0];
    if (!employee) return fail(400, `Personnel number ${pernr} was not found in SAP.`);

    // 3. Absence type text from SAP
    const types = await sap(apis.getAbsenceTypes, { IV_PERNR: pernr });
    const type = (types.data.GT_ABSENCE_TYPES || []).find((t) => t.AWART === awart);
    if (!type) return fail(400, `Absence type ${awart} is not allowed for you in SAP.`);

    // 4. Working days: Monday-Friday minus SAP public holidays
    const hol = await sap(apis.getHolidays, { IV_PERNR: pernr, IV_FROM: sapDate(start), IV_TO: sapDate(end) });
    const holidays = (hol.data.GT_HOLIDAYS || []).map((h) => ({
        date: h.ISO_DATE,
        text: h.DESCRIPTION,
        value: /half/i.test(h.DESCRIPTION || "") ? 0.5 : 1,
    }));
    const { workingDays, holidaysInPeriod } = countWorkingDays(start, end, holidays);
    const summary = {
        PERNR: pernr,
        EMPLOYEE_NAME: `${employee.FIRST_NAME} ${employee.LAST_NAME}`.trim(),
        AWART: awart,
        TYPE_TEXT: type.TYPE_TEXT,
        START_DATE: start.format("YYYY-MM-DD"),
        END_DATE: end.format("YYYY-MM-DD"),
        WORKING_DAYS: workingDays,
        holidays: holidaysInPeriod,
    };
    if (workingDays <= 0) return fail(400, "The period has no working days (weekend or public holidays).", summary);

    // 5. No overlap with my own requests in Neptune (draft, pending or approved)
    const mine = await Requests.find({ where: { createdBy: username } });
    const clash = mine.find((r) =>
        (r.STATUS === "DRAFT" || r.STATUS === "PENDING" || r.STATUS === "APPROVED") &&
        r.START_DATE <= summary.END_DATE && r.END_DATE >= summary.START_DATE);
    if (clash) {
        return fail(409, `You already have a ${clash.STATUS.toLowerCase()} request from ${clash.START_DATE} to ${clash.END_DATE}.`, summary);
    }

    // 6. No overlap with absences already in SAP
    const abs = await sap(apis.getAbsences, { IV_PERNR: pernr, IV_FROM: sapDate(start), IV_TO: sapDate(end) });
    const sapClash = (abs.data.GT_ABSENCES || [])[0];
    if (sapClash) {
        return fail(409, `SAP already has ${sapClash.TYPE_TEXT} from ${sapClash.BEGDA} to ${sapClash.ENDDA} in this period.`, summary);
    }

    // 7. Quota check in SAP (SAP answers 409 when the quota is not enough)
    const quota = await sap(apis.getCheckQuota, { IV_PERNR: pernr, IV_AWART: awart, IV_FROM: sapDate(start), IV_TO: sapDate(end) });
    if (!quota.ok) return fail(409, sapMessage(quota.data, "Not enough quota in SAP for this period."), summary);
    summary.quotaMessage = sapMessage(quota.data, "Quota check OK");

    // 8. Balance including what is booked in Neptune (SAP is never updated by this app)
    const ktart = QUOTA_OF_TYPE[awart];
    if (ktart) {
        const bal = await sap(apis.getLeaveBalance, { IV_PERNR: pernr, IV_DATE: sapDate(start) });
        const quotaRow = (bal.data.GT_BALANCES || []).find((b) => Number(b.KTART) === ktart);
        if (quotaRow) {
            const booked = mine
                .filter((r) => (r.STATUS === "PENDING" || r.STATUS === "APPROVED") && r.AWART === awart)
                .reduce((sum, r) => sum + Number(r.WORKING_DAYS || 0), 0);
            const sapRemaining = Number(quotaRow.REMAINING || 0);
            const available = sapRemaining - booked;
            Object.assign(summary, { quotaText: quotaRow.QUOTA_TEXT, sapRemaining, bookedInNeptune: booked, available });
            if (workingDays > available) {
                return fail(409, `Not enough ${quotaRow.QUOTA_TEXT}: SAP has ${sapRemaining} day(s) left, ${booked} are already booked in Neptune, so ${available} are available and you asked for ${workingDays}.`, summary);
            }
            summary.quotaMessage += ` | ${quotaRow.QUOTA_TEXT}: ${available} of ${sapRemaining} day(s) available after the ${booked} booked in Neptune.`;
        }
    }

    if (preview) return { status: 200, data: Object.assign({ ok: true, preview: true }, summary) };

    // 9. Save as DRAFT (Send for approval makes it PENDING)
    const saved = await Requests.save({
        PERNR: pernr,
        EMPLOYEE_NAME: summary.EMPLOYEE_NAME,
        MANAGER_PERNR: employee.MANAGER ? pad8(employee.MANAGER) : "",
        AWART: awart,
        TYPE_TEXT: type.TYPE_TEXT,
        START_DATE: summary.START_DATE,
        END_DATE: summary.END_DATE,
        WORKING_DAYS: workingDays,
        COMMENT: comment,
        STATUS: "DRAFT",
        CREATED_AT_APP: Date.now(),
        SOURCE: "APP",
        createdBy: username,
        updatedBy: username,
    });
    return { status: 200, data: Object.assign({ ok: true, preview: false, id: saved.id, STATUS: "DRAFT" }, summary) };
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
