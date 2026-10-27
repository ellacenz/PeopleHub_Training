// PeopleHubExpenseClaimSeed
// Creates or refreshes the mock data for the expense claim training (safe to run repeatedly).
// - Requester: REQUESTER (owns all mock claims)
// - Approver:  APPROVER  (decided the Approved / Rejected claims; sees all claims in the app)
// - Expense policies per category (used by the Submit checks)
// Dates are fixed: counted back from 22 Oct 2026, so they always match the mock receipts in test-receipts.
// Only rows with the fixed MOCK ids below are touched; other claims are left alone.

const REQUESTER = "antonio.neves@neptune-software.com";
const APPROVER = "veronica.fernandez@neptune-software.com";

const Claims = entities.peoplehubexpenseclaim;
const Lines = entities.peoplehubexpenseline;
const Policies = entities.peoplehubexpensepolicy;

const claimId = (n) => `7a1e0000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const lineId = (c, n) => `7a1e0000-0000-4000-8001-0000000${String(c).padStart(2, "0")}${String(n).padStart(3, "0")}`;
const policyId = (n) => `7a1e0000-0000-4000-8002-0000000000${String(n).padStart(2, "0")}`;

const BASE_DATE = Date.UTC(2026, 9, 22); // 22 Oct 2026: the day the mock receipts are printed for
function daysAgo(n) {
    const d = new Date(BASE_DATE);
    d.setUTCDate(d.getUTCDate() - n);
    return d;
}
const round2 = (n) => Math.round(n * 100) / 100;

// category | maxamount (EUR) | period (Line = per line, Day = per day) | receipt required above (EUR) | blocking
const POLICIES = [
    ["Meals", 60, "Day", 25, true],
    ["Hotel", 150, "Day", 0, false],
    ["Transport", null, "Line", 25, true],
    ["Mileage", 200, "Line", null, false],
    ["Other", 100, "Line", 25, true],
];

// Each claim: title, purpose, status, from/to (days ago), decision, lines
// Line: [daysAgo, category, merchant, amount, currency, rate to EUR, description, distancekm]
const CLAIMS = [
    {
        n: 1, title: "Client workshop Lisbon", purpose: "Discovery workshop with the customer's finance team",
        status: "Draft", from: 6, to: 5,
        lines: [
            [6, "Meals", "Taberna da Rua", 42.5, "EUR", 1, "Lunch with customer project lead"],
            [5, "Transport", "Uber", 18.9, "EUR", 1, "Hotel to customer office"],
        ],
    },
    {
        n: 2, title: "SAP TechEd Berlin", purpose: "Conference attendance and partner meetings",
        status: "Submitted", from: 20, to: 17, submitted: 14,
        lines: [
            [20, "Transport", "Lufthansa", 289, "EUR", 1, "Return flight Lisbon - Berlin"],
            [20, "Hotel", "Hotel Adlon Berlin", 155, "EUR", 1, "Night 1"],
            [19, "Hotel", "Hotel Adlon Berlin", 155, "EUR", 1, "Night 2"],
            [18, "Meals", "Brauhaus Lemke", 58, "EUR", 1, "Dinner"],
        ],
    },
    {
        n: 3, title: "Customer visit Porto", purpose: "Quarterly business review",
        status: "Approved", from: 35, to: 35, submitted: 33, decided: 32,
        lines: [
            [35, "Mileage", "Own car", 43.2, "EUR", 1, "Lisbon - Porto return, 120 km", 120],
            [35, "Meals", "Cafe Majestic", 35, "EUR", 1, "Lunch"],
        ],
    },
    {
        n: 4, title: "Team offsite Madrid", purpose: "Team planning offsite",
        status: "Rejected", from: 28, to: 27, submitted: 25, decided: 24,
        rejection: "Team dinner is over the 60 EUR meal limit. Split it per person and resubmit.",
        lines: [
            [28, "Meals", "Restaurante Botin", 240, "EUR", 1, "Team dinner (4 people)"],
            [27, "Transport", "Renfe", 64.3, "EUR", 1, "Train Madrid - Toledo"],
        ],
    },
    {
        n: 5, title: "Partner meeting London", purpose: "Joint go-to-market planning",
        status: "Submitted", from: 12, to: 11, submitted: 9,
        lines: [
            [12, "Transport", "Heathrow Express", 65, "GBP", 1.17, "Airport to city"],
            [11, "Meals", "Dishoom", 48, "GBP", 1.17, "Dinner with partner"],
        ],
    },
    {
        n: 6, title: "Training Amsterdam", purpose: "Neptune DXP partner training",
        status: "Draft", from: 3, to: 2,
        lines: [
            [3, "Other", "Albert Heijn", 12.4, "EUR", 1, "Snacks for the training room"],
        ],
    },
];

async function upsert(Repo, where, data) {
    const existing = await Repo.findOne({ where });
    return Repo.save(existing ? Object.assign(existing, data) : data);
}

async function main() {
    const out = { policies: 0, claims: 0, lines: 0 };

    for (let i = 0; i < POLICIES.length; i++) {
        const [category, maxamount, period, receiptthreshold, blocking] = POLICIES[i];
        await upsert(Policies, { category }, { policyid: policyId(i + 1), category, maxamount, period, receiptthreshold, blocking });
        out.policies++;
    }

    for (const c of CLAIMS) {
        const id = claimId(c.n);
        const lines = c.lines.map((l, i) => {
            const [ago, category, merchant, amount, currency, rate, description, distancekm] = l;
            return {
                lineid: lineId(c.n, i + 1), claimid: id, expensedate: daysAgo(ago), category, merchant,
                amount, currency, rate: currency === "EUR" ? null : rate, ratedate: currency === "EUR" ? null : daysAgo(ago),
                amounteur: round2(amount * rate), distancekm: distancekm || null, description,
                receiptid: null, policyflags: null,
            };
        });

        // Remove lines of this mock claim that are no longer in the list, then upsert the current ones
        const current = await Lines.find({ where: { claimid: id } });
        const keep = new Set(lines.map((l) => l.lineid.toLowerCase()));
        const stale = current.filter((l) => !keep.has(String(l.lineid).toLowerCase()));
        if (stale.length) await Lines.remove(stale);
        for (const l of lines) {
            await upsert(Lines, { lineid: l.lineid }, l);
            out.lines++;
        }

        const decided = c.status === "Approved" || c.status === "Rejected";
        await upsert(Claims, { claimid: id }, {
            claimid: id,
            title: c.title,
            purpose: c.purpose,
            datefrom: daysAgo(c.from),
            dateto: daysAgo(c.to),
            status: c.status,
            totaleur: round2(lines.reduce((s, l) => s + l.amounteur, 0)),
            createdByPerson: REQUESTER,
            submittedat: c.submitted ? daysAgo(c.submitted) : null,
            approver: decided ? APPROVER : null,
            decidedat: decided ? daysAgo(c.decided) : null,
            rejectionreason: c.rejection || null,
        });
        out.claims++;
    }

    return out;
}

main()
    .then((out) => {
        result.data = Object.assign({ ok: true, requester: REQUESTER, approver: APPROVER }, out);
        complete();
    })
    .catch((e) => {
        log.error(e);
        result.statusCode = 500;
        result.data = { ok: false, error: e.message || String(e) };
        complete();
    });
