export interface LocalParts {
  /** Local calendar date, "YYYY-MM-DD". */
  date: string;
  /** 0-23. */
  hour: number;
  /** 0 = Monday ... 6 = Sunday. */
  weekday: number;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// One formatter per zone: building one is slow, and every call needs one.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // h23 keeps midnight at 0; hour12:false can report 24.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

/** "YYYY-MM-DD HH:mm" in the zone, hour 00-23. `timeZone` is a valid IANA name. */
export function localDateTime(instant: Date, timeZone: string): string {
  let formatter = dateTimeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    dateTimeFormatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** The office's local date, hour and weekday for a UTC instant. `timeZone` is a valid IANA name. */
export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) parts[part.type] = part.value;
  const weekday = WEEKDAYS.indexOf(parts.weekday!);
  if (weekday === -1) throw new Error(`unexpected weekday "${parts.weekday}" for zone ${timeZone}`);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    weekday,
  };
}
