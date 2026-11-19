import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { inclusiveDays } from '../../src/core/localDate';
import { callsInRange } from '../../src/core/metrics';
import { dataSpan, resolveRange } from '../../src/core/ranges';
import type { RangeSpec } from '../../src/core/ranges';
import { readExportFromDir } from '../../src/node/readDataDir';
import { buildCampaigns, buildLocations, buildMissedCalls, buildOverview, formatUsdPerDollar } from '../../src/core/views';
import type { Action } from '../../src/core/views';
import { expectAllFinite } from '../core/views/fixtures';

const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'original-export');

// Observed on the shipped export over all data, recorded not derived. If a change moves one of these, look at why.
const OBSERVED = {
  callbackRows: 445,
  callbackTotalValueUsd: 50082.13,
};

const store = cleanExport(readExportFromDir(FIXTURE_DIR));
const span = dataSpan(store.calls)!;
const resolve = (spec: RangeSpec) => {
  const result = resolveRange(span, spec);
  if (!result.ok) throw new Error(result.error.message);
  return result.range;
};
const all = resolve({ kind: 'preset', preset: 'all' });
const last28 = resolve({ kind: 'preset', preset: 'last28' });

const overview = buildOverview(store, all);
const campaigns = buildCampaigns(store, all);
const locations = buildLocations(store, all);
const missed = buildMissedCalls(store, all);

describe('shipped export, views over all data', () => {
  it('overview tiles match the known totals', () => {
    expect(overview.tiles.calls.current).toBe(5000);
    expect(overview.tiles.bookings.current).toBe(1204);
    expect(overview.tiles.revenueUsd.current).toBe(432894);
    expect(overview.tiles.uniqueCallers.current).toBe(2040);
    for (const tile of Object.values(overview.tiles)) expect(tile.change.kind).toBe('none');
    const answerRate = overview.tiles.answerRate.current!;
    expect(answerRate).toBeGreaterThan(0);
    expect(answerRate).toBeLessThan(1);
  });

  it("campaigns: best and worst are the original's", () => {
    expect(campaigns.rows.find((r) => r.isBest)?.campaignId).toBe('cmp_11');
    expect(campaigns.rows.find((r) => r.isWorst)?.campaignId).toBe('cmp_07');

    const shift = campaigns.actions[0]!;
    expect(shift.kind).toBe('shift_budget');
    for (const row of campaigns.rows.filter((r) => r.isBest || r.isWorst)) {
      const name = store.campaigns.find((c) => c.id === row.campaignId)!.name;
      expect(shift.text).toContain(name);
      expect(shift.text).toContain(`${formatUsdPerDollar(row.revenuePerBudgetDollar!)} revenue per budget dollar`);
    }
  });

  it('campaigns: unattributed is 144 calls on 10 numbers', () => {
    expect(campaigns.unattributed?.calls).toBe(144);
    expect(campaigns.unattributed?.trackingNumbers).toHaveLength(10);
    expect(campaigns.actions[1]?.kind).toBe('fix_attribution');
  });

  it('locations: nothing stands out', () => {
    for (const row of locations.rows) {
      expect([row.locationId, row.answerFlag.flagged, row.bookingFlag.flagged]).toEqual([row.locationId, false, false]);
    }
    expect(locations.actions[0]?.kind).toBe('no_office_stands_out');
  });

  it('missed calls: the totals', () => {
    expect(missed.unansweredCalls).toBe(1055);
    expect(missed.heatmap.byOffice.reduce((sum, r) => sum + r.total, 0)).toBe(1055);
    expect(missed.heatmap.byWeekday.reduce((sum, r) => sum + r.total, 0)).toBe(1055);
    expect(missed.lostValue.estimatedUsd).toBeGreaterThan(0);

    const unansweredCallers = new Set(
      callsInRange(store.calls, all)
        .filter((c) => !c.answered && c.callerHash !== '')
        .map((c) => c.callerHash),
    );
    expect(missed.callbacks.rows.length).toBeLessThanOrEqual(unansweredCallers.size);
    for (const row of missed.callbacks.rows) expect(row.estimatedValueUsd).toBeGreaterThanOrEqual(0);
    expect(missed.actions[0]?.kind).toBe('call_back');

    expect(missed.callbacks.rows.length).toBe(OBSERVED.callbackRows);
    expect(missed.callbacks.totalValueUsd).toBe(OBSERVED.callbackTotalValueUsd);
  });
});

describe('shipped export, last 28 days', () => {
  it('last 28 days compares with a full 28 days', () => {
    const view = buildOverview(store, last28);
    expect(view.notes.comparison.available).toBe(true);
    const previous = view.notes.comparison.previous!;
    expect(inclusiveDays(previous.start, previous.end)).toBe(28);
    expect(['percent', 'new']).toContain(view.tiles.calls.change.kind);
    expect(view.tiles.calls.previous).not.toBeNull();
  });
});

describe('shipped export, every view', () => {
  it('is finite and every action text has no unfilled placeholder', () => {
    const views = [overview, campaigns, locations, missed, buildOverview(store, last28), buildCampaigns(store, last28)];
    for (const view of views) {
      expectAllFinite(view);
      const actions: Action[] = [...view.actions, ...(view.view === 'overview' ? view.topActions.map((t) => t.action) : [])];
      for (const action of actions) {
        expect(action.text.length).toBeGreaterThan(0);
        expect(action.text).not.toContain('{');
      }
      expect(view.templateSentence).not.toContain('{');
    }
  });
});
