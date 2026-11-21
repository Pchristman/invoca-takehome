// Formatting for the web app: dates, labels and small counts.
// Dates are 'YYYY-MM-DD' strings. They are formatted in UTC from the parsed year, month and day,
// so the viewer's own time zone can never move a date.

import { formatCount } from '../core/views/format';

/** Shown where a value is empty or not applicable: the em dash. */
export const BLANK = '\u2014';

const upToTwoDecimals = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** A threshold shown as it is, to two decimals with no trailing zeros: 3 is "3", 2.5 is "2.5". */
export function formatThreshold(n: number): string {
  return upToTwoDecimals.format(n);
}

const EN_DASH = '\u2013';

const longDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

/** The date as a UTC instant, or null when the text is not a real YYYY-MM-DD date. */
function parseDate(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Round trip: a month 13 or a day 30 of February roll over into another date, so they are rejected.
  const same = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return same ? date : null;
}

export function formatLongDate(date: string): string {
  const parsed = parseDate(date);
  return parsed ? longDate.format(parsed) : date;
}

export function formatShortDate(date: string): string {
  const parsed = parseDate(date);
  return parsed ? shortDate.format(parsed) : date;
}

/** 'Sep 1 – Sep 14, 2026'. Across years both ends carry the year. One day shows just that day. */
export function formatDateSpan(start: string, end: string): string {
  const from = parseDate(start);
  const to = parseDate(end);
  if (!from || !to) return `${start} ${EN_DASH} ${end}`;
  if (start === end) return longDate.format(from);
  if (from.getUTCFullYear() !== to.getUTCFullYear()) {
    return `${longDate.format(from)} ${EN_DASH} ${longDate.format(to)}`;
  }
  return `${shortDate.format(from)} ${EN_DASH} ${longDate.format(to)}`;
}

/** Null when nothing was skipped, so the caller shows nothing. */
export function formatSkippedRows(n: number): string | null {
  if (n === 0) return null;
  return `${formatCount(n, ['row', 'rows'])} skipped`;
}

/** 'paid_search' becomes 'Paid search'. Null or empty gives the blank. */
export function humanize(value: string | null): string {
  if (!value) return BLANK;
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** AI spend is cents or less, so four decimals. */
export function formatSpendUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/** True only for a real calendar date written YYYY-MM-DD (so not Feb 30, and not "nope"). */
export function isIsoDate(value: string): boolean {
  return parseDate(value) !== null;
}
