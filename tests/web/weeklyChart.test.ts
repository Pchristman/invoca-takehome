import { describe, expect, it } from 'vitest';
import type { CampaignsView } from '../../src/core/views';
import { weeklyChartModel } from '../../src/web/models/weeklyChart';

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
