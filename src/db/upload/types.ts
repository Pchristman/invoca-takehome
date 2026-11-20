import type { Call, Campaign, Location } from '../../core/types';
import { CAMPAIGN_COLUMNS, LOCATION_COLUMNS } from '../../core/reference';
import { CALL_COLUMNS } from '../../core/validate';

export type UploadKind = 'calls' | 'campaigns' | 'locations';

/** The columns each kind of file must have. */
export const UPLOAD_COLUMNS: Record<UploadKind, readonly string[]> = {
  calls: CALL_COLUMNS,
  campaigns: CAMPAIGN_COLUMNS,
  locations: LOCATION_COLUMNS,
};

export type UploadRejectReason =
  | 'empty'
  | 'not_csv'
  | 'unknown_columns'
  | 'ambiguous_columns'
  | 'bad_csv'
  | 'too_large'
  | 'no_file';

/** The file cannot be used. The message is the full sentence for the user. */
export class UploadRejected extends Error {
  constructor(
    readonly reason: UploadRejectReason,
    message: string,
  ) {
    super(message);
    this.name = 'UploadRejected';
  }
}

/** A write that rolled back. The message says nothing was stored. */
export class UploadFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadFailed';
  }
}

/** What the preview says about one row of the file. The five classes add up to the rows read. */
export type RowClass = 'new' | 'new_version' | 'duplicate' | 'conflict' | 'bad';

/** One row shown as an example. `row` is the 1-based data row in the file (header excluded); `id` is shortened to 40 characters. */
export interface UploadExample {
  row: number;
  id: string;
  note: string;
}

export const EXAMPLES_PER_CLASS = 5;

/** Cut text to `max` characters plus "...", so a huge cell cannot flood a preview. */
export const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}...` : text);

/** The longest a note or a quoted cell may be in a preview. */
export const NOTE_MAX = 100;

export interface UploadCounts {
  rowsRead: number;
  newRows: number;
  newVersions: number;
  duplicates: number;
  conflicts: number;
  bad: number;
}

/** What an upload would add. Computed on the server; the web only formats it. */
export interface UploadPreview {
  kind: UploadKind;
  fileName: string;
  counts: UploadCounts;
  examples: Record<RowClass, UploadExample[]>;
  badByReason: Record<string, number>;
  hints: string[];
}

/** The preview plus the rows to write, in file order. */
export type UploadPlan = { preview: UploadPreview } & (
  | { kind: 'calls'; calls: Call[] }
  | { kind: 'campaigns'; campaigns: Campaign[] }
  | { kind: 'locations'; locations: Location[] }
);
