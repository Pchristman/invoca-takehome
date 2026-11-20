import { parse } from 'csv-parse/sync';
import { LoadError } from './errors';

export interface Table {
  file: string;
  /** The trimmed header names, in file order. Empty for a zero-byte file. */
  header: string[];
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
  if (text.trim() === '') return { file, header: [], rows: [], isEmpty: true };

  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      // Without this csv-parse picks one line ending from the first line and silently merges rows in a mixed file.
      record_delimiter: ['\r\n', '\n', '\r'],
      // A stray quote inside a field stays as text; only a quote never closed is an error.
      relax_quotes: true,
    }) as string[][];
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new LoadError(`${file}: could not read the CSV (${reason})`);
  }

  const header = (records[0] ?? []).map((name) => name.trim());
  for (const column of required) {
    const count = header.filter((name) => name === column).length;
    if (count === 0) throw new LoadError(`${file}: missing required column "${column}"`);
    if (count > 1) throw new LoadError(`${file}: column "${column}" appears more than once`);
  }

  const rows = records.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    header.forEach((name, i) => {
      row[name] = cells[i] ?? '';
    });
    return row;
  });
  return { file, header, rows, isEmpty: rows.length === 0 };
}
