import { readTable, type Table } from '../../core/csv';
import { LoadError } from '../../core/errors';
import { sha256 } from '../seed';
import { shorten } from '../../server/api';
import { UPLOAD_COLUMNS, UploadRejected, type UploadKind } from './types';

export interface ParsedUpload {
  kind: UploadKind;
  fileName: string;
  table: Table;
  /** SHA-256 hex of the file text. */
  textSha256: string;
}

const KINDS: UploadKind[] = ['calls', 'campaigns', 'locations'];

function readOrReject(text: string, fileName: string, required: readonly string[]): Table {
  try {
    return readTable(text, fileName, required);
  } catch (err) {
    if (err instanceof LoadError) throw new UploadRejected('bad_csv', err.message);
    throw err;
  }
}

/** Work out which kind of file this is from its header columns, whatever their order. Throws UploadRejected. */
export function readUpload(fileName: string, text: string): ParsedUpload {
  const first = readOrReject(text, fileName, []);
  if (first.header.length === 0) {
    throw new UploadRejected('empty', `${fileName} is empty. Choose a calls, campaigns or locations CSV.`);
  }

  const missing = (kind: UploadKind) => UPLOAD_COLUMNS[kind].filter((c) => !first.header.includes(c));
  const matches = KINDS.filter((kind) => missing(kind).length === 0);

  if (matches.length > 1) {
    throw new UploadRejected(
      'ambiguous_columns',
      `${fileName} matches more than one kind (${matches.join(', ')}). Upload each kind as its own file.`,
    );
  }

  if (matches.length === 0) {
    const found = first.header.map((cell) => shorten(cell, 40)).join(', ');
    let message =
      `${fileName} is not a calls, campaigns or locations file. It has the columns: ${found}. ` +
      KINDS.map((kind) => `A ${kind} file needs: ${UPLOAD_COLUMNS[kind].join(', ')}.`).join(' ');
    // Only a little short of a kind: say which one and what is missing.
    const closest = [...KINDS].sort((a, b) => missing(a).length - missing(b).length)[0]!;
    const gap = missing(closest);
    if (gap.length <= 2 && gap.length < UPLOAD_COLUMNS[closest].length) {
      message += ` The closest is ${closest} (missing: ${gap.join(', ')}).`;
    }
    throw new UploadRejected('unknown_columns', message);
  }

  const kind = matches[0]!;
  return {
    kind,
    fileName,
    // Parsed again with the kind's columns so a repeated column gets the usual message.
    table: readOrReject(text, fileName, UPLOAD_COLUMNS[kind]),
    textSha256: sha256(text),
  };
}
