import { describe, expect, it } from 'vitest';
import { alertAction } from '../../../src/core/views/campaignAlerts';
import { makeFactSheet } from '../../../src/core/views/facts';
import type { FlaggedCampaign } from '../../../src/core/views/campaignAlerts';

const flag = (over: Partial<FlaggedCampaign>): FlaggedCampaign => ({
  campaignId: 'cmp_a',
  name: 'Alpha',
  direction: 'jump',
  z: 3.5,
  current: 60,
  previous: 30,
  ...over,
});

describe('alertAction', () => {
  it('is null when nothing is flagged', () => {
    expect(alertAction([])).toBeNull();
  });

  it('one jump', () => {
    const action = alertAction([flag({})])!;
    expect(action.text).toBe(
      'Calls to Alpha jumped from 30 to 60 calls, more than chance explains. Find out what changed and whether to keep it going.',
    );
    expect(action.kind).toBe('review_call_changes');
    expect(action.actionable).toBe(true);
    expect(action.link).toEqual({ view: 'campaigns' });
  });

  it('states the biggest mover direction as a word fact that is not a name', () => {
    const jump = alertAction([flag({})])!;
    expect(jump.facts['alert.top.direction']).toEqual({ kind: 'word', value: 'jumped' });
    const drop = alertAction([flag({ direction: 'drop', previous: 60, current: 20 })])!;
    expect(drop.facts['alert.top.direction']).toEqual({ kind: 'word', value: 'dropped' });
    expect(makeFactSheet('campaigns', jump.facts).entities).toEqual(['Alpha']);
  });

  it('one drop', () => {
    const action = alertAction([flag({ direction: 'drop', previous: 60, current: 20 })])!;
    expect(action.text).toBe(
      'Calls to Alpha dropped from 60 to 20 calls, more than chance explains. Check that its tracking numbers, ads and budget are still running.',
    );
  });

  it('two or more name the biggest mover', () => {
    const a = flag({ z: 3.2 });
    const b = flag({ campaignId: 'cmp_b', name: 'Beta', direction: 'drop', previous: 60, current: 20, z: -4.5 });
    const text = 'Review each flagged campaign in the table.';
    expect(alertAction([a, b])!.text).toBe(
      `2 campaigns changed by more than chance explains; Beta moved most, from 60 to 20 calls. ${text}`,
    );
    expect(alertAction([b, a])).toEqual(alertAction([a, b]));
  });

  it('does not reorder the caller array and breaks ties by lower id', () => {
    const list = [flag({ campaignId: 'cmp_b', name: 'Beta' }), flag({ campaignId: 'cmp_a' })];
    expect(alertAction(list)!.text).toContain('Alpha moved most');
    expect(list[0]!.campaignId).toBe('cmp_b');
  });

  it('reads the singular', () => {
    const action = alertAction([flag({ previous: 0, current: 1 })])!;
    expect(action.text).toContain('from 0 to 1 call,');
  });
});
