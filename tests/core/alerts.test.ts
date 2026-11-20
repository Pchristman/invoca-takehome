import { describe, expect, it } from 'vitest';
import { countAlert, poissonZ } from '../../src/core/alerts';
import { THRESHOLDS } from '../../src/core/thresholds';

type Row = [string, number, number, boolean, boolean, 'jump' | 'drop' | null, number | null];

const rows: Row[] = [
  ['jump', 342, 218, true, true, 'jump', 5.24],
  ['drop', 113, 261, true, true, 'drop', -7.653],
  ['no change', 100, 100, true, false, null, 0],
  ['exactly at threshold', 27, 9, true, true, 'jump', 3],
  ['just under', 26, 10, true, false, null, 2.667],
  ['exactly the minimum', 20, 0, true, true, 'jump', 4.472],
  ['one under the minimum (would flag if tested)', 19, 0, false, false, null, null],
  ['too small', 10, 0, false, false, null, null],
  ['drop to zero', 0, 20, true, true, 'drop', -4.472],
  ['both zero', 0, 0, false, false, null, null],
];

describe('countAlert', () => {
  it.each(rows)('%s', (_name, current, previous, eligible, flagged, direction, z) => {
    const result = countAlert(current, previous);
    expect(result.eligible).toBe(eligible);
    expect(result.flagged).toBe(flagged);
    expect(result.direction).toBe(direction);
    if (z === null) expect(result.z).toBeNull();
    else expect(result.z).toBeCloseTo(z, 3);
  });

  it.each([
    [NaN, 10],
    [10, -1],
    [2.5, 30],
    [Infinity, 30],
  ])('garbage input (%s, %s) is never eligible and gives no NaN', (current, previous) => {
    expect(poissonZ(current, previous)).toBeNull();
    expect(countAlert(current, previous)).toEqual({ eligible: false, z: null, flagged: false, direction: null });
  });

  it('options override the defaults', () => {
    expect(countAlert(10, 0).flagged).toBe(false);
    expect(countAlert(10, 0, { z: 2, minCalls: 5 }).flagged).toBe(true);
  });

  it('minCalls 0 still leaves (0, 0) ineligible', () => {
    expect(countAlert(0, 0, { minCalls: 0 }).eligible).toBe(false);
  });

  it('poissonZ(0, 0) is null', () => {
    expect(poissonZ(0, 0)).toBeNull();
  });

  it('thresholds have the planned defaults', () => {
    expect(THRESHOLDS.ALERT_Z).toBe(3);
    expect(THRESHOLDS.MIN_CALLS_ALERT).toBe(20);
  });
});
