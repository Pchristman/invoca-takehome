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

/** Whole numbers only, and only ones a JS number holds exactly. `-0` becomes plain 0. */
export function parseInteger(s: string): number | null {
  const text = s.trim();
  if (!/^-?\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n + 0 : null;
}

/** Plain decimal such as `432.50`. No currency symbol, thousands separator or exponent. `-0` becomes plain 0. */
export function parseMoney(s: string): number | null {
  const text = s.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n + 0 : null;
}

/**
 * The canonical IANA name for a time zone, or null. Intl also accepts UTC offsets such as "+05:00"
 * (no daylight saving, not an IANA zone), so those are rejected. tzdb aliases such as "EST" are
 * IANA identifiers and are accepted.
 */
export function normalizeTimeZone(tz: string): string | null {
  const name = tz.trim();
  if (name === '' || /^[+-]/.test(name)) return null;
  try {
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;
    return /^[+-]/.test(canonical) ? null : canonical;
  } catch {
    return null;
  }
}

export function isValidTimeZone(tz: string): boolean {
  return normalizeTimeZone(tz) !== null;
}
