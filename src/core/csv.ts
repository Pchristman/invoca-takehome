import { parse } from 'csv-parse/sync';
import { LoadError } from './errors';

export interface Table {
  file: string;
  /** One record per data row, keyed by trimmed header name. Missing cells are "". */
  rows: Record<string, string>[];
  /** True when there are no data rows (zero-byte file, or header only). */
  isEmpty: boolean;
}

/**
 * Turn CSV text into header-keyed rows. Columns are matched by name, never position.
 * Throws LoadError if a required column is missing or the quoting is broken.
 */
export function readTable(text: string, file: string, required: readonly string[]): Table {
  // Nothing to read, and no header to check columns against.
  if (text.trim() === '') return { file, rows: [], isEmpty: true };

  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as string[][];
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new LoadError(`${file}: could not read the CSV (${reason})`);
  }

  const header = (records[0] ?? []).map((name) => name.trim());
  for (const column of required) {
    if (!header.includes(column)) {
      throw new LoadError(`${file}: missing required column "${column}"`);
    }
  }

  const rows = records.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    header.forEach((name, i) => {
      row[name] = cells[i] ?? '';
    });
    return row;
  });
  return { file, rows, isEmpty: rows.length === 0 };
}
