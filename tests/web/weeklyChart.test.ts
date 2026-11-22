import { describe, expect, it } from 'vitest';
import type { CampaignsView } from '../../src/core/views';
import { weeklyChartModel } from '../../src/web/models/weeklyChart';
import { campaignsFor, emptyRangeStore, storeOverDates } from './fixtures';

type Weekly = NonNullable<CampaignsView['weekly']>;

function weekly(name: string, weeks: Weekly['weeks']): Weekly {
  return { campaignId: 'c1', name, weeks };
}

// Mondays and Sundays of 2026-09-07 .. 2026-09-27, with the first and last clipped by the data.
const THREE_WEEKS: Weekly['weeks'] = [
  { weekStart: '2026-09-07', weekEnd: '2026-09-13', calls: 4, partial: true },
  { weekStart: '2026-09-14', weekEnd: '2026-09-20', calls: 9, partial: false },
  { weekStart: '2026-09-21', weekEnd: '2026-09-27', calls: 2, partial: true },
];

// The tests in this block pass hand-set `partial` flags straight through the model, so they pin the plumbing only.
// What makes a week partial is pinned on real data in 'weeklyChartModel on real server data' below.
describe('weeklyChartModel', () => {
  it('gives null for null', () => {
    expect(weeklyChartModel(null)).toBeNull();
  });

  it('passes weeks through with partial, first and last partial, inside week full', () => {
    const model = weeklyChartModel(weekly('Alpha', THREE_WEEKS));
    expect(model?.bars.map((b) => b.calls)).toEqual([4, 9, 2]);
    expect(model?.bars.map((b) => b.partial)).toEqual([true, false, true]);
    expect(model?.hasPartial).toBe(true);
    expect(model?.allZero).toBe(false);
  });

  it('labels with the short date and a range with an en dash', () => {
    const model = weeklyChartModel(weekly('Alpha', THREE_WEEKS));
    expect(model?.bars[0]?.label).toBe('Sep 7');
    expect(model?.bars[0]?.range).toBe('Sep 7 – Sep 13');
  });

  it('keys each bar by its Monday, so a range over a year has no two bars alike', () => {
    const week = (weekStart: string, weekEnd: string) => ({ weekStart, weekEnd, calls: 1, partial: false });
    const model = weeklyChartModel(weekly('Alpha', [week('2025-09-08', '2025-09-14'), week('2026-09-07', '2026-09-13')]));
    expect(model?.bars.map((b) => b.key)).toEqual(['2025-09-08', '2026-09-07']);
    expect(model?.bars.map((b) => b.range)).toEqual(['Sep 8, 2025 – Sep 14, 2025', 'Sep 7, 2026 – Sep 13, 2026']);
  });

  it('keeps a zero-call week', () => {
    const model = weeklyChartModel(
      weekly('Alpha', [
        { weekStart: '2026-09-07', weekEnd: '2026-09-13', calls: 3, partial: false },
        { weekStart: '2026-09-14', weekEnd: '2026-09-20', calls: 0, partial: false },
      ]),
    );
    expect(model?.bars).toHaveLength(2);
    expect(model?.bars[1]?.calls).toBe(0);
    expect(model?.allZero).toBe(false);
  });

  it('hasPartial is false when every week is full', () => {
    const model = weeklyChartModel(weekly('Alpha', [{ weekStart: '2026-09-07', weekEnd: '2026-09-13', calls: 1, partial: false }]));
    expect(model?.hasPartial).toBe(false);
  });

  it('allZero is true when every bar is 0', () => {
    const model = weeklyChartModel(
      weekly('Alpha', [
        { weekStart: '2026-09-07', weekEnd: '2026-09-13', calls: 0, partial: false },
        { weekStart: '2026-09-14', weekEnd: '2026-09-20', calls: 0, partial: false },
      ]),
    );
    expect(model?.allZero).toBe(true);
  });

  it('handles a one-week range that is wholly partial', () => {
    const model = weeklyChartModel(weekly('Alpha', [{ weekStart: '2026-09-07', weekEnd: '2026-09-13', calls: 5, partial: true }]));
    expect(model?.bars).toHaveLength(1);
    expect(model?.bars[0]?.partial).toBe(true);
    expect(model?.hasPartial).toBe(true);
  });

  it('carries the campaign name unchanged in the title', () => {
    const long = 'x'.repeat(300);
    expect(weeklyChartModel(weekly(long, THREE_WEEKS))?.title).toBe(`Calls per week: ${long}`);
    expect(weeklyChartModel(weekly('<b>x</b>', THREE_WEEKS))?.title).toBe('Calls per week: <b>x</b>');
  });
});

/** The model for the chosen campaign (Alpha) from the real Campaigns builder. */
function realModel(search: string, store?: Parameters<typeof campaignsFor>[1]) {
  const model = weeklyChartModel(campaignsFor(search, store).weekly);
  if (model === null) throw new Error('expected a weekly chart');
  return model;
}
const flags = (model: ReturnType<typeof realModel>) => model.bars.map((b) => b.partial);

describe('weeklyChartModel on real server data', () => {
  it('flags the first and last week partial when the data ends inside them, and the inside week full', () => {
    // serverFixture: Sep 1 (a Tuesday) to Sep 14 (a Monday); Alpha has one call a day.
    const model = realModel('range=all');
    expect(model.bars.map((b) => b.range)).toEqual(['Aug 31 – Sep 6', 'Sep 7 – Sep 13', 'Sep 14 – Sep 20']);
    expect(model.bars.map((b) => b.label)).toEqual(['Aug 31', 'Sep 7', 'Sep 14']);
    expect(model.bars.map((b) => b.calls)).toEqual([6, 7, 1]);
    expect(flags(model)).toEqual([true, false, true]);
    expect(model.hasPartial).toBe(true);
    expect(model.allZero).toBe(false);
  });

  it('flags weeks cut by the range even when the data covers them', () => {
    const store = storeOverDates('2026-09-01', '2026-09-30');
    // Wed Sep 9 to Tue Sep 22: the Monday-to-Sunday weeks at both ends stick out of the range.
    expect(flags(realModel('start=2026-09-09&end=2026-09-22', store))).toEqual([true, false, true]);
    // Mon Sep 7 to Sun Sep 20: whole weeks, nothing partial, even though the data goes on both sides.
    const aligned = realModel('start=2026-09-07&end=2026-09-20', store);
    expect(flags(aligned)).toEqual([false, false]);
    expect(aligned.hasPartial).toBe(false);
    expect(aligned.bars.map((b) => b.calls)).toEqual([7, 7]);
  });

  it('flags a week the data cuts short even when the range is aligned to weeks', () => {
    // Data Sep 7 to Sep 17; range Mon Sep 7 to Sun Sep 20. The last week is only partly in the data,
    // and the first holds the data's first date.
    expect(flags(realModel('start=2026-09-07&end=2026-09-20', storeOverDates('2026-09-07', '2026-09-17')))).toEqual([
      true,
      true,
    ]);
  });

  it('reads correctly across a month boundary', () => {
    const model = realModel('range=all');
    expect(model.bars[0]?.label).toBe('Aug 31');
    expect(model.bars[0]?.range).toBe('Aug 31 – Sep 6');
  });

  it('reads correctly across a year boundary, with the year on every label', () => {
    // Mon Dec 28 2026 to Sun Jan 10 2027: two whole weeks; the first holds the data's first date, so it is partial.
    const whole = realModel('range=all', storeOverDates('2026-12-28', '2027-01-10'));
    expect(whole.bars.map((b) => b.label)).toEqual(['Dec 28, 2026', 'Jan 4, 2027']);
    expect(whole.bars.map((b) => b.range)).toEqual(['Dec 28, 2026 – Jan 3, 2027', 'Jan 4, 2027 – Jan 10, 2027']);
    expect(whole.bars.map((b) => b.calls)).toEqual([7, 7]);
    expect(flags(whole)).toEqual([true, false]);
    // Wed Dec 30 to Tue Jan 12: the weeks at both ends are partial and the middle one is not.
    const cut = realModel('range=all', storeOverDates('2026-12-30', '2027-01-12'));
    expect(cut.bars.map((b) => b.range)).toEqual(['Dec 28, 2026 – Jan 3, 2027', 'Jan 4, 2027 – Jan 10, 2027', 'Jan 11, 2027 – Jan 17, 2027']);
    expect(flags(cut)).toEqual([true, false, true]);
    expect(cut.bars.map((b) => b.calls)).toEqual([5, 7, 2]);
  });

  it('allZero and hasPartial on a range with no calls for the chosen campaign', () => {
    // Calls only on Sep 1 and Sep 30; Sep 10 to Sep 20 is empty. The week of Sep 7 starts before the range.
    const model = realModel('start=2026-09-10&end=2026-09-20', emptyRangeStore());
    expect(model.bars.map((b) => b.range)).toEqual(['Sep 7 – Sep 13', 'Sep 14 – Sep 20']);
    expect(model.bars.map((b) => b.calls)).toEqual([0, 0]);
    expect(model.allZero).toBe(true);
    expect(flags(model)).toEqual([true, false]);
    expect(model.hasPartial).toBe(true);
  });
});
