import type { DatabaseSync } from 'node:sqlite';
import { buildReferences, validateCall } from '../../core/validate';
import type { Call } from '../../core/types';
import { readCampaigns, readLocations } from '../read';
import { rowHash } from '../seed';
import type { ParsedUpload } from './detect';
import { EXAMPLES_PER_CLASS, type RowClass, type UploadExample, type UploadPlan } from './types';

export type CallsPlan = Extract<UploadPlan, { kind: 'calls' }>;

/** Calls plan plus how many rows were skipped because a stored row has the same call_id and time but other values. */
export interface CallsPlanDetail {
  plan: CallsPlan;
  differingDuplicates: number;
}

const NO_TIME = '';
const timeKey = (updatedAt: Date | null) => (updatedAt === null ? NO_TIME : updatedAt.toISOString());
const shortId = (id: string) => (id.length > 40 ? `${id.slice(0, 40)}...` : id);

/** What the database holds, by call_id then updated_at, as the hashes of the rows stored there. Bad rows are not stored calls. */
function readStoredCalls(db: DatabaseSync) {
  const byCall = new Map<string, Map<string, Set<string>>>();
  const hashes = new Set<string>();
  const rows = db.prepare('SELECT call_id, updated_at, row_key FROM raw_calls').all() as { call_id: string; updated_at: string | null; row_key: string }[];
  for (const r of rows) {
    const hash = r.row_key.split('#')[0]!;
    hashes.add(hash);
    const times = byCall.get(r.call_id) ?? new Map<string, Set<string>>();
    const key = r.updated_at ?? NO_TIME;
    const set = times.get(key) ?? new Set<string>();
    set.add(hash);
    times.set(key, set);
    byCall.set(r.call_id, times);
  }
  return { byCall, hashes };
}

/** Classify every row of a calls file against the database. Read-only. */
export function planCallsDetail(db: DatabaseSync, upload: ParsedUpload): CallsPlanDetail {
  const stored = readStoredCalls(db);
  const refs = buildReferences(readCampaigns(db), readLocations(db));

  const planned: Call[] = [];
  const counts = { rowsRead: upload.table.rows.length, newRows: 0, newVersions: 0, duplicates: 0, conflicts: 0, bad: 0 };
  const examples: Record<RowClass, UploadExample[]> = { new: [], new_version: [], duplicate: [], conflict: [], bad: [] };
  const badByReason: Record<string, number> = {};
  let differingDuplicates = 0;

  // What this file already planned: the first row number of each (call_id, time) and of each whole row.
  const fileKeys = new Map<string, number>();
  const fileHashes = new Map<string, number>();

  const note = (cls: RowClass, row: number, id: string, text: string) => {
    if (examples[cls].length < EXAMPLES_PER_CLASS) examples[cls].push({ row, id: shortId(id), note: text });
  };

  upload.table.rows.forEach((raw, index) => {
    const rowNumber = index + 1;
    const result = validateCall(raw, rowNumber, refs);
    if (!result.ok) {
      counts.bad += 1;
      badByReason[result.bad.reason] = (badByReason[result.bad.reason] ?? 0) + 1;
      note('bad', rowNumber, result.bad.callId, result.bad.detail);
      return;
    }
    const call = result.call;
    const hash = rowHash(result);
    const key = `${JSON.stringify(call.callId)}|${timeKey(call.updatedAt)}`;

    const storedHashes = stored.byCall.get(call.callId)?.get(timeKey(call.updatedAt));
    // With a time, the call and time are the identity; without one, the whole row has to be identical.
    const storedMatch = call.updatedAt !== null ? storedHashes !== undefined : stored.hashes.has(hash);
    if (storedMatch) {
      counts.duplicates += 1;
      if (call.updatedAt !== null && !storedHashes!.has(hash)) {
        differingDuplicates += 1;
        note('duplicate', rowNumber, call.callId, 'already stored, but its other values differ');
      } else {
        note('duplicate', rowNumber, call.callId, 'already stored');
      }
      return;
    }

    const earlier = call.updatedAt !== null ? fileKeys.get(key) : fileHashes.get(hash);
    if (earlier !== undefined) {
      counts.duplicates += 1;
      note('duplicate', rowNumber, call.callId, `repeated in this file (row ${earlier})`);
      return;
    }

    if (call.updatedAt !== null) fileKeys.set(key, rowNumber);
    fileHashes.set(hash, rowNumber);
    planned.push(call);
    if (stored.byCall.has(call.callId)) {
      counts.newVersions += 1;
      note('new_version', rowNumber, call.callId, 'a new version of a stored call');
    } else {
      counts.newRows += 1;
      note('new', rowNumber, call.callId, 'a new call');
    }
  });

  return {
    plan: {
      kind: 'calls',
      calls: planned,
      preview: { kind: 'calls', fileName: upload.fileName, counts, examples, badByReason, hints: [] },
    },
    differingDuplicates,
  };
}

/** The calls plan. Use planUpload to also get the hints. */
export function planCallsUpload(db: DatabaseSync, upload: ParsedUpload): UploadPlan {
  return planCallsDetail(db, upload).plan;
}
