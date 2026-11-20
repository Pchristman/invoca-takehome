import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { resolveComparison } from '../../src/core/comparison';
import { dataSpan, resolveRange } from '../../src/core/ranges';
import type { CallStore } from '../../src/core/types';
import { readExportFromDir } from '../../src/node/readDataDir';
import { buildCampaigns, buildOverview } from '../../src/core/views';
import { expectAllFinite } from '../core/views/fixtures';

type Preset = 'all' | 'last7' | 'last28';

// Observed on the two real exports, recorded not derived. If a change moves one of these, look at why.
const OBSERVED = {
  extended: {
    flagged: 2,
    drop: { current: 113, previous: 261 }, // cmp_06
    jump: { current: 342, previous: 218 }, // cmp_04
  },
};

function viewsFor(store: CallStore, preset: Preset) {
  const span = dataSpan(store.calls)!;
  const resolved = resolveRange(span, { kind: 'preset', preset });
  if (!resolved.ok) throw new Error(resolved.error.message);
  const comparison = resolveComparison(span, resolved.range);
  const previous = comparison.ok && comparison.comparison.available ? comparison.comparison.previous : undefined;
  const campaigns = buildCampaigns(store, resolved.range, previous);
  const overview = buildOverview(store, resolved.range, previous);
  expectAllFinite(campaigns, `campaigns ${preset}`);
  expectAllFinite(overview, `overview ${preset}`);
  return { campaigns, overview };
}

const hasChangeAction = (actions: { kind: string }[]) => actions.some((a) => a.kind === 'review_call_changes');

describe('alerts on the shipped export', () => {
  const store = cleanExport(readExportFromDir(join(__dirname, '..', 'fixtures', 'original-export')));

  it.each(['last7', 'last28'] as const)('%s: checked, nothing flagged, three top actions', (preset) => {
    const { campaigns, overview } = viewsFor(store, preset);
    expect(campaigns.alerts.checked).toBe(true);
    expect(campaigns.alerts.flagged).toBe(0);
    expect(hasChangeAction(campaigns.actions)).toBe(false);
    expect(overview.topActions).toHaveLength(3);
  });

  it('all: no previous period, so not checked', () => {
    expect(viewsFor(store, 'all').campaigns.alerts.checked).toBe(false);
  });
});

describe('alerts on the extended export', () => {
  const store = cleanExport(readExportFromDir(join(__dirname, '..', '..', 'data', 'extended')));
  const nameOf = (id: string) => store.campaigns.find((c) => c.id === id)!.name;

  it('last28: flags the fade as a drop and the surge as a jump', () => {
    const { campaigns, overview } = viewsFor(store, 'last28');
    expect(campaigns.alerts.checked).toBe(true);
    expect(campaigns.alerts.flagged).toBe(OBSERVED.extended.flagged);

    const fade = campaigns.rows.find((r) => r.campaignId === 'cmp_06')!;
    expect(fade.alert?.direction).toBe('drop');
    expect([fade.calls, fade.previousCalls]).toEqual([OBSERVED.extended.drop.current, OBSERVED.extended.drop.previous]);

    const surge = campaigns.rows.find((r) => r.campaignId === 'cmp_04')!;
    expect(surge.alert?.direction).toBe('jump');
    expect([surge.calls, surge.previousCalls]).toEqual([OBSERVED.extended.jump.current, OBSERVED.extended.jump.previous]);

    const action = campaigns.actions.find((a) => a.kind === 'review_call_changes')!;
    expect(action.text.startsWith('2 campaigns changed')).toBe(true);
    expect(action.text).toContain(nameOf('cmp_06'));

    expect(overview.topActions).toHaveLength(4);
    expect(overview.topActions[1]!.action.kind).toBe('review_call_changes');
  });

  it('last7: nothing flagged', () => {
    expect(viewsFor(store, 'last7').campaigns.alerts.flagged).toBe(0);
  });

  it('all: not checked', () => {
    expect(viewsFor(store, 'all').campaigns.alerts.checked).toBe(false);
  });
});
