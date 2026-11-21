import { describe, expect, test } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { loadExport } from '../../src/core/loadExport';
import { CAMPAIGNS, LOCATIONS, goodRow, loadFixture } from './helpers';

const clean = (rows: Record<string, string>[]) => cleanExport(loadFixture(rows));

describe('cleanExport', () => {
  test('rule 2: three rows for one call clean to one call with the latest outcome', () => {
    const store = clean([
      goodRow({ outcome: 'qualified_lead', revenue_usd: '', updated_at: '2026-03-03T08:00:00Z' }),
      goodRow({ outcome: 'not_qualified', revenue_usd: '', updated_at: '2026-03-01T08:00:00Z' }),
      goodRow({ outcome: 'booked', updated_at: '2026-03-05T08:00:00Z' }),
    ]);
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0]!.outcome).toBe('booked');
    expect(store.dataNotes.rowsRead).toBe(3);
    expect(store.dataNotes.duplicateRowsCollapsed).toBe(2);
    expect(store.dataNotes.callsAfterDedup).toBe(1);
  });

  test('rule 2: a bad latest row makes the call bad and is reported once, per call', () => {
    const rows = [
      goodRow({ updated_at: '2026-03-03T08:00:00Z' }),
      goodRow({ location_id: 'loc_zzz', updated_at: '2026-03-09T08:00:00Z' }),
      goodRow({ location_id: 'loc_zzz', updated_at: '2026-03-10T08:00:00Z' }),
    ];
    const loaded = loadFixture(rows);
    const store = cleanExport(loaded);
    expect(store.calls).toEqual([]);
    expect(store.dataNotes.badCalls).toBe(1);
    expect(store.dataNotes.badCallsByReason.unknown_location).toBe(1);
    expect(loaded.badByReason.unknown_location).toBe(2); // Phase 1 counts raw rows
  });

  test('rule 2: a tie is counted in the notes', () => {
    const store = clean([
      goodRow({ agent_id: 'a1', updated_at: '2026-03-03T08:00:00Z' }),
      goodRow({ agent_id: 'a2', updated_at: '2026-03-03T08:00:00Z' }),
    ]);
    expect(store.dataNotes.tiedCalls).toBe(1);
    expect(store.calls[0]!.agentId).toBe('a2');
  });

  test('rule 4: an empty campaign_id is Unattributed and kept', () => {
    const store = clean([
      goodRow({ call_id: 'u1', campaign_id: '', tracking_number: '+1-555-0191' }),
      goodRow({ call_id: 'u2', campaign_id: '', tracking_number: '+1-555-0190' }),
      goodRow({ call_id: 'u3', campaign_id: '', tracking_number: '+1-555-0190' }),
      goodRow({ call_id: 'a1' }),
    ]);
    expect(store.calls).toHaveLength(4);
    const u1 = store.calls.find((c) => c.callId === 'u1')!;
    expect(u1.campaignId).toBeNull();
    expect(u1.unattributed).toBe(true);
    expect(store.calls.find((c) => c.callId === 'a1')!.unattributed).toBe(false);
    expect(store.dataNotes.unattributedCalls).toBe(3);
    expect(store.dataNotes.unattributedTrackingNumbers).toEqual([
      { trackingNumber: '+1-555-0190', calls: 2 },
      { trackingNumber: '+1-555-0191', calls: 1 },
    ]);
  });

  test('rule 4: an unknown non-empty campaign is bad, not Unattributed', () => {
    const store = clean([goodRow({ campaign_id: 'cmp_zzz' })]);
    expect(store.calls).toEqual([]);
    expect(store.dataNotes.badCallsByReason.unknown_campaign).toBe(1);
    expect(store.dataNotes.unattributedCalls).toBe(0);
  });

  test('rule 5: local fields use the office zone', () => {
    const store = clean([
      goodRow({ call_id: 'den', location_id: 'loc_2', started_at: '2026-10-05T02:00:00Z' }),
      goodRow({ call_id: 'phx', location_id: 'loc_1', started_at: '2026-10-05T02:00:00Z' }),
    ]);
    const den = store.calls.find((c) => c.callId === 'den')!;
    const phx = store.calls.find((c) => c.callId === 'phx')!;
    expect(den).toMatchObject({ localDate: '2026-10-04', localHour: 20, localWeekday: 6 });
    expect(phx).toMatchObject({ localDate: '2026-10-04', localHour: 19 });
  });

  test('rule 6: revenue on a non-booked row is ignored and counted', () => {
    const store = clean([goodRow({ outcome: 'qualified_lead', revenue_usd: '120.50' })]);
    expect(store.calls[0]!.revenueUsd).toBe(0);
    expect(store.dataNotes.revenueOnNonBookedCalls).toBe(1);
    expect(store.dataNotes.revenueOnNonBookedUsd).toBe(120.5);
  });

  test('rule 6: only the current row decides the revenue', () => {
    const store = clean([
      goodRow({ outcome: 'booked', revenue_usd: '250', updated_at: '2026-03-01T08:00:00Z' }),
      goodRow({ outcome: 'not_qualified', revenue_usd: '', updated_at: '2026-03-02T08:00:00Z' }),
    ]);
    expect(store.calls[0]!.booked).toBe(false);
    expect(store.calls[0]!.revenueUsd).toBe(0);
    expect(store.dataNotes.revenueOnNonBookedCalls).toBe(0);
  });

  test('rule 6: booked with empty revenue is a booking at $0 and is counted', () => {
    const store = clean([goodRow({ outcome: 'booked', revenue_usd: '' })]);
    expect(store.calls[0]).toMatchObject({ booked: true, revenueUsd: 0 });
    expect(store.dataNotes.bookedWithoutRevenueCalls).toBe(1);
  });

  test('rule 6: booked with an explicit 0 is not "without revenue"', () => {
    const store = clean([goodRow({ outcome: 'booked', revenue_usd: '0' })]);
    expect(store.calls[0]!.booked).toBe(true);
    expect(store.dataNotes.bookedWithoutRevenueCalls).toBe(0);
  });

  test('rule 6: booked revenue is counted as is', () => {
    expect(clean([goodRow({ outcome: 'booked', revenue_usd: '432.50' })]).calls[0]!.revenueUsd).toBe(432.5);
  });

  test('rule 7: answered with no outcome is pending', () => {
    const store = clean([goodRow({ answered: 'true', outcome: '', revenue_usd: '' })]);
    expect(store.calls[0]).toMatchObject({ pending: true, booked: false, answered: true, outcome: null });
    expect(store.dataNotes.pendingCalls).toBe(1);
  });

  test('calls with no caller hash are counted in the data notes, not hidden', () => {
    const store = clean([
      goodRow({ call_id: 'c1', caller_number_hash: '' }),
      goodRow({ call_id: 'c2', caller_number_hash: '' }),
      goodRow({ call_id: 'c3', caller_number_hash: 'h_9' }),
    ]);
    expect(store.calls).toHaveLength(3);
    expect(store.dataNotes.callsWithoutCallerHash).toBe(2);
    expect(clean([goodRow()]).dataNotes.callsWithoutCallerHash).toBe(0);
  });

  test('rule 7: unanswered with no outcome is not pending', () => {
    const store = clean([goodRow({ answered: 'false', outcome: '', revenue_usd: '' })]);
    expect(store.calls[0]!.pending).toBe(false);
    expect(store.dataNotes.pendingCalls).toBe(0);
  });

  test('carries Phase 1 counts through', () => {
    const store = clean([goodRow({ updated_at: 'garbage' })]);
    expect(store.dataNotes.unparseableUpdatedAt).toBe(1);
    const empty = cleanExport(loadExport({ calls: '', campaigns: CAMPAIGNS, locations: LOCATIONS }));
    expect(empty.dataNotes.notes.length).toBeGreaterThan(0);
  });

  test('an export with zero calls cleans to an empty store', () => {
    const store = clean([]);
    expect(store.calls).toEqual([]);
    expect(store.dataNotes).toMatchObject({
      rowsRead: 0,
      callsAfterDedup: 0,
      duplicateRowsCollapsed: 0,
      tiedCalls: 0,
      unattributedCalls: 0,
      unattributedTrackingNumbers: [],
      pendingCalls: 0,
      badCalls: 0,
      revenueOnNonBookedCalls: 0,
      revenueOnNonBookedUsd: 0,
      bookedWithoutRevenueCalls: 0,
      outcomeLagDays: 0,
    });
  });

  test('campaigns and locations are passed through unchanged', () => {
    const loaded = loadFixture([goodRow()]);
    const store = cleanExport(loaded);
    expect(store.campaigns).toBe(loaded.campaigns);
    expect(store.locations).toBe(loaded.locations);
  });

  test('cleanExport sets outcomeLagDays from the data', () => {
    const store = clean([
      goodRow({ outcome: '', revenue_usd: '', updated_at: '2026-03-02T10:05:00Z' }),
      goodRow({ outcome: 'booked', updated_at: '2026-03-05T09:00:00Z' }),
    ]);
    expect(store.dataNotes.outcomeLagDays).toBe(3);
  });

  test('a tie between a good row and a later bad row makes the call bad and counts the tie', () => {
    const store = clean([
      goodRow({ updated_at: '2026-03-03T08:00:00Z' }),
      goodRow({ location_id: 'loc_zzz', updated_at: '2026-03-03T08:00:00Z' }),
    ]);
    expect(store.calls).toEqual([]);
    expect(store.dataNotes.badCallsByReason.unknown_location).toBe(1);
    expect(store.dataNotes.tiedCalls).toBe(1);
  });

  test('a single bad latest row is one bad call and one bad raw row', () => {
    const loaded = loadFixture([
      goodRow({ updated_at: '2026-03-03T08:00:00Z' }),
      goodRow({ location_id: 'loc_zzz', updated_at: '2026-03-09T08:00:00Z' }),
    ]);
    const { dataNotes } = cleanExport(loaded);
    expect(dataNotes.badCalls).toBe(1);
    expect(dataNotes.badRows).toBe(1);
    expect(dataNotes.badRowsByReason.unknown_location).toBe(1);
  });

  test('revenue ignored on non-booked calls is summed to the cent', () => {
    const store = clean([
      goodRow({ call_id: 'r1', outcome: 'qualified_lead', revenue_usd: '0.10' }),
      goodRow({ call_id: 'r2', outcome: 'qualified_lead', revenue_usd: '0.20' }),
      goodRow({ call_id: 'r3', outcome: 'qualified_lead', revenue_usd: '0.29' }), // 0.29 * 100 is 28.999…: rounds, not truncates
    ]);
    expect(store.dataNotes.revenueOnNonBookedUsd).toBe(0.59);
  });

  test('an explicit 0 revenue on a non-booked call is not an anomaly', () => {
    const store = clean([goodRow({ outcome: 'qualified_lead', revenue_usd: '0' })]);
    expect(store.dataNotes.revenueOnNonBookedCalls).toBe(0);
  });

  test('an unattributed call with no tracking number is counted apart, not listed as a blank number', () => {
    const store = clean([
      goodRow({ call_id: 'n1', campaign_id: '', tracking_number: '' }),
      goodRow({ call_id: 'n2', campaign_id: '', tracking_number: '+1-555-0190' }),
    ]);
    expect(store.dataNotes.unattributedCalls).toBe(2);
    expect(store.dataNotes.unattributedWithoutTrackingNumber).toBe(1);
    expect(store.dataNotes.unattributedTrackingNumbers).toEqual([{ trackingNumber: '+1-555-0190', calls: 1 }]);
  });

  test('tracking numbers with equal counts sort by plain character order, not locale', () => {
    const store = clean([
      goodRow({ call_id: 'n1', campaign_id: '', tracking_number: 'b' }),
      goodRow({ call_id: 'n2', campaign_id: '', tracking_number: 'B' }),
    ]);
    expect(store.dataNotes.unattributedTrackingNumbers.map((t) => t.trackingNumber)).toEqual(['B', 'b']);
  });

  test('Phase 1 reference issues, raw bad-row counts and ended_at count survive cleaning', () => {
    const campaigns = CAMPAIGNS + 'cmp_x,Broken,tv,10\n';
    const loaded = loadFixture(
      [goodRow({ ended_at: 'garbage' }), goodRow({ call_id: 'c2', campaign_id: 'cmp_x' })],
      campaigns,
    );
    const { dataNotes } = cleanExport(loaded);
    expect(loaded.referenceIssues.some((i) => i.file === 'campaigns.csv')).toBe(true);
    expect(dataNotes.referenceIssues).toEqual(loaded.referenceIssues);
    expect(dataNotes.badRows).toBe(1);
    expect(dataNotes.badRowsByReason.invalid_campaign).toBe(1);
    expect(dataNotes.unparseableEndedAt).toBe(1);
  });

  test('a good call whose location is missing is an error, not a silent host-zone guess', () => {
    const loaded = loadFixture([goodRow()]);
    expect(() => cleanExport({ ...loaded, locations: [] })).toThrow(/location/);
  });
});
