/** A calendar date with no time zone: "YYYY-MM-DD". Sorts correctly as a string. */
export type LocalDate = string;

const MS_PER_DAY = 86_400_000;

// Only Date.UTC and the getUTC* methods are used here: a plain calendar date has no zone, so no DST.
function toUtcMs(date: LocalDate): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year!, month! - 1, day!);
}

function fromUtcMs(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** True for a strict "YYYY-MM-DD" that is a real calendar date (no 2026-02-30, no 2026-2-3). */
export function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // An impossible date shifts when it goes through Date.UTC, so it fails the round trip.
  return fromUtcMs(toUtcMs(value)) === value;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}

/** `to` minus `from` in whole days; negative when `to` is earlier. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

/** The Monday on or before `date`. Monday is 0 here, matching CleanCall.localWeekday. */
export function weekStart(date: LocalDate): LocalDate {
  const weekday = (new Date(toUtcMs(date)).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}
