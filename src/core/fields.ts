// Pure field parsers. Each trims its input, returns null when the value is not valid, and never throws.

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Strict ISO 8601 UTC: `Z` only, and a real calendar date and time. */
export function parseTimestamp(s: string): Date | null {
  const text = s.trim();
  if (!TIMESTAMP.test(text)) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  // Date can shift an impossible value (02-30, 24:00) instead of rejecting it; the round trip catches that.
  return date.toISOString().slice(0, 19) === text.slice(0, 19) ? date : null;
}

export function parseBoolean(s: string): boolean | null {
  const text = s.trim().toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return null;
}

/** Case-sensitive: the allowed values are the documented column contract. */
export function parseEnum<T extends string>(s: string, allowed: readonly T[]): T | null {
  const text = s.trim();
  return allowed.find((value) => value === text) ?? null;
}

export function parseInteger(s: string): number | null {
  const text = s.trim();
  return /^-?\d+$/.test(text) ? Number(text) : null;
}

/** Plain decimal such as `432.50`. No currency symbol, thousands separator or exponent. */
export function parseMoney(s: string): number | null {
  const text = s.trim();
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}

export function isValidTimeZone(tz: string): boolean {
  if (tz.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}
