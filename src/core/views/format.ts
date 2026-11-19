// Display formatting for view text. Fixed 'en-US' locale so output never varies by machine.
// Each function rounds first, then formats, so a value that rounds to zero loses its sign.

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Round half away from zero to the given number of decimals, and never return -0.
function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * scale)) / scale;
  return rounded === 0 ? 0 : rounded;
}

export function formatUsd(usd: number): string {
  const rounded = roundTo(usd, 0);
  return `${rounded < 0 ? '-' : ''}$${whole.format(Math.abs(rounded))}`;
}

export function formatRate(fraction: number): string {
  return `${oneDecimal.format(roundTo(fraction * 100, 1))}%`;
}

export function formatCount(n: number, noun?: readonly [singular: string, plural: string]): string {
  const number = whole.format(n);
  if (!noun) return number;
  return `${number} ${n === 1 ? noun[0] : noun[1]}`;
}

export function formatWeekday(weekday: number): string {
  return WEEKDAYS[weekday] ?? String(weekday);
}

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function signedOneDecimal(value: number): string {
  const rounded = roundTo(value, 1);
  return `${rounded > 0 ? '+' : ''}${oneDecimal.format(rounded)}`;
}

export function formatPercentChange(value: number): string {
  return `${signedOneDecimal(value)}%`;
}

export function formatPointsChange(value: number): string {
  return `${signedOneDecimal(value)} points`;
}
