import type { DatabaseSync } from 'node:sqlite';
import { buildReferences, validateCall } from '../../core/validate';
import type { Call } from '../../core/types';
import { readCampaigns, readLocations } from '../read';
import { rowHash } from '../seed';
import type { ParsedUpload } from './detect';
import { shorten } from '../../server/api';
import { EXAMPLES_PER_CLASS, NOTE_MAX, type RowClass, type UploadExample, type UploadPlan } from './types';

export type CallsPlan = Extract<UploadPlan, { kind: 'calls' }>;

/** Calls plan plus how many bad rows are newer versions of a call that is stored or planned (they are not stored; the older good version stays). */
export interface CallsPlanDetail {
  plan: CallsPlan;
  newerBadRows: number;
}

const NO_TIME = '';
const timeKey = (updatedAt: Date | null) => (updatedAt === null ? NO_TIME : updatedAt.toISOString());
const shortId = (id: string) => shorten(id, 40);

/** The columns that make two versions of a call differ, with each value as text. */
function fieldValues(c: Call): [string, string][] {
  const iso = (d: Date | null) => (d === null ? '' : d.toISOString());
  return [
    ['started_at', iso(c.startedAt)], ['ended_at', iso(c.endedAt)], ['duration_seconds', String(c.durationSeconds)],
    ['caller_number_hash', c.callerHash], ['tracking_number', c.trackingNumber], ['campaign_id', c.campaignId ?? ''],
    ['marketing_channel', c.channel], ['location_id', c.locationId], ['answered', String(c.answered)],
    ['outcome', c.outcome ?? ''], ['revenue_usd', c.revenueUsd === null ? '' : String(c.revenueUsd)], ['agent_id', c.agentId ?? ''],
  ];
}

function describeDifferences(first: Call, row: Call, firstRow: number): string {
  const later = fieldValues(row);
  const quote = (v: string) => `"${shorten(v, NOTE_MAX)}"`;
  const diffs = fieldValues(first)
    .map(([field, value], i) => ({ field, value, other: later[i]![1] }))
    .filter((d) => d.value !== d.other)
    .map((d) => `${d.field} is ${quote(d.value)} in row ${firstRow}, ${quote(d.other)} in this row`);
  return `differs from row ${firstRow} in this file: ${diffs.join('; ')}`;
}

/** What the database holds, by call_id then updated_at, as the hashes of the rows stored there. Bad rows are not stored calls. */
function readStoredCalls(db: DatabaseSync) {
  const byCall = new Map<string, Map<string, Set<string>>>();
  const hashes = new Set<string>();
  const latest = new Map<string, number>();
  const rows = db.prepare('SELECT call_id, updated_at, row_key FROM raw_calls').all() as { call_id: string; updated_at: string | null; row_key: string }[];
  for (const r of rows) {
    const hash = r.row_key.split('#')[0]!;
    hashes.add(hash);
    const times = byCall.get(r.call_id) ?? new Map<string, Set<string>>();
    const key = r.updated_at ?? NO_TIME;
    const at = r.updated_at === null ? NaN : new Date(r.updated_at).getTime();
    if (!Number.isNaN(at) && at > (latest.get(r.call_id) ?? -Infinity)) latest.set(r.call_id, at);
    const set = times.get(key) ?? new Set<string>();
    set.add(hash);
    times.set(key, set);
    byCall.set(r.call_id, times);
  }
  return { byCall, hashes, latest };
}

/** Classify every row of a calls file against the database. Read-only. */
export function planCallsDetail(db: DatabaseSync, upload: ParsedUpload): CallsPlanDetail {
  const stored = readStoredCalls(db);
  const refs = buildReferences(readCampaigns(db), readLocations(db));

  const planned: Call[] = [];
  const counts = { rowsRead: upload.table.rows.length, newRows: 0, newVersions: 0, duplicates: 0, conflicts: 0, bad: 0 };
  const examples: Record<RowClass, UploadExample[]> = { new: [], new_version: [], duplicate: [], conflict: [], bad: [] };
  const badByReason: Record<string, number> = {};
  let newerBadRows = 0;
  // The latest updated_at known for each call: stored, then raised as this file plans newer versions.
  const latest = new Map(stored.latest);

  // What this file already planned: the first row number of each (call_id, time) and of each whole row.
  const fileKeys = new Map<string, { row: number; call: Call; hash: string }>();
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
      note('bad', rowNumber, result.bad.callId, shorten(result.bad.detail, NOTE_MAX));
      // Bad rows are never stored, so a newer bad version leaves the older good one counting. Say so.
      const at = result.bad.updatedAt?.getTime();
      const known = latest.get(result.bad.callId);
      if (at !== undefined && known !== undefined && at > known) newerBadRows += 1;
      return;
    }
    const call = result.call;
    const hash = rowHash(result);
    const key = `${JSON.stringify(call.callId)}|${timeKey(call.updatedAt)}`;

    const storedHashes = stored.byCall.get(call.callId)?.get(timeKey(call.updatedAt));
    // With a time, the call and time are the identity; without one, the whole row has to be identical.
    const storedMatch = call.updatedAt !== null ? storedHashes !== undefined : stored.hashes.has(hash);
    if (storedMatch) {
      if (call.updatedAt !== null && !storedHashes!.has(hash)) {
        counts.conflicts += 1;
        note('conflict', rowNumber, call.callId, 'differs from the stored call with the same time');
      } else {
        counts.duplicates += 1;
        note('duplicate', rowNumber, call.callId, 'already stored');
      }
      return;
    }

    if (call.updatedAt !== null) {
      const first = fileKeys.get(key);
      if (first !== undefined) {
        if (first.hash === hash) {
          counts.duplicates += 1;
          note('duplicate', rowNumber, call.callId, `repeated in this file (row ${first.row})`);
        } else {
          counts.conflicts += 1;
          note('conflict', rowNumber, call.callId, describeDifferences(first.call, call, first.row));
        }
        return;
      }
    } else {
      const earlier = fileHashes.get(hash);
      if (earlier !== undefined) {
        counts.duplicates += 1;
        note('duplicate', rowNumber, call.callId, `repeated in this file (row ${earlier})`);
        return;
      }
    }

    if (call.updatedAt !== null) {
      fileKeys.set(key, { row: rowNumber, call, hash });
      if (call.updatedAt.getTime() > (latest.get(call.callId) ?? -Infinity)) latest.set(call.callId, call.updatedAt.getTime());
    }
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
    newerBadRows,
  };
}
