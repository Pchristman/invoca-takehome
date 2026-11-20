import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadExport } from '../../src/core/loadExport';
import type { CleanCall } from '../../src/core/types';
import { readStore } from '../../src/db/read';
import { seedExport } from '../../src/db/seed';
import { callLine, count, csvTexts, memoryDb, messyTexts, noSource } from './helpers';

type Row = Record<string, string | number | null>;

const seed = (db: ReturnType<typeof memoryDb>, texts: ReturnType<typeof csvTexts>) => seedExport(db, loadExport(texts), noSource);
const rows = (db: ReturnType<typeof memoryDb>): Row[] => db.prepare('SELECT * FROM cleaned_calls ORDER BY call_id').all() as Row[];

function asCleanCall(r: Row): CleanCall {
  return {
    callId: r.call_id as string,
    startedAt: new Date(r.started_at as string),
    durationSeconds: r.duration_seconds as number,
    callerHash: r.caller_hash as string,
    trackingNumber: r.tracking_number as string,
    campaignId: r.campaign_id as string | null,
    unattributed: r.unattributed === 1,
    channel: r.channel as CleanCall['channel'],
    locationId: r.location_id as string,
    answered: r.answered === 1,
    outcome: r.outcome as CleanCall['outcome'],
    booked: r.booked === 1,
    pending: r.pending === 1,
    revenueUsd: r.revenue_usd as number,
    agentId: r.agent_id as string | null,
    localDate: r.local_date as string,
    localHour: r.local_hour as number,
    localWeekday: r.local_weekday as number,
  };
}

describe('cleaned_calls', () => {
  it('one row per call_id: the latest updated_at wins', () => {
    const db = memoryDb();
    const calls = [
      callLine({ call_id: 'c_1', updated_at: '2026-09-01T10:30:00Z', answered: 'true', outcome: 'booked', revenue_usd: '75' }),
      callLine({ call_id: 'c_1', updated_at: '2026-09-01T10:00:00Z', answered: 'true', outcome: '' }),
      callLine({ call_id: 'c_1', updated_at: '2026-09-01T10:10:00Z', answered: 'true', outcome: 'qualified_lead' }),
    ];
    const report = seed(db, csvTexts({ calls }));
    expect(report.callsAfter).toBe(1);
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({ outcome: 'booked', booked: 1, revenue_usd: 75 });
  });

  it('bad calls are never in cleaned_calls', () => {
    const db = memoryDb();
    const calls = [
      callLine({ call_id: 'c_badlatest', updated_at: '2026-09-01T10:00:00Z' }),
      callLine({ call_id: 'c_badlatest', updated_at: '2026-09-01T11:00:00Z', location_id: 'loc_nope' }),
      callLine({ call_id: 'c_unknown', location_id: 'loc_nope' }),
      callLine({ call_id: 'c_ok' }),
    ];
    seed(db, csvTexts({ calls }));
    expect(rows(db).map((r) => r.call_id)).toEqual(['c_ok']);
  });

  it('a newer seed replaces the row for a call and adds new calls', () => {
    const db = memoryDb();
    const first = callLine({ call_id: 'c_1', answered: 'true', outcome: '', updated_at: '2026-09-01T10:00:00Z' });
    seed(db, csvTexts({ calls: [first] }));
    expect(rows(db)[0]).toMatchObject({ outcome: null, pending: 1 });
    const newer = callLine({ call_id: 'c_1', answered: 'true', outcome: 'booked', revenue_usd: '90', updated_at: '2026-09-02T10:00:00Z' });
    const report = seed(db, csvTexts({ calls: [first, newer, callLine({ call_id: 'c_2' })] }));
    expect(report.callsAfter).toBe(2);
    expect(rows(db)).toMatchObject([
      { call_id: 'c_1', outcome: 'booked', revenue_usd: 90, pending: 0 },
      { call_id: 'c_2' },
    ]);
  });

  it('seeding twice leaves cleaned_calls unchanged', () => {
    const db = memoryDb();
    seed(db, messyTexts());
    const before = rows(db);
    seed(db, messyTexts());
    expect(rows(db)).toEqual(before);
  });

  it('matches readStore(db).calls field for field on the messy export', () => {
    const db = memoryDb();
    seed(db, messyTexts());
    const byId = (list: CleanCall[]) => [...list].sort((a, b) => (a.callId < b.callId ? -1 : 1));
    const fromSql = byId(rows(db).map(asCleanCall));
    expect(fromSql).toEqual(byId(readStore(db).calls));
    // 02:00 UTC is the previous evening in Phoenix (Monday 2026-09-01 19:00; 2026-09-02 is a Wednesday)
    const late = fromSql.find((c) => c.callId === 'c_late')!;
    expect(late).toMatchObject({ localDate: '2026-09-01', localHour: 19, localWeekday: 1 });
  });

  it('revenue is counted only on booked calls', () => {
    const db = memoryDb();
    const calls = [
      callLine({ call_id: 'c_revnb', answered: 'true', outcome: 'qualified_lead', revenue_usd: '40' }),
      callLine({ call_id: 'c_book', answered: 'true', outcome: 'booked', revenue_usd: '60' }),
    ];
    seed(db, csvTexts({ calls }));
    expect(db.prepare('SELECT revenue_usd AS r FROM raw_calls WHERE call_id = ?').get('c_revnb')).toEqual({ r: 40 });
    expect(db.prepare('SELECT SUM(revenue_usd) AS s FROM cleaned_calls WHERE booked = 0').get()).toEqual({ s: 0 });
    expect(db.prepare('SELECT SUM(revenue_usd) AS s FROM cleaned_calls WHERE booked = 1').get()).toEqual({ s: 60 });
  });

  it('unattributed calls are kept with campaign_id NULL', () => {
    const db = memoryDb();
    seed(db, csvTexts({ calls: [callLine({ call_id: 'c_u', campaign_id: '' })] }));
    expect(rows(db)).toMatchObject([{ call_id: 'c_u', campaign_id: null, unattributed: 1 }]);
  });

  it('the totals on the shipped export, read by SQL', () => {
    const dir = 'tests/fixtures/original-export';
    const db = memoryDb();
    seed(db, {
      calls: readFileSync(join(dir, 'calls.csv'), 'utf8'),
      campaigns: readFileSync(join(dir, 'campaigns.csv'), 'utf8'),
      locations: readFileSync(join(dir, 'locations.csv'), 'utf8'),
    });
    const totals = db
      .prepare('SELECT COUNT(*) AS calls, SUM(booked) AS bookings, ROUND(SUM(revenue_usd)) AS revenue, SUM(unattributed) AS unattributed FROM cleaned_calls')
      .get();
    expect(totals).toEqual({ calls: 5000, bookings: 1204, revenue: 432894, unattributed: 144 });
    expect(count(db, 'cleaned_calls')).toBe(5000);
  });
});
