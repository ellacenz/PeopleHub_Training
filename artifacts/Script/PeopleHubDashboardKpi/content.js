// PeopleHubDashboardKpi
// GET: the KPI tile of the dashboard (exercise 3.0, optional). The tile is of type Integration Card and calls this
// script through its API (tile field Data URL). The answer is a UI5 Integration Card manifest:
// - the header shows one big number: what is waiting for a decision (pending leave requests + submitted claims);
// - the side indicators and the list show approved leave days and approved claims (EUR).

const Leave = entities.peoplehubleaverequest;
const Claims = entities.peoplehubexpenseclaim;

const round = (n) => Math.round(n * 100) / 100;
const sum = (rows, field) => round(rows.reduce((s, r) => s + Number(r[field] || 0), 0));

async function main() {
    const leave = await Leave.find();
    const claims = await Claims.find();

    const leavePending = leave.filter((r) => r.STATUS === "PENDING");
    const leaveApproved = leave.filter((r) => r.STATUS === "APPROVED");
    const claimsSubmitted = claims.filter((c) => c.status === "Submitted");
    const claimsApproved = claims.filter((c) => c.status === "Approved");
    const waiting = leavePending.length + claimsSubmitted.length;

    return {
        "sap.app": { id: "peoplehub.dashboard.kpi", type: "card" },
        "sap.card": {
            type: "List",
            header: {
                type: "Numeric",
                title: "Waiting for a Decision",
                subTitle: "Leave requests and expense claims",
                mainIndicator: { number: String(waiting), unit: waiting === 1 ? "item" : "items", state: waiting ? "Critical" : "Good" },
                sideIndicators: [
                    { title: "Leave approved", number: String(sum(leaveApproved, "WORKING_DAYS")), unit: "days" },
                    { title: "Claims approved", number: String(sum(claimsApproved, "totaleur")), unit: "EUR" },
                ],
            },
            content: {
                data: {
                    json: [
                        { title: "Leave requests pending", value: String(leavePending.length), state: leavePending.length ? "Warning" : "Success" },
                        { title: "Expense claims submitted", value: `${claimsSubmitted.length} · ${sum(claimsSubmitted, "totaleur")} EUR`, state: claimsSubmitted.length ? "Warning" : "Success" },
                        { title: "Leave days approved", value: String(sum(leaveApproved, "WORKING_DAYS")), state: "Success" },
                        { title: "Expense claims approved", value: `${claimsApproved.length} · ${sum(claimsApproved, "totaleur")} EUR`, state: "Success" },
                    ],
                },
                item: { title: "{title}", info: { value: "{value}", state: "{state}" } },
                maxItems: 4,
            },
        },
    };
}

main()
    .then((card) => {
        result.data = card;
        complete();
    })
    .catch((e) => {
        log.error(e);
        result.statusCode = 500;
        result.data = { error: e.message || String(e) };
        complete();
    });
