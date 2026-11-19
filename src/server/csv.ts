import type { CallbackRow } from '../core/views/callbacks';

type Cell = string | number | null;

// Spreadsheets run a cell that starts with one of these as a formula.
// A leading ' makes it plain text. It also shows on tracking numbers,
// which start with +, so they appear as '+1... in the file.
const FORMULA_STARTS = ['=', '+', '-', '@', '\t', '\r'];

export function csvCell(value: Cell): string {
  if (value === null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Cannot write ${value} to CSV`);
    return String(value);
  }
  const safe = FORMULA_STARTS.some((c) => value.startsWith(c)) ? `'${value}` : value;
  return /[,"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(columns: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const lines = [columns.map(csvCell).join(',')];
  rows.forEach((row, i) => {
    if (row.length !== columns.length) {
      throw new Error(`CSV row ${i + 1} has ${row.length} cells, expected ${columns.length}`);
    }
    lines.push(row.map(csvCell).join(','));
  });
  return lines.map((line) => `${line}\r\n`).join('');
}

export function callbacksToCsv(rows: readonly CallbackRow[]): string {
  return toCsv(
    [
      'caller_hash',
      'unanswered_attempts',
      'last_attempt_local',
      'office',
      'campaign',
      'tracking_number',
      'estimated_value_usd',
    ],
    rows.map((r) => [
      r.callerHash,
      r.unansweredAttempts,
      r.lastAttemptLocal,
      r.officeName,
      r.campaignName,
      r.trackingNumber,
      r.estimatedValueUsd.toFixed(2),
    ]),
  );
}
