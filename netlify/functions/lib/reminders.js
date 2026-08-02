'use strict';

// The deadline clock for the "gentle nudge" reminders. An expense has
// `deadlineDays` (default 60) from its date to be submitted; we start reminding
// in the final stretch. Pure + testable — the scheduled function does the
// Airtable + push side.

// Days-left marks we nudge on as the deadline approaches. 10 = the first nudge
// (e.g. day 50 of a 60-day window: "10 days left"); then it escalates.
const APPROACH_MILESTONES = [10, 5, 2, 1];

// Whole days from one YYYY-MM-DD to another (b - a). Null if either is unparseable.
function daysBetween(fromStr, toStr) {
  const a = Date.parse(`${String(fromStr).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(toStr).slice(0, 10)}T00:00:00Z`);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

// Days left before an expense dated `expenseDateStr` passes the deadline, as of
// `todayStr`. Negative = already past the deadline.
function daysLeftFor(expenseDateStr, todayStr, deadlineDays) {
  const age = daysBetween(expenseDateStr, todayStr);
  return age == null ? null : deadlineDays - age;
}

// Whether today is a day to nudge for something with `daysLeft` left, and what
// kind of nudge. Returns null on quiet days so we don't nag daily.
//   approaching — on the milestone days in the final stretch
//   due         — the deadline day itself
//   overdue     — once a week after it's blown
function shouldRemind(daysLeft) {
  if (daysLeft == null) return null;
  if (daysLeft > 10) return null;
  if (daysLeft > 0) return APPROACH_MILESTONES.includes(daysLeft) ? { kind: 'approaching', daysLeft } : null;
  if (daysLeft === 0) return { kind: 'due', daysLeft };
  return Math.abs(daysLeft) % 7 === 0 ? { kind: 'overdue', daysLeft } : null;
}

module.exports = { APPROACH_MILESTONES, daysBetween, daysLeftFor, shouldRemind };
