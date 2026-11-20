import type { DatabaseSync } from 'node:sqlite';
import type { CallStore } from '../core/types';
import { readStore } from './read';

/**
 * Delete and refill cleaned_calls from the same cleaning the app uses (cleanExport), so the table
 * can never disagree with what the server shows. It is a derived copy for querying in SQL; the app
 * itself reads the raw tables. Returns the number of calls. Runs inside the caller's transaction.
 */
export function refreshCleanedCalls(db: DatabaseSync): number {
  return rebuildCleanedCalls(db).calls.length;
}

/** The same refresh, handing back the store it was built from, so a caller that needs the store does not read it again. */
export function rebuildCleanedCalls(db: DatabaseSync): CallStore {
  const store = readStore(db);
  const { calls } = store;
  db.exec('DELETE FROM cleaned_calls');
  const insert = db.prepare(
    `INSERT INTO cleaned_calls (call_id, started_at, duration_seconds, caller_hash, tracking_number, campaign_id, unattributed, channel,
       location_id, answered, outcome, booked, pending, revenue_usd, agent_id, local_date, local_hour, local_weekday)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of calls) {
    insert.run(
      c.callId, c.startedAt.toISOString(), c.durationSeconds, c.callerHash, c.trackingNumber, c.campaignId, c.unattributed ? 1 : 0, c.channel,
      c.locationId, c.answered ? 1 : 0, c.outcome, c.booked ? 1 : 0, c.pending ? 1 : 0, c.revenueUsd, c.agentId, c.localDate, c.localHour, c.localWeekday,
    );
  }
  return store;
}
