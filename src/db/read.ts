import type { DatabaseSync } from 'node:sqlite';
import { cleanExport } from '../core/clean';
import { LoadError } from '../core/errors';
import {
  BAD_REASONS,
  type BadReason,
  type CallStore,
  type Campaign,
  type Channel,
  type LoadedExport,
  type Location,
  type Outcome,
  type ReferenceIssue,
  type RowResult,
} from '../core/types';
import { convertDatabaseError } from './database';

/** What a SQLite row looks like to us: column name to value. */
type Row = Record<string, string | number | null>;

const text = (value: unknown) => value as string;
const maybeText = (value: unknown) => (value === null ? null : (value as string));
const date = (value: unknown) => new Date(value as string);
const maybeDate = (value: unknown) => (value === null ? null : new Date(value as string));

function goodRow(r: Row): RowResult {
  return {
    ok: true,
    call: {
      rowNumber: r.row_number as number,
      callId: text(r.call_id),
      startedAt: date(r.started_at),
      endedAt: maybeDate(r.ended_at),
      durationSeconds: r.duration_seconds as number,
      callerHash: text(r.caller_hash),
      trackingNumber: text(r.tracking_number),
      campaignId: maybeText(r.campaign_id),
      channel: r.channel as Channel,
      locationId: text(r.location_id),
      answered: r.answered === 1,
      outcome: r.outcome as Outcome | null,
      revenueUsd: r.revenue_usd as number | null,
      agentId: maybeText(r.agent_id),
      updatedAt: maybeDate(r.updated_at),
    },
  };
}

function badRow(r: Row): RowResult {
  return {
    ok: false,
    bad: {
      rowNumber: r.row_number as number,
      callId: text(r.call_id),
      updatedAt: maybeDate(r.updated_at),
      reason: r.reason as BadReason,
      detail: text(r.detail),
    },
  };
}

function selectAll(db: DatabaseSync, sql: string): Row[] {
  return db.prepare(sql).all() as Row[];
}

/** The notes loadExport gives for an empty file. A table that is empty but has skipped rows (reference issues) was not an empty file. */
function emptyNotes(calls: number, campaigns: number, locations: number, issues: ReferenceIssue[]): string[] {
  const notes: string[] = [];
  if (calls === 0) notes.push('calls.csv is empty: starting with zero calls');
  if (campaigns === 0 && !issues.some((i) => i.file === 'campaigns.csv')) notes.push('campaigns.csv is empty: starting with zero campaigns');
  if (locations === 0 && !issues.some((i) => i.file === 'locations.csv')) notes.push('locations.csv is empty: starting with zero locations');
  return notes;
}

function readTables(db: DatabaseSync): LoadedExport {
  const campaigns: Campaign[] = selectAll(db, 'SELECT * FROM campaigns ORDER BY rowid').map((r) => ({
    id: text(r.id),
    name: text(r.name),
    channel: r.channel as Channel,
    dailyBudgetUsd: r.daily_budget_usd as number,
  }));
  const locations: Location[] = selectAll(db, 'SELECT * FROM locations ORDER BY rowid').map((r) => ({
    id: text(r.id),
    name: text(r.name),
    timezone: text(r.timezone),
    timezoneValid: r.timezone_valid === 1,
  }));
  const referenceIssues: ReferenceIssue[] = selectAll(db, 'SELECT * FROM reference_issues ORDER BY id').map((r) => ({
    file: r.file as ReferenceIssue['file'],
    rowNumber: r.row_number as number,
    reason: text(r.reason),
    detail: text(r.detail),
  }));

  // Both tables share one seq counter, so merging by seq gives back the order the rows were stored in.
  const storedRows = [
    ...selectAll(db, 'SELECT * FROM raw_calls').map((r) => ({ seq: r.seq as number, row: goodRow(r) })),
    ...selectAll(db, 'SELECT * FROM bad_rows').map((r) => ({ seq: r.seq as number, row: badRow(r) })),
  ]
    .sort((a, b) => a.seq - b.seq)
    .map((entry) => entry.row);
  // A later seed may have replaced an office's time zone with an invalid one. Calls stored under the old, valid zone cannot
  // be localized any more, so they are bad (the same reason the CSV route gives), not a crash in cleanExport.
  const invalidZone = new Set(locations.filter((l) => !l.timezoneValid).map((l) => l.id));
  const rows: RowResult[] = storedRows.map((row) =>
    row.ok && invalidZone.has(row.call.locationId)
      ? {
          ok: false,
          bad: {
            rowNumber: row.call.rowNumber,
            callId: row.call.callId,
            updatedAt: row.call.updatedAt,
            reason: 'invalid_timezone',
            detail: `location "${row.call.locationId}" has an invalid time zone`,
          },
        }
      : row,
  );
  const badByReason = Object.fromEntries(BAD_REASONS.map((reason) => [reason, 0])) as Record<BadReason, number>;
  let unparseableUpdatedAt = 0;
  let unparseableEndedAt = 0;
  for (const row of rows) {
    if (row.ok) {
      if (row.call.updatedAt === null) unparseableUpdatedAt += 1;
      if (row.call.endedAt === null) unparseableEndedAt += 1;
    } else {
      badByReason[row.bad.reason] += 1;
      if (row.bad.updatedAt === null) unparseableUpdatedAt += 1;
    }
  }

  return {
    campaigns,
    locations,
    rows,
    rowsRead: rows.length,
    badByReason,
    unparseableUpdatedAt,
    unparseableEndedAt,
    referenceIssues,
    notes: emptyNotes(rows.length, campaigns.length, locations.length, referenceIssues),
  };
}

/** Rebuild what loadExport returned, from the raw tables. */
export function readLoadedExport(db: DatabaseSync): LoadedExport {
  try {
    return readTables(db);
  } catch (error) {
    throw convertDatabaseError(db.location() ?? ':memory:', error);
  }
}

/** The one cleaning code path: the same cleanExport the CSV route uses. */
export function readStore(db: DatabaseSync): CallStore {
  return cleanExport(readLoadedExport(db));
}
