import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { CallStore } from '../../core/types';
import { rebuildCleanedCalls } from '../cleaned';
import { convertDatabaseError } from '../database';
import { readStore } from '../read';
import { prepareRowInserts, rowHash } from '../seed';
import type { ParsedUpload } from './detect';
import { planUpload } from './plan';
import { UploadFailed, type UploadPlan, type UploadPreview } from './types';

export interface UploadCommit {
  /** What this write really did, classified inside the transaction (not what an earlier preview said). */
  preview: UploadPreview;
  written: number;
  /** The store rebuilt from the database after the write; null when nothing was written. */
  store: CallStore | null;
}

const KIND_HASH_COLUMN = { calls: 'calls_sha256', campaigns: 'campaigns_sha256', locations: 'locations_sha256' } as const;

/** One seeds row for the upload (raw_calls.seed_id needs one). Only the hash column of its own kind is filled. */
function insertSeed(db: DatabaseSync, upload: ParsedUpload, rowsRead: number, now: Date): number {
  const hashes = { calls_sha256: '', campaigns_sha256: '', locations_sha256: '', [KIND_HASH_COLUMN[upload.kind]]: upload.textSha256 };
  const result = db
    .prepare('INSERT INTO seeds (seeded_at, label, calls_sha256, campaigns_sha256, locations_sha256, rows_read) VALUES (?, ?, ?, ?, ?, ?)')
    .run(now.toISOString(), `upload: ${upload.fileName}`, hashes.calls_sha256, hashes.campaigns_sha256, hashes.locations_sha256, rowsRead);
  return Number(result.lastInsertRowid);
}

function writeRows(db: DatabaseSync, plan: UploadPlan, seedId: number): void {
  if (plan.kind === 'campaigns') {
    const insert = db.prepare('INSERT INTO campaigns (id, name, channel, daily_budget_usd) VALUES (?, ?, ?, ?)');
    for (const c of plan.campaigns) insert.run(c.id, c.name, c.channel, c.dailyBudgetUsd);
    return;
  }
  if (plan.kind === 'locations') {
    const insert = db.prepare('INSERT INTO locations (id, name, timezone, timezone_valid) VALUES (?, ?, ?, ?)');
    for (const l of plan.locations) insert.run(l.id, l.name, l.timezone, l.timezoneValid ? 1 : 0);
    return;
  }

  // raw_calls and bad_rows share one seq counter, so the new rows continue after the highest of both.
  const { m } = db
    .prepare('SELECT MAX(COALESCE((SELECT MAX(seq) FROM raw_calls), 0), COALESCE((SELECT MAX(seq) FROM bad_rows), 0)) AS m')
    .get() as { m: number };
  let seq = m + 1;
  const { insertGood } = prepareRowInserts(db);
  for (const c of plan.calls) {
    const rowKey = `${rowHash({ ok: true, call: c })}#0`;
    insertGood.run(
      seq, rowKey, seedId, c.rowNumber, c.callId, c.startedAt.toISOString(), c.endedAt?.toISOString() ?? null, c.durationSeconds, c.callerHash,
      c.trackingNumber, c.campaignId, c.channel, c.locationId, c.answered ? 1 : 0, c.outcome, c.revenueUsd, c.agentId, c.updatedAt?.toISOString() ?? null,
    );
    seq += 1;
  }
}

/** A database error message without the file's path: the message goes to the browser, which has no use for where the file lives. */
export function withoutPath(message: string, path: string | null | undefined): string {
  if (!path || path === ':memory:') return message;
  let out = message;
  for (const p of new Set([path, resolve(path)])) out = out.split(`the database ${p}`).join('the database').split(p).join('the database file');
  return out;
}

/**
 * Write an upload in one transaction. The file is classified again inside the lock, so the rows written are always
 * the ones that are new right now. Anything that throws rolls everything back and becomes an UploadFailed.
 */
export function commitUpload(db: DatabaseSync, upload: ParsedUpload, now: Date = new Date()): UploadCommit {
  try {
    db.exec('BEGIN IMMEDIATE');
    const plan = planUpload(db, upload);
    const { counts } = plan.preview;
    const written = counts.newRows + counts.newVersions;
    if (written === 0) {
      db.exec('ROLLBACK'); // nothing to keep; ends the transaction without a seeds row
      return { preview: plan.preview, written: 0, store: null };
    }
    writeRows(db, plan, insertSeed(db, upload, counts.rowsRead, now));
    // Built before COMMIT: a store that cannot be built undoes the write. Calls rebuild cleaned_calls from the same read.
    const store = plan.kind === 'calls' ? rebuildCleanedCalls(db) : readStore(db);
    db.exec('COMMIT');
    return { preview: plan.preview, written, store };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK'); // SQLite may already have rolled back
    const path = db.location() ?? ':memory:';
    const detail = withoutPath(convertDatabaseError(path, error).message, path);
    throw new UploadFailed(`The upload failed and nothing was stored: ${detail}`);
  }
}
