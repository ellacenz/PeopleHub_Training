// OnboardingReminder
// Job script: the daily onboarding reminder. It reads the onboarding tasks and writes ONE log entry with:
// - the progress (how many tasks are done),
// - the tasks that are overdue,
// - the tasks that are due in the next 14 days.
// A job in Job Manage runs it (by hand with Run, or every morning). Nothing is changed or sent.

const Tasks = entities.onboardingtask;
const DAYS_AHEAD = 14;

const day = (d) => new Date(d).toISOString().slice(0, 10); // "2026-11-02"

async function main() {
    const tasks = await Tasks.find({ order: { dueDate: "ASC" } });
    const today = day(Date.now());
    const soon = day(Date.now() + DAYS_AHEAD * 86400000);

    const open = tasks.filter((t) => !t.done);
    const overdue = open.filter((t) => day(t.dueDate) < today);
    const dueSoon = open.filter((t) => day(t.dueDate) >= today && day(t.dueDate) <= soon);

    const lines = [`Onboarding reminder: ${tasks.length - open.length} of ${tasks.length} tasks done.`];
    for (const t of overdue) lines.push(`OVERDUE: "${t.title}" was due on ${day(t.dueDate)}.`);
    for (const t of dueSoon) lines.push(`Due soon: "${t.title}" on ${day(t.dueDate)}.`);
    if (!overdue.length && !dueSoon.length) lines.push(`Nothing overdue and nothing due in the next ${DAYS_AHEAD} days.`);
    log.info(lines.join("\n")); // one entry, so the whole reminder is in the log together

    result.data = { done: tasks.length - open.length, total: tasks.length, overdue: overdue.length, dueSoon: dueSoon.length };
    complete();
}

main().catch((e) => {
    log.error(e);
    result.data = { error: e.message || String(e) };
    complete();
});