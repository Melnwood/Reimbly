'use strict';

// Recurring monthly subscriptions: turning a template expense's date into the
// date for a given month's copy. Pure + testable; the endpoint does the
// Airtable side (which templates exist, what's already been made).

function monthOf(dateStr) {
  const m = /^(\d{4})-(\d{2})/.exec(String(dateStr || ''));
  return m ? `${m[1]}-${m[2]}` : '';
}

// Last day of a month. month1 is 1-based (1 = January).
function daysInMonth(year, month1) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

// The date for `currentMonth`'s (YYYY-MM) copy of a template dated
// `templateDateStr`, keeping the same day-of-month (clamped to the month's
// length — e.g. a 31st becomes the 28th/30th). Returns null if the template's
// own date is already in the current month or in the future — nothing to make.
function recurringCopyDate(templateDateStr, currentMonth) {
  const tMonth = monthOf(templateDateStr);
  const cm = /^(\d{4})-(\d{2})$/.exec(String(currentMonth || ''));
  if (!tMonth || !cm) return null;
  if (tMonth >= currentMonth) return null;
  const day = Number(String(templateDateStr).slice(8, 10)) || 1;
  const clamped = Math.min(day, daysInMonth(Number(cm[1]), Number(cm[2])));
  return `${cm[1]}-${cm[2]}-${String(clamped).padStart(2, '0')}`;
}

module.exports = { monthOf, daysInMonth, recurringCopyDate };
