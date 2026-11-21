import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { resolveComparison } from '../../src/core/comparison';
import { callsInRange } from '../../src/core/metrics';
import { dataSpan, resolveRange } from '../../src/core/ranges';
import type { CallStore } from '../../src/core/types';
import { readExportFromDir } from '../../src/node/readDataDir';
import { buildCampaigns, buildLocations, buildMissedCalls, buildOverview } from '../../src/core/views';
import { expectAllFinite } from '../core/views/fixtures';

const EXTENDED_DIR = join(__dirname, '..', '..', 'data', 'extended');

// Observed on the committed seed, recorded not derived.
const OBSERVED = {
  // cmp_04 / cmp_06 calls in the last 28 days against the 28 before (same as extended-export.test.ts).
  surge: { current: 342, previous: 218 },
  fade: { current: 113, previous: 261 },
  // Which Locations action is the headline (largest |z| among the worse flags).
  headline: 'review_office_answer',
};

const store: CallStore = cleanExport(readExportFromDir(EXTENDED_DIR));
const span = dataSpan(store.calls)!;
const rangeFor = (preset: 'all' | 'last28') => {
  const result = resolveRange(span, { kind: 'preset', preset });
  if (!result.ok) throw new Error(result.error.message);
  return result.range;
};
const all = rangeFor('all');
const nameOf = (id: string) => store.locations.find((l) => l.id === id)!.name;

describe('extended export views: Locations', () => {
  const view = buildLocations(store, all);

  it('flags exactly the two planted flags', () => {
    const found = view.rows.flatMap((r) => [
      ...(r.answerFlag.flagged ? [`${r.locationId} answer ${r.answerFlag.direction}`] : []),
      ...(r.bookingFlag.flagged ? [`${r.locationId} booking ${r.bookingFlag.direction}`] : []),
    ]);
    expect(found.sort()).toEqual(['loc_02 booking worse', 'loc_06 answer worse']);
  });

  it('the locations action is for a planted office', () => {
    const action = view.actions[0]!;
    expect(['review_office_answer', 'review_office_booking']).toContain(action.kind);
    expect(action.text.includes(nameOf('loc_06')) || action.text.includes(nameOf('loc_02'))).toBe(true);
    expect(action.kind).toBe(OBSERVED.headline);
    if (action.kind === 'review_office_answer') expect(action.link.locationId).toBe('loc_06');
  });
});

describe('extended export views: Missed calls filtered to Canyon', () => {
  const view = buildMissedCalls(store, all, undefined, { locationId: 'loc_06' });

  it('names Canyon, finds a weekday-morning slot and counts its misses', () => {
    expect(view.officeFilter?.name).toBe(nameOf('loc_06'));
    expect(view.busiestSlot?.weekday).toBeGreaterThanOrEqual(0);
    expect(view.busiestSlot?.weekday).toBeLessThanOrEqual(4);
    expect(view.busiestSlot?.hour).toBeGreaterThanOrEqual(9);
    expect(view.busiestSlot?.hour).toBeLessThanOrEqual(11);
    const expected = callsInRange(store.calls, all).filter((c) => c.locationId === 'loc_06' && !c.answered).length;
    expect(view.unansweredCalls).toBe(expected);
  });
});

describe('extended export views: Campaigns over the last 28 days', () => {
  const last28 = rangeFor('last28');
  const comparison = resolveComparison(span, last28);
  if (!comparison.ok || !comparison.comparison.available) throw new Error('no previous 28 days');
  const previous = comparison.comparison.previous;

  it('see the surge and the fade', () => {
    const overview = buildOverview(store, last28, previous);
    expect(overview.notes.comparison.available).toBe(true);
    const campaigns = buildCampaigns(store, last28, previous);
    expect(campaigns.rows.find((r) => r.campaignId === 'cmp_04')?.calls).toBe(OBSERVED.surge.current);
    expect(campaigns.rows.find((r) => r.campaignId === 'cmp_06')?.calls).toBe(OBSERVED.fade.current);
  });
});

describe('extended export views: finite', () => {
  it('every view is finite', () => {
    expectAllFinite(buildOverview(store, all), 'overview');
    expectAllFinite(buildCampaigns(store, all), 'campaigns');
    expectAllFinite(buildLocations(store, all), 'locations');
    expectAllFinite(buildMissedCalls(store, all), 'missed-calls');
    expectAllFinite(buildMissedCalls(store, all, undefined, { locationId: 'loc_06' }), 'missed-calls loc_06');
  });
});
