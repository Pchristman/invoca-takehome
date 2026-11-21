import { describe, expect, it } from 'vitest';
import { MOTION_OFF, type MotionSettings } from '../../src/web/models/motionSettings';
import { chartAnimation, contentKey, revealFor, type RevealKind } from '../../src/web/models/motionVariants';
import { parseUrlState } from '../../src/web/urlState';

const ON: MotionSettings = { enabled: true, fast: 0.15, base: 0.25, slow: 0.3, ease: [0.2, 0, 0, 1] };
const KINDS: RevealKind[] = ['view', 'panel', 'takeaway'];

describe('revealFor', () => {
  it.each(KINDS)('%s: fades in from opacity 0 and rests at full', (kind) => {
    const reveal = revealFor(ON, kind);
    expect(reveal.initial.opacity).toBe(0);
    expect(reveal.animate).toEqual({ opacity: 1, y: 0 });
    expect(reveal.exit.opacity).toBe(0);
    expect(reveal.exit.y).toBe(0);
    expect(reveal.transition.ease).toEqual(ON.ease);
    expect(reveal.transition.duration).toBeLessThanOrEqual(0.3);
  });

  it('uses base for views and panels, fast for takeaways', () => {
    expect(revealFor(ON, 'view').transition.duration).toBe(ON.base);
    expect(revealFor(ON, 'panel').transition.duration).toBe(ON.base);
    expect(revealFor(ON, 'takeaway').transition.duration).toBe(ON.fast);
  });

  it.each(KINDS)('%s: exit takes at most the fast time, with the same ease', (kind) => {
    const reveal = revealFor(ON, kind);
    expect(reveal.exit.transition.duration).toBeLessThanOrEqual(ON.fast);
    expect(reveal.exit.transition.ease).toEqual(ON.ease);
  });

  it('a view leaves in half the fast time, since the next view waits for it; panels and takeaways take fast', () => {
    expect(revealFor(ON, 'view').exit.transition.duration).toBe(ON.fast / 2);
    expect(revealFor(ON, 'panel').exit.transition.duration).toBe(ON.fast);
    expect(revealFor(ON, 'takeaway').exit.transition.duration).toBe(ON.fast);
  });

  it.each(KINDS)('%s: with motion off the exit takes no time', (kind) => {
    expect(revealFor(MOTION_OFF, kind).exit.transition.duration).toBe(0);
  });

  it.each(KINDS)('%s: with motion off nothing can stick at opacity 0', (kind) => {
    const reveal = revealFor(MOTION_OFF, kind);
    expect(reveal.initial).toEqual({ opacity: 1, y: 0 });
    expect(reveal.animate).toEqual(reveal.initial);
    expect({ opacity: reveal.exit.opacity, y: reveal.exit.y }).toEqual(reveal.initial);
    expect(reveal.transition.duration).toBe(0);
  });
});

describe('chartAnimation', () => {
  it('is on, in milliseconds, when motion is enabled', () => {
    const chart = chartAnimation(ON);
    expect(chart.isAnimationActive).toBe(true);
    expect(chart.animationDuration).toBeCloseTo(ON.base * 1000);
    expect(chart.animationEasing).toBe('ease-out');
  });

  it('is off when motion is off', () => {
    expect(chartAnimation(MOTION_OFF).isAnimationActive).toBe(false);
  });
});

describe('contentKey', () => {
  const base = parseUrlState('?view=campaigns');
  it('changes when the range or the comparison changes, so the content transitions like a tab switch', () => {
    expect(contentKey({ ...base, range: { kind: 'preset', preset: 'last7' } })).not.toBe(contentKey(base));
    expect(contentKey({ ...base, range: { kind: 'custom', start: '2026-09-01', end: '2026-09-07' } })).not.toBe(contentKey(base));
    expect(contentKey({ ...base, compare: { start: '2026-08-01', end: '2026-08-07' } })).not.toBe(contentKey(base));
  });
  it('still ignores the campaign, the office, dev and print', () => {
    expect(contentKey({ ...base, campaign: 'x', location: 'y', dev: true, print: true })).toBe(contentKey(base));
  });
  it('still ignores the sorts and the heatmap mode, which live in the URL and survive the remount', () => {
    const sorted = { ...base, campaignSort: { key: 'name', dir: 'asc' } as const, heatmap: 'weekday' as const };
    expect(contentKey(sorted)).toBe(contentKey(base));
  });
  it('differs for each of the four views', () => {
    const views = ['overview', 'campaigns', 'locations', 'missed-calls'] as const;
    expect(new Set(views.map((view) => contentKey({ ...base, view }))).size).toBe(4);
  });
  it('is the same answer key for an answer state, whatever its view', () => {
    const answer = parseUrlState('?answer');
    expect(contentKey({ ...answer, view: 'overview' })).toBe(contentKey({ ...answer, view: 'locations' }));
    expect(contentKey({ ...answer, view: 'overview' })).not.toBe(contentKey({ ...answer, answer: null, view: 'overview' }));
  });
});
