import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { goodRow, loadFixture } from './helpers';

// An export that shares no names, zones or dates with the shipped one.
const CAMPAIGNS = 'campaign_id,name,channel,daily_budget_usd\nzz_c1,Quokka Promo,referral,40\nzz_c2,Wombat Weekend,paid_search,0\n';
const LOCATIONS =
  'location_id,name,timezone\nzz_kol,Kolkata Hub,Asia/Kolkata\nzz_akl,Auckland Annex,Pacific/Auckland\nzz_lon,London Desk,Europe/London\n';

const row = (over: Record<string, string>) =>
  goodRow({ campaign_id: 'zz_c1', marketing_channel: 'referral', location_id: 'zz_kol', ...over });

describe('cleaning a different export', () => {
  const store = cleanExport(
    loadFixture(
      [
        // a duplicate: the first row has no outcome yet, the later one books it
        row({ call_id: 'k1', started_at: '2031-05-10T20:00:00Z', outcome: '', revenue_usd: '', updated_at: '2031-05-10T21:00:00Z' }),
        row({ call_id: 'k1', started_at: '2031-05-10T20:00:00Z', outcome: 'booked', revenue_usd: '300', updated_at: '2031-05-12T21:00:00Z' }),
        // unattributed, in London summer time (UTC+1): 23:30 UTC is 00:30 the next day
        row({ call_id: 'l1', campaign_id: '', marketing_channel: 'direct', location_id: 'zz_lon', started_at: '2031-05-10T23:30:00Z', answered: 'false', outcome: 'missed', revenue_usd: '' }),
        // pending
        row({ call_id: 'a1', campaign_id: 'zz_c2', marketing_channel: 'paid_search', location_id: 'zz_akl', started_at: '2031-05-10T20:00:00Z', outcome: '', revenue_usd: '' }),
      ],
      CAMPAIGNS,
      LOCATIONS,
    ),
  );

  test('every call is kept and counted', () => {
    expect(store.calls.map((c) => c.callId)).toEqual(['k1', 'l1', 'a1']);
    expect(store.dataNotes.badCalls).toBe(0);
    expect(store.dataNotes.duplicateRowsCollapsed).toBe(1);
  });

  test('revenue, attribution and pending work on other names', () => {
    expect(store.calls.reduce((sum, c) => sum + c.revenueUsd, 0)).toBe(300);
    expect(store.dataNotes.unattributedCalls).toBe(1);
    expect(store.dataNotes.pendingCalls).toBe(1);
    expect(store.dataNotes.outcomeLagDays).toBe(3);
  });

  test('local dates follow each office zone, including a half-hour offset', () => {
    const byId = Object.fromEntries(store.calls.map((c) => [c.callId, c]));
    expect(byId.k1).toMatchObject({ localDate: '2031-05-11', localHour: 1 }); // 20:00 UTC + 5:30
    expect(byId.l1).toMatchObject({ localDate: '2031-05-11', localHour: 0 });
    expect(byId.a1).toMatchObject({ localDate: '2031-05-11', localHour: 8 }); // 20:00 UTC + 12:00
  });
});

describe('nothing in src/ is tied to the shipped dataset', () => {
  const sourceFiles = readdirSync(join(__dirname, '..', '..', 'src'), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: f, text: readFileSync(join(__dirname, '..', '..', 'src', f), 'utf8') }));

  test.each(['Phoenix', 'Denver', '2026-', 'cmp_', 'loc_', '+1-555'])('no source file contains "%s"', (needle) => {
    expect(sourceFiles.filter((f) => f.text.includes(needle)).map((f) => f.file)).toEqual([]);
  });

  test('the scan found the source files', () => {
    expect(sourceFiles.length).toBeGreaterThan(5);
  });
});
