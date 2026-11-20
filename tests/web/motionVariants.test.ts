import { describe, expect, it } from 'vitest';
import { MOTION_OFF, type MotionSettings } from '../../src/web/models/motionSettings';
import { chartAnimation, revealFor, transitionKey, type RevealKind } from '../../src/web/models/motionVariants';
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

  it.each(KINDS)('%s: with motion off nothing can stick at opacity 0', (kind) => {
    const reveal = revealFor(MOTION_OFF, kind);
    expect(reveal.initial).toEqual({ opacity: 1, y: 0 });
    expect(reveal.animate).toEqual(reveal.initial);
    expect(reveal.exit).toEqual(reveal.initial);
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

describe('transitionKey', () => {
  const base = parseUrlState('?view=campaigns');

  it('ignores everything except the view', () => {
    const other = parseUrlState(
      '?view=campaigns&range=last_7_days&start=2025-01-01&end=2025-01-31&compare_start=2025-02-01&compare_end=2025-02-28&campaign=c1&location=l1&dev=1&print=1',
    );
    expect(transitionKey(other)).toBe(transitionKey(base));
    expect(transitionKey({ ...base, campaign: 'x', location: 'y', dev: true, print: true })).toBe(transitionKey(base));
    expect(transitionKey({ ...base, range: null, compare: { start: 'a', end: 'b' } })).toBe(transitionKey(base));
  });

  it('differs for each of the four views', () => {
    const views = ['overview', 'campaigns', 'locations', 'missed-calls'] as const;
    const keys = views.map((view) => transitionKey({ ...base, view }));
    expect(new Set(keys).size).toBe(4);
  });

  it('is "answer" for an answer state, whatever its view', () => {
    const answer = parseUrlState('?answer&q=hello');
    expect(answer.answer).not.toBeNull();
    for (const view of ['overview', 'locations'] as const) {
      expect(transitionKey({ ...answer, view })).toBe('answer');
    }
  });
});
