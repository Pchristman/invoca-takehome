// The one sentence for campaigns whose calls jumped or dropped. The test itself is in ../alerts.ts.
import { makeAction } from './facts';
import type { Action } from './facts';

export interface FlaggedCampaign {
  campaignId: string;
  name: string;
  direction: 'jump' | 'drop';
  z: number;
  current: number;
  previous: number;
}

const JUMP_TEMPLATE =
  'Calls to {alert.top.name} jumped from {alert.top.previous} to {alert.top.current}, more than chance explains. Find out what changed and whether to keep it going.';
const DROP_TEMPLATE =
  'Calls to {alert.top.name} dropped from {alert.top.previous} to {alert.top.current}, more than chance explains. Check that its tracking numbers, ads and budget are still running.';
const MANY_TEMPLATE =
  '{alert.count} changed by more than chance explains; {alert.top.name} moved most, from {alert.top.previous} to {alert.top.current}. Review each flagged campaign in the table.';

/** Plain character order, so results never depend on the machine's locale. */
export const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One action for all flagged campaigns, naming the biggest mover (largest |z|, ties by lower id). Null when none. */
export function alertAction(flagged: readonly FlaggedCampaign[]): Action | null {
  const sorted = [...flagged].sort((a, b) => Math.abs(b.z) - Math.abs(a.z) || byText(a.campaignId, b.campaignId));
  const top = sorted[0];
  if (!top) return null;

  const template = sorted.length > 1 ? MANY_TEMPLATE : top.direction === 'jump' ? JUMP_TEMPLATE : DROP_TEMPLATE;
  return makeAction(
    'review_call_changes',
    template,
    {
      'alert.count': { kind: 'count', value: sorted.length, noun: ['campaign', 'campaigns'] },
      'alert.top.name': { kind: 'name', value: top.name },
      'alert.top.direction': { kind: 'word', value: top.direction === 'jump' ? 'jumped' : 'dropped' },
      'alert.top.previous': { kind: 'count', value: top.previous },
      'alert.top.current': { kind: 'count', value: top.current, noun: ['call', 'calls'] },
    },
    { view: 'campaigns' },
  );
}
