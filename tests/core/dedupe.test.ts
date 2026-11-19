import { describe, expect, test } from 'vitest';
import { dedupeRows } from '../../src/core/dedupe';
import type { RowResult } from '../../src/core/types';
import { goodRow, loadFixture } from './helpers';

const dedupe = (rows: Record<string, string>[]) => dedupeRows(loadFixture(rows).rows);

const goodCall = (row: RowResult) => {
  if (!row.ok) throw new Error(`expected a good row, got ${row.bad.reason}`);
  return row.call;
};

describe('dedupeRows', () => {
  test('three rows for one call arriving out of order keep the latest updated_at', () => {
    const result = dedupe([
      goodRow({ outcome: 'qualified_lead', revenue_usd: '', updated_at: '2026-03-03T08:00:00Z' }),
      goodRow({ outcome: 'not_qualified', revenue_usd: '', updated_at: '2026-03-01T08:00:00Z' }),
      goodRow({ outcome: 'booked', updated_at: '2026-03-05T08:00:00Z' }),
    ]);
    expect(result.winners).toHaveLength(1);
    expect(goodCall(result.winners[0]!).outcome).toBe('booked');
    expect(result.duplicateRowsCollapsed).toBe(2);
    expect(result.rowsRead).toBe(3);
    expect(result.groups[0]).toHaveLength(3);
    expect(result.groups[0]!.map((r) => goodCall(r).rowNumber)).toEqual([1, 2, 3]);
  });

  test('an updated_at tie keeps the later row in the file and counts the call once', () => {
    const result = dedupe([
      goodRow({ agent_id: 'a1', updated_at: '2026-03-03T08:00:00Z' }),
      goodRow({ agent_id: 'a2', updated_at: '2026-03-03T08:00:00Z' }),
    ]);
    expect(goodCall(result.winners[0]!).agentId).toBe('a2');
    expect(result.tiedCalls).toBe(1);
  });

  test('two tied calls count as two, even when a call has three rows with only two tied', () => {
    const result = dedupe([
      goodRow({ call_id: 'c1', updated_at: '2026-03-03T08:00:00Z' }),
      goodRow({ call_id: 'c1', updated_at: '2026-03-03T08:00:00Z' }),
      goodRow({ call_id: 'c2', updated_at: '2026-03-01T08:00:00Z' }),
      goodRow({ call_id: 'c2', updated_at: '2026-03-05T08:00:00Z' }),
      goodRow({ call_id: 'c2', updated_at: '2026-03-05T08:00:00Z' }),
    ]);
    expect(result.tiedCalls).toBe(2);
  });

  test('a tie below the maximum is not a tie', () => {
    const result = dedupe([
      goodRow({ updated_at: '2026-03-01T08:00:00Z' }),
      goodRow({ updated_at: '2026-03-01T08:00:00Z' }),
      goodRow({ updated_at: '2026-03-05T08:00:00Z' }),
    ]);
    expect(result.tiedCalls).toBe(0);
  });

  test('a bad latest row beats an older good row, so the call is bad', () => {
    const result = dedupe([
      goodRow({ updated_at: '2026-03-03T08:00:00Z' }),
      goodRow({ location_id: 'loc_zzz', updated_at: '2026-03-09T08:00:00Z' }),
    ]);
    const winner = result.winners[0]!;
    expect(winner.ok).toBe(false);
    if (!winner.ok) expect(winner.bad.reason).toBe('unknown_location');
  });

  test('a good latest row beats an older bad row', () => {
    const result = dedupe([
      goodRow({ location_id: 'loc_zzz', updated_at: '2026-03-01T08:00:00Z' }),
      goodRow({ updated_at: '2026-03-03T08:00:00Z' }),
    ]);
    expect(result.winners[0]!.ok).toBe(true);
  });

  test('an unparseable updated_at loses to any parseable one', () => {
    const result = dedupe([
      goodRow({ agent_id: 'parsed', updated_at: '2026-03-01T08:00:00Z' }),
      goodRow({ agent_id: 'garbage', updated_at: 'garbage' }),
    ]);
    expect(goodCall(result.winners[0]!).agentId).toBe('parsed');
  });

  test('all rows unparseable keeps the later row and does not count a tie', () => {
    const result = dedupe([
      goodRow({ agent_id: 'a1', updated_at: 'garbage' }),
      goodRow({ agent_id: 'a2', updated_at: 'nope' }),
    ]);
    expect(goodCall(result.winners[0]!).agentId).toBe('a2');
    expect(result.tiedCalls).toBe(0);
  });

  test('rows with an empty call_id are never merged', () => {
    const result = dedupe([goodRow({ call_id: '' }), goodRow({ call_id: '' })]);
    expect(result.winners).toHaveLength(2);
    expect(result.duplicateRowsCollapsed).toBe(0);
  });

  test('winners follow first appearance order', () => {
    const result = dedupe([
      goodRow({ call_id: 'c2', updated_at: '2026-03-01T08:00:00Z' }),
      goodRow({ call_id: 'c1' }),
      goodRow({ call_id: 'c2', updated_at: '2026-03-02T08:00:00Z' }),
    ]);
    expect(result.winners.map((r) => goodCall(r).callId)).toEqual(['c2', 'c1']);
  });

  test('no rows gives an empty result', () => {
    expect(dedupeRows([])).toEqual({ winners: [], groups: [], rowsRead: 0, duplicateRowsCollapsed: 0, tiedCalls: 0 });
  });
});
