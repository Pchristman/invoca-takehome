import { createHash } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { LoadedExport, RowResult } from '../core/types';
import { refreshCleanedCalls } from './cleaned';

export interface SeedSource {
  /** The folder as shown to the user. */
  label: string;
  /** SHA-256 hex of each file's text; empty strings for a source that has no files. */
  hashes: { calls: string; campaigns: string; locations: string };
}

export interface SeedReport {
  seedId: number;
  rowsRead: number;
  /** Good and bad rows not seen before. */
  newRows: number;
  /** Rows already stored (the same export seeded again). */
  duplicateRows: number;
  /** New rows whose call_id already had a stored row before this seed. */
  newVersions: number;
  badRowsNew: number;
  /** Calls in cleaned_calls after this seed. */
  callsAfter: number;
}

type GoodRow = Extract<RowResult, { ok: true }>;
type BadRowResult = Extract<RowResult, { ok: false }>;

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

/**
 * What identifies a row: its stored values. The row number is left out so the same row at a different
 * position in a newer export is still the same row.
 */
function rowFields(row: RowResult): unknown[] {
  if (!row.ok) {
    const { callId, updatedAt, reason, detail } = row.bad;
    return ['bad', callId, iso(updatedAt), reason, detail];
  }
  const c = row.call;
  return [
    'good', c.callId, iso(c.startedAt), iso(c.endedAt), c.durationSeconds, c.callerHash, c.trackingNumber,
    c.campaignId, c.channel, c.locationId, c.answered, c.outcome, c.revenueUsd, c.agentId, iso(c.updatedAt),
  ];
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Write one export into the database in a single transaction. Identical rows are stored once per
 * occurrence in the file, so seeding the same export again adds nothing, while a file that really
 * holds two identical rows keeps both. Never builds SQL from data.
 */
export function seedExport(db: DatabaseSync, loaded: LoadedExport, source: SeedSource, now: Date = new Date()): SeedReport {
  db.exec('BEGIN IMMEDIATE');
  try {
    const report = writeSeed(db, loaded, source, now);
    report.callsAfter = refreshCleanedCalls(db);
    db.exec('COMMIT');
    return report;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function writeSeed(db: DatabaseSync, loaded: LoadedExport, source: SeedSource, now: Date): SeedReport {
  const seedId = Number(
    db
      .prepare('INSERT INTO seeds (seeded_at, label, calls_sha256, campaigns_sha256, locations_sha256, rows_read) VALUES (?, ?, ?, ?, ?, ?)')
      .run(now.toISOString(), source.label, source.hashes.calls, source.hashes.campaigns, source.hashes.locations, loaded.rowsRead).lastInsertRowid,
  );

  const upsertCampaign = db.prepare(
    `INSERT INTO campaigns (id, name, channel, daily_budget_usd) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, channel = excluded.channel, daily_budget_usd = excluded.daily_budget_usd`,
  );
  for (const c of loaded.campaigns) upsertCampaign.run(c.id, c.name, c.channel, c.dailyBudgetUsd);

  const upsertLocation = db.prepare(
    `INSERT INTO locations (id, name, timezone, timezone_valid) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, timezone = excluded.timezone, timezone_valid = excluded.timezone_valid`,
  );
  for (const l of loaded.locations) upsertLocation.run(l.id, l.name, l.timezone, l.timezoneValid ? 1 : 0);

  const insertIssue = db.prepare('INSERT OR IGNORE INTO reference_issues (seed_id, file, row_number, reason, detail) VALUES (?, ?, ?, ?, ?)');
  for (const i of loaded.referenceIssues) insertIssue.run(seedId, i.file, i.rowNumber, i.reason, i.detail);

  const insertGood = db.prepare(
    `INSERT INTO raw_calls (seq, row_key, seed_id, row_number, call_id, started_at, ended_at, duration_seconds, caller_hash, tracking_number,
       campaign_id, channel, location_id, answered, outcome, revenue_usd, agent_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(row_key) DO NOTHING`,
  );
  const insertBad = db.prepare(
    `INSERT INTO bad_rows (seq, row_key, seed_id, row_number, call_id, updated_at, reason, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(row_key) DO NOTHING`,
  );
  const hadCall = db.prepare('SELECT 1 FROM raw_calls WHERE call_id = ? AND seq <= ? UNION ALL SELECT 1 FROM bad_rows WHERE call_id = ? AND seq <= ?');

  const maxBefore = (
    db.prepare('SELECT MAX(COALESCE((SELECT MAX(seq) FROM raw_calls), 0), COALESCE((SELECT MAX(seq) FROM bad_rows), 0)) AS m').get() as { m: number }
  ).m;
  let nextSeq = maxBefore + 1;
  const seen = new Map<string, number>();
  const report: SeedReport = { seedId, rowsRead: loaded.rowsRead, newRows: 0, duplicateRows: 0, newVersions: 0, badRowsNew: 0, callsAfter: 0 };

  for (const row of loaded.rows) {
    const hash = sha256(JSON.stringify(rowFields(row)));
    const occurrence = seen.get(hash) ?? 0;
    seen.set(hash, occurrence + 1);
    const rowKey = `${hash}#${occurrence}`;

    const changes = row.ok ? insertGoodRow(insertGood, row, nextSeq, rowKey, seedId) : insertBadRow(insertBad, row, nextSeq, rowKey, seedId);
    if (changes === 0) {
      report.duplicateRows += 1;
      continue;
    }
    nextSeq += 1;
    report.newRows += 1;
    if (!row.ok) report.badRowsNew += 1;
    const callId = row.ok ? row.call.callId : row.bad.callId;
    if (callId !== '' && hadCall.get(callId, maxBefore, callId, maxBefore)) report.newVersions += 1;
  }
  return report;
}

function insertGoodRow(stmt: StatementSync, row: GoodRow, seq: number, rowKey: string, seedId: number): number {
  const c = row.call;
  const result = stmt.run(
    seq, rowKey, seedId, c.rowNumber, c.callId, c.startedAt.toISOString(), iso(c.endedAt), c.durationSeconds, c.callerHash, c.trackingNumber,
    c.campaignId, c.channel, c.locationId, c.answered ? 1 : 0, c.outcome, c.revenueUsd, c.agentId, iso(c.updatedAt),
  );
  return Number(result.changes);
}

function insertBadRow(stmt: StatementSync, row: BadRowResult, seq: number, rowKey: string, seedId: number): number {
  const b = row.bad;
  return Number(stmt.run(seq, rowKey, seedId, b.rowNumber, b.callId, iso(b.updatedAt), b.reason, b.detail).changes);
}
