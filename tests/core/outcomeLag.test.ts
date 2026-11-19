import { describe, expect, test } from 'vitest';
import { dedupeRows } from '../../src/core/dedupe';
import { measureOutcomeLagDays } from '../../src/core/outcomeLag';
import { goodRow, loadFixture } from './helpers';

const START = '2026-03-02T10:00:00Z';
const hoursAfterStart = (h: number) => new Date(Date.parse(START) + h * 3_600_000).toISOString().replace('.000Z', 'Z');

/** Two rows for one call: first answered with no outcome yet, then updated `h` hours after the start. */
const updatedAfter = (h: number, id = 'c1') => [
  goodRow({ call_id: id, started_at: START, outcome: '', revenue_usd: '', updated_at: hoursAfterStart(0.1) }),
  goodRow({ call_id: id, started_at: START, outcome: 'booked', revenue_usd: '250', updated_at: hoursAfterStart(h) }),
];

const lag = (rows: Record<string, string>[]) => {
  const { groups, winners } = dedupeRows(loadFixture(rows).rows);
  return measureOutcomeLagDays(groups, winners);
};

describe('measureOutcomeLagDays', () => {
  test('lag is the gap from call start to the updating row, rounded up to whole days', () => {
    expect(lag(updatedAfter(71))).toBe(3);
  });

  test('the longest lag across calls wins', () => {
    expect(lag([...updatedAfter(30, 'a'), ...updatedAfter(50, 'b')])).toBe(3);
  });

  test('an exact multiple of a day does not round up', () => {
    expect(lag(updatedAfter(48))).toBe(2);
  });

  test('a pure duplicate row does not count', () => {
    const row = { started_at: START, outcome: 'booked', revenue_usd: '250' };
    expect(
      lag([goodRow({ ...row, updated_at: hoursAfterStart(1) }), goodRow({ ...row, updated_at: hoursAfterStart(90) })]),
    ).toBe(0);
  });

  test('a call with one row does not count, even if updated_at is days after start', () => {
    expect(lag([goodRow({ started_at: START, updated_at: hoursAfterStart(100) })])).toBe(0);
  });

  test('a revenue change alone counts', () => {
    const rows = [
      goodRow({ started_at: START, outcome: 'booked', revenue_usd: '', updated_at: hoursAfterStart(1) }),
      goodRow({ started_at: START, outcome: 'booked', revenue_usd: '300', updated_at: hoursAfterStart(24) }),
    ];
    expect(lag(rows)).toBe(1);
  });

  test('a negative gap counts as 0', () => {
    const rows = [
      goodRow({ started_at: START, outcome: '', revenue_usd: '', updated_at: hoursAfterStart(-3) }),
      goodRow({ started_at: START, outcome: 'booked', revenue_usd: '250', updated_at: hoursAfterStart(-1) }),
    ];
    expect(lag(rows)).toBe(0);
  });

  test('a call whose winner is bad does not count', () => {
    const rows = [...updatedAfter(60), goodRow({ call_id: 'c1', started_at: START, location_id: 'loc_zzz', updated_at: hoursAfterStart(80) })];
    expect(lag(rows)).toBe(0);
  });

  test('no rows gives 0', () => {
    expect(measureOutcomeLagDays([], [])).toBe(0);
  });

  test('an identical row after the real update does not extend the lag', () => {
    const rows = [
      goodRow({ started_at: START, outcome: '', revenue_usd: '', updated_at: hoursAfterStart(0.1) }),
      goodRow({ started_at: START, outcome: 'booked', revenue_usd: '250', updated_at: hoursAfterStart(2) }),
      goodRow({ started_at: START, outcome: 'booked', revenue_usd: '250', updated_at: hoursAfterStart(100) }),
    ];
    expect(lag(rows)).toBe(1);
  });

  test('an outcome that changes and changes back counts up to its last change', () => {
    const rows = [
      goodRow({ started_at: START, outcome: 'booked', revenue_usd: '250', updated_at: hoursAfterStart(1) }),
      goodRow({ started_at: START, outcome: 'not_qualified', revenue_usd: '', updated_at: hoursAfterStart(25) }),
      goodRow({ started_at: START, outcome: 'booked', revenue_usd: '250', updated_at: hoursAfterStart(70) }),
    ];
    expect(lag(rows)).toBe(3);
  });

  test('rows are compared in updated_at order, not file order', () => {
    const rows = [
      goodRow({ started_at: START, outcome: 'booked', revenue_usd: '250', updated_at: hoursAfterStart(30) }),
      goodRow({ started_at: START, outcome: '', revenue_usd: '', updated_at: hoursAfterStart(1) }),
    ];
    expect(lag(rows)).toBe(2);
  });

  test('a bad earlier row is not compared: only good rows show an update', () => {
    const rows = [
      goodRow({ started_at: START, duration_seconds: '-1', outcome: '', revenue_usd: '', updated_at: hoursAfterStart(1) }),
      goodRow({ started_at: START, outcome: 'booked', revenue_usd: '250', updated_at: hoursAfterStart(96) }),
    ];
    expect(lag(rows)).toBe(0);
  });
});
