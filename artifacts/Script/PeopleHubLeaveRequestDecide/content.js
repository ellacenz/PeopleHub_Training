// PeopleHubLeaveRequestDecide
// POST { id, decision: "APPROVED" | "REJECTED", comment }: a manager decides a PENDING leave request.
// - Only users with the Cockpit role PeopleHubManagerTrainingME (self-approval is allowed in the training).
// - Only a PENDING request (409 otherwise). A rejection needs a comment (400).
// - APPROVED: generates the PDF PeopleHubLeaveConfirmation (archive key = request id) and emails it to the employee.
// - REJECTED: emails the employee with the reason, no PDF.
// - The email uses the template PeopleHubLeaveRequestDecision. If the PDF or the email fails, the decision
//   is still saved and the answer says what went wrong.
// SAP is only read (employee, manager, holidays, leave balance) to fill the confirmation.

const dayjs = modules.dayjs;

const SAP_CLIENT = "100";
const ROLE_MANAGER = "PeopleHubManagerTrainingME";
const TEMPLATE = "PeopleHubLeaveRequestDecision";
const PDF_TEMPLATE = "PeopleHubLeaveConfirmation";
const QUOTA_OF_TYPE = { "0100": 10, "0190": 12 }; // absence types with a SAP quota (KTART)

const Requests = entities.peoplehubleaverequest;

const pad8 = (v) => String(v || "").trim().replace(/^0+/, "").padStart(8, "0");
const sapDate = (d) => d.format("YYYYMMDD");
const nice = (d) => dayjs(d).format("D MMM YYYY");
const days = (n) => String(Number(n || 0));

async function sap(fn, params) {
    try {
        const res = await fn({ parameters: Object.assign({ "sap-client": SAP_CLIENT }, params) });
        return (res.data && res.data.result) || {};
    } catch (e) {
        const body = e.response && e.response.data;
        return (body && body.result) || {};
    }
}

async function hasRole(userId, roleName) {
    const assigned = await p9.user.getRolesAndGroups(userId);
    const ids = (assigned.roles || []).map((r) => String(r.id).toUpperCase());
    const role = await p9.manager.findOne("role", { where: { name: roleName } });
    return !!role && ids.includes(String(role.id).toUpperCase());
}

function fail(status, error) {
    return { status, data: { ok: false, error } };
}

// The data of the PDF: employee and manager from SAP, holidays in the period, balance incl. Neptune bookings
async function confirmationBody(request, deciderName, now) {
    const emp = (await sap(apis.getEmployees, { IV_PERNR: request.PERNR })).GT_EMPLOYEES || [];
    const e = emp[0] || {};
    let managerName = "";
    if (e.MANAGER) {
        const m = ((await sap(apis.getEmployees, { IV_PERNR: pad8(e.MANAGER) })).GT_EMPLOYEES || [])[0];
        managerName = m ? `${m.FIRST_NAME} ${m.LAST_NAME}`.trim() : pad8(e.MANAGER);
    }

    const start = dayjs(request.START_DATE);
    const end = dayjs(request.END_DATE);
    const hol = (await sap(apis.getHolidays, { IV_PERNR: request.PERNR, IV_FROM: sapDate(start), IV_TO: sapDate(end) })).GT_HOLIDAYS || [];
    const weekdayHolidays = hol.filter((h) => { const d = dayjs(h.ISO_DATE).day(); return d !== 0 && d !== 6; });
    const holidaysText = weekdayHolidays.length
        ? "Weekends and SAP public holidays are not counted: " +
          weekdayHolidays.map((h) => `${nice(h.ISO_DATE)} ${h.DESCRIPTION}${/half/i.test(h.DESCRIPTION) ? " (half day)" : ""}`).join(", ") + "."
        : "Weekends and SAP public holidays are not counted.";

    const balance = { quota: "no quota for this absence type", sapRemaining: "-", booked: "-", available: "-" };
    const ktart = QUOTA_OF_TYPE[request.AWART];
    if (ktart) {
        const rows = (await sap(apis.getLeaveBalance, { IV_PERNR: request.PERNR, IV_DATE: sapDate(start) })).GT_BALANCES || [];
        const q = rows.find((b) => Number(b.KTART) === ktart);
        if (q) {
            const mine = await Requests.find({ where: { createdBy: request.createdBy } });
            const booked = mine
                .filter((r) => (r.STATUS === "PENDING" || r.STATUS === "APPROVED") && r.AWART === request.AWART)
                .reduce((sum, r) => sum + Number(r.WORKING_DAYS || 0), 0);
            const remaining = Number(q.REMAINING || 0);
            Object.assign(balance, { quota: q.QUOTA_TEXT, sapRemaining: days(remaining), booked: days(booked), available: days(remaining - booked) });
        }
    }

    return {
        header: { reference: "LR-" + String(request.id).substring(0, 8).toUpperCase() },
        employee: { name: request.EMPLOYEE_NAME, pernr: request.PERNR, orgUnit: e.ORG_TEXT || "-", manager: managerName || "-" },
        leave: { type: request.TYPE_TEXT, startDate: nice(start), endDate: nice(end), workingDays: days(request.WORKING_DAYS), holidaysText },
        balance,
        approval: { by: deciderName, on: now.format("D MMM YYYY, HH:mm") + " UTC", comment: request.DECISION_COMMENT || "-" },
        meta: { generatedOn: now.format("D MMM YYYY") },
    };
}

async function main() {
    const user = req.user || {};
    if (!user.id) return fail(401, "Not logged in");
    const username = String(user.username).toLowerCase();
    if (!(await hasRole(user.id, ROLE_MANAGER))) return fail(403, `You need the role ${ROLE_MANAGER} to approve or reject leave.`);

    const body = req.body || {};
    const id = String(body.id || "").trim();
    const decision = String(body.decision || "").toUpperCase();
    const comment = String(body.comment || "").trim();
    if (!id) return fail(400, "The leave request id is missing.");
    if (decision !== "APPROVED" && decision !== "REJECTED") return fail(400, "The decision must be APPROVED or REJECTED.");
    if (decision === "REJECTED" && !comment) return fail(400, "Give a reason when you reject a request.");

    const request = await Requests.findOne({ where: { id } });
    if (!request) return fail(404, "The leave request was not found.");
    if (request.STATUS !== "PENDING") return fail(409, `This request is ${String(request.STATUS).toLowerCase()}: only a pending request can be decided.`);

    // 1. Save the decision
    const now = dayjs();
    request.STATUS = decision;
    request.DECISION_COMMENT = comment || null;
    request.DECIDED_BY = username;
    request.DECIDED_AT = now.valueOf();
    request.updatedBy = username;
    await Requests.save(request);
    const decider = await p9.manager.findOne("users", { where: { username } });
    const deciderName = (decider && decider.name) || username;

    // 2. On approval: the confirmation PDF, kept in the PDF Archive under the request id
    let pdfBase64 = null;
    let pdfMessage = "";
    if (decision === "APPROVED") {
        try {
            const pdfBody = await confirmationBody(request, deciderName, now);
            pdfBase64 = await p9.pdf.generatePdf({ pdfName: PDF_TEMPLATE, objectKey: id, securityKey: id, body: pdfBody });
            if (!pdfBase64) throw new Error(`PDF template ${PDF_TEMPLATE} not found or not active`);
            pdfMessage = "Confirmation PDF created.";
        } catch (e) {
            pdfMessage = `The confirmation PDF could not be created: ${e.message || e}`;
            log.error(`PeopleHubLeaveRequestDecide ${id}: ${pdfMessage}`);
        }
    }

    // 3. Email the employee (the Neptune user who asked), with the PDF when approved
    let emailSent = false;
    let emailMessage = "";
    try {
        const employee = await p9.manager.findOne("users", { where: { username: request.createdBy } });
        if (!employee || !employee.email) throw new Error(`no email address for ${request.createdBy}`);
        const template = await p9.manager.findOne("wf_notifications", { where: { name: TEMPLATE } });
        if (!template) throw new Error(`email template ${TEMPLATE} not found`);
        const approved = decision === "APPROVED";
        const periodText = nice(request.START_DATE) === nice(request.END_DATE) ? nice(request.START_DATE) : `${nice(request.START_DATE)} - ${nice(request.END_DATE)}`;
        const tokens = {
            typeText: request.TYPE_TEXT,
            periodText,
            workingDays: days(request.WORKING_DAYS),
            decisionText: approved ? "Approved" : "Rejected",
            decidedBy: deciderName,
            statusNote: approved
                ? (pdfBase64 ? "Your leave confirmation is attached as a PDF. " : "") + (comment ? `Comment: ${comment}` : "Enjoy your time off!")
                : `Reason: ${comment}. You can create a new request in Leave Requests.`,
            statusColor: approved ? "#256f3a" : "#aa0808",
            statusBg: approved ? "#e7f4e9" : "#fde7e9",
        };
        const mail = {
            to: employee.email,
            subject: `Your leave request ${periodText}: ${tokens.decisionText}`,
            templateId: template.id,
            primitives: tokens,
        };
        if (pdfBase64) {
            mail.attachments = [{ filename: `Leave_confirmation_${request.START_DATE}.pdf`, content: pdfBase64, encoding: "base64" }];
        }
        await sendEmail(mail);
        emailSent = true;
        emailMessage = `Email sent to ${employee.email}.`;
    } catch (e) {
        emailMessage = `The decision is saved, but the email could not be sent: ${e.message || e}`;
        log.warn(`PeopleHubLeaveRequestDecide ${id}: ${emailMessage}`);
    }

    log.info(`Leave request ${id} ${decision} by ${username}. ${pdfMessage} ${emailMessage}`);
    return {
        status: 200,
        data: { ok: true, id, STATUS: decision, pdfCreated: !!pdfBase64, pdfMessage, emailSent, emailMessage },
    };
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
