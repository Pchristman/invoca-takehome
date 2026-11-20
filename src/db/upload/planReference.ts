import type { DatabaseSync } from 'node:sqlite';
import type { Table } from '../../core/csv';
import { parseCampaigns, parseLocations } from '../../core/reference';
import type { Campaign, Location, ReferenceIssue } from '../../core/types';
import { readCampaigns, readLocations } from '../read';
import type { ParsedUpload } from './detect';
import {
  EXAMPLES_PER_CLASS,
  NOTE_MAX,
  shorten,
  type RowClass,
  type UploadCounts,
  type UploadExample,
  type UploadPlan,
} from './types';

/** What differs between two versions of a row: field name and the two values, as text. */
type Diff = { field: string; stored: string; incoming: string };

/** Everything that differs between campaigns and locations, so one loop can classify both. */
interface Spec<T extends { id: string }> {
  idColumn: string;
  readStored(db: DatabaseSync): T[];
  /** Validates one row on its own (as a one-row table); issues come back for that row. */
  parseRow(table: Table): { rows: T[]; issues: ReferenceIssue[] };
  differences(stored: T, incoming: T): Diff[];
}

const campaignSpec: Spec<Campaign> = {
  idColumn: 'campaign_id',
  readStored: readCampaigns,
  parseRow: (table) => {
    const { campaigns, issues } = parseCampaigns(table);
    return { rows: campaigns, issues };
  },
  differences: (a, b) =>
    [
      { field: 'name', stored: a.name, incoming: b.name },
      { field: 'channel', stored: a.channel, incoming: b.channel },
      { field: 'budget', stored: String(a.dailyBudgetUsd), incoming: String(b.dailyBudgetUsd) },
    ].filter((d) => d.stored !== d.incoming),
};

const locationSpec: Spec<Location> = {
  idColumn: 'location_id',
  readStored: readLocations,
  parseRow: (table) => {
    const { locations, issues } = parseLocations(table);
    return { rows: locations, issues };
  },
  differences: (a, b) =>
    [
      { field: 'name', stored: a.name, incoming: b.name },
      { field: 'time zone', stored: a.timezone, incoming: b.timezone },
    ].filter((d) => d.stored !== d.incoming),
};

/** Numbers are shown bare; names and zones in quotes so spaces are visible. */
const show = (field: string, value: string) => (field === 'budget' ? shorten(value, NOTE_MAX) : `"${shorten(value, NOTE_MAX)}"`);

function describe(diffs: Diff[], storedPlace: string, incomingPlace: string): string {
  return diffs
    .map((d) => `${d.field} is ${show(d.field, d.stored)} ${storedPlace}, ${show(d.field, d.incoming)} ${incomingPlace}`)
    .join('; ');
}

function classify<T extends { id: string }>(
  db: DatabaseSync,
  upload: ParsedUpload,
  spec: Spec<T>,
): { preview: UploadPlan['preview']; planned: T[] } {
  const stored = new Map(spec.readStored(db).map((r) => [r.id, r]));
  const seenInFile = new Map<string, { row: number; value: T }>();
  const planned: T[] = [];

  const counts: UploadCounts = { rowsRead: 0, newRows: 0, newVersions: 0, duplicates: 0, conflicts: 0, bad: 0 };
  const examples: Record<RowClass, UploadExample[]> = { new: [], new_version: [], duplicate: [], conflict: [], bad: [] };
  const badByReason: Record<string, number> = {};

  const record = (cls: RowClass, row: number, id: string, note: string) => {
    if (examples[cls].length < EXAMPLES_PER_CLASS) examples[cls].push({ row, id: shorten(id, 40), note });
  };

  upload.table.rows.forEach((raw, index) => {
    const row = index + 1;
    counts.rowsRead += 1;

    const oneRow: Table = { file: upload.fileName, header: upload.table.header, rows: [raw], isEmpty: false };
    const { rows, issues } = spec.parseRow(oneRow);
    const issue = issues[0];
    const value = rows[0];

    // Any issue makes the row bad, even when the loader would keep it (an invalid time zone).
    if (issue || !value) {
      counts.bad += 1;
      const reason = issue?.reason ?? 'invalid_row';
      badByReason[reason] = (badByReason[reason] ?? 0) + 1;
      record('bad', row, (raw[spec.idColumn] ?? '').trim(), shorten(issue?.detail ?? 'row could not be read', NOTE_MAX));
      return;
    }

    const earlier = seenInFile.get(value.id);
    const known = stored.get(value.id);

    if (earlier) {
      const diffs = spec.differences(earlier.value, value);
      if (diffs.length === 0) {
        counts.duplicates += 1;
        record('duplicate', row, value.id, `repeated in this file (row ${earlier.row})`);
      } else {
        counts.conflicts += 1;
        record('conflict', row, value.id, `differs from row ${earlier.row} in this file: ${describe(diffs, `in row ${earlier.row}`, 'in this row')}`);
      }
    } else if (known) {
      const diffs = spec.differences(known, value);
      if (diffs.length === 0) {
        counts.duplicates += 1;
        record('duplicate', row, value.id, 'already in the database with the same values');
      } else {
        counts.conflicts += 1;
        record('conflict', row, value.id, describe(diffs, 'in the database', 'in this file'));
      }
    } else {
      seenInFile.set(value.id, { row, value });
      planned.push(value);
      counts.newRows += 1;
      record('new', row, value.id, 'not in the database yet');
    }
  });

  return {
    preview: { kind: upload.kind, fileName: upload.fileName, counts, examples, badByReason, hints: [] },
    planned,
  };
}

/**
 * Classifies a campaigns or locations upload against what is stored. Read-only.
 * Same id and same values is a duplicate; same id and different values is a conflict and is not planned.
 */
export function planReferenceUpload(db: DatabaseSync, upload: ParsedUpload): UploadPlan {
  if (upload.kind === 'campaigns') {
    const { preview, planned } = classify(db, upload, campaignSpec);
    return { kind: 'campaigns', preview, campaigns: planned };
  }
  if (upload.kind === 'locations') {
    const { preview, planned } = classify(db, upload, locationSpec);
    return { kind: 'locations', preview, locations: planned };
  }
  throw new Error(`planReferenceUpload does not handle ${upload.kind} files`);
}
