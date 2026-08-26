'use strict';

/** Date helpers used by age eligibility and compliance windows. */

/** Whole years between a date of birth and a reference instant. */
function calculateAge(dateOfBirth, reference = new Date()) {
  if (!dateOfBirth) return null;
  const dob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  let age = reference.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = reference.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && reference.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

function isAtLeastAge(dateOfBirth, minimumAge, reference = new Date()) {
  const age = calculateAge(dateOfBirth, reference);
  return age !== null && age >= minimumAge;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function isPast(date) {
  return !!date && new Date(date).getTime() < Date.now();
}

/** "HH:MM" or "HH:MM:SS" -> minutes since midnight. */
function timeToMinutes(time) {
  if (!time) return null;
  const [h, m] = String(time).split(':').map((v) => Number.parseInt(v, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** Local wall-clock minutes since midnight for a reference instant. */
function currentMinutesOfDay(reference = new Date()) {
  return reference.getHours() * 60 + reference.getMinutes();
}

/**
 * Is `now` inside the [start, end] window? Windows that wrap past midnight
 * (e.g. 17:00-01:00) are supported.
 */
function isWithinTimeWindow(startTime, endTime, reference = new Date()) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null) return true; // no window configured
  const now = currentMinutesOfDay(reference);
  return start <= end ? now >= start && now <= end : now >= start || now <= end;
}

/** YYYY-MM-DD in local time, for DATEONLY columns. */
function toDateOnly(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

module.exports = {
  calculateAge,
  isAtLeastAge,
  addMinutes,
  addDays,
  isPast,
  timeToMinutes,
  currentMinutesOfDay,
  isWithinTimeWindow,
  toDateOnly,
};
