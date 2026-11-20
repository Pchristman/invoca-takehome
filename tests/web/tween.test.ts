import { beforeEach, describe, expect, it } from 'vitest';
import { overviewModel } from '../../src/web/models/overviewModel';
import { formatCount, formatRate, formatUsd } from '../../src/core/views/format';
import { createTileTicker, forgetFigure, forgetFigures, formatFigure, recallFigure, rememberFigure, tweenPlan } from '../../src/web/models/tween';
import type { FigureKind, TweenAnimator } from '../../src/web/models/tween';
import { overviewFor } from './fixtures';

const tiles = overviewModel(overviewFor('range=last7')).tiles;

describe('formatFigure', () => {
  it('equals the core formatters applied to the raw API numbers, tile by tile', () => {
    const raw = overviewFor('range=last7').tiles;
    expect(tiles).toHaveLength(5);
    const expected: Record<string, string> = {
      calls: formatCount(raw.calls.current!),
      uniqueCallers: formatCount(raw.uniqueCallers.current!),
      answerRate: formatRate(raw.answerRate.current!),
      bookings: formatCount(raw.bookings.current!),
      revenueUsd: formatUsd(raw.revenueUsd.current!),
    };
    for (const tile of tiles) {
      expect(tile.figure).not.toBeNull();
      expect(formatFigure(tile.figure!.kind, tile.figure!.value), tile.key).toBe(expected[tile.key]);
      expect(tile.value, tile.key).toBe(expected[tile.key]);
    }
  });

  it('has no wrong frames: no NaN, and no fractions for counts and dollars', () => {
    for (const tile of tiles) {
      const { kind, value: to } = tile.figure!;
      for (let i = 0; i <= 20; i++) {
        const text = formatFigure(kind, 0 + ((to - 0) * i) / 20);
        expect(text).not.toMatch(/NaN|Infinity|undefined/);
        if (kind === 'count' || kind === 'usd') expect(text).not.toContain('.');
      }
    }
  });
});

describe('tweenPlan', () => {
  const base = { enabled: true, to: 12, shown: null, remembered: 10 };
  it('returns null when it must not move', () => {
    expect(tweenPlan({ ...base, enabled: false })).toBeNull();
    expect(tweenPlan({ ...base, to: null })).toBeNull();
    expect(tweenPlan({ ...base, remembered: null })).toBeNull(); // first load
    expect(tweenPlan({ ...base, remembered: 12 })).toBeNull(); // unchanged
    expect(tweenPlan({ ...base, shown: 12 })).toBeNull();
    expect(tweenPlan({ ...base, to: Infinity })).toBeNull();
    expect(tweenPlan({ ...base, to: NaN })).toBeNull();
    expect(tweenPlan({ ...base, remembered: NaN })).toBeNull();
    expect(tweenPlan({ ...base, shown: Infinity })).toBeNull();
  });
  it('starts from the remembered value, or from where the screen is', () => {
    expect(tweenPlan(base)).toEqual({ from: 10 });
    expect(tweenPlan({ ...base, shown: 11.4 })).toEqual({ from: 11.4 });
  });
});

describe('figure memory', () => {
  beforeEach(() => forgetFigures());
  it('remembers per id, replaces, and forgets', () => {
    expect(recallFigure('a')).toBeNull();
    rememberFigure('a', 5);
    expect(recallFigure('a')).toBe(5);
    expect(recallFigure('b')).toBeNull();
    rememberFigure('a', 7);
    expect(recallFigure('a')).toBe(7);
    forgetFigures();
    expect(recallFigure('a')).toBeNull();
  });
});

// A fake animator: the test moves the clock by hand.
function fakeAnimator() {
  const runs: { from: number; to: number; stopped: boolean; update(v: number): void; complete(): void }[] = [];
  const animate: TweenAnimator = (from, to, h) => {
    const run = { from, to, stopped: false, update: h.onUpdate, complete: h.onComplete };
    runs.push(run);
    return { stop: () => { run.stopped = true; } };
  };
  return { animate, runs };
}

describe('tile ticker', () => {
  const count = (value: number) => ({ value, kind: 'count' as FigureKind });
  function setup(id = 't') {
    forgetFigures();
    const writes: string[] = [];
    const fake = fakeAnimator();
    const ticker = createTileTicker({ id, write: (t) => writes.push(t) });
    const show = (value: number | null, text: string, enabled = true) =>
      ticker.show({ enabled, text, figure: value === null ? null : count(value), animate: fake.animate });
    return { writes, fake, ticker, show, last: () => writes[writes.length - 1] };
  }

  it('first load, unchanged and blank never tween', () => {
    const { fake, show, writes } = setup();
    show(10, '10');
    show(10, '10');
    show(null, '-');
    expect(fake.runs).toHaveLength(0);
    expect(writes.at(-1)).toBe('-');
  });

  it('counts to the new value and ends on the exact server text', () => {
    const { fake, show, last } = setup();
    show(10, '10');
    show(1000, '1,000');
    expect(fake.runs).toHaveLength(1);
    expect(fake.runs[0]).toMatchObject({ from: 10, to: 1000 });
    expect(last()).toBe('10');
    fake.runs[0]!.update(500.4);
    expect(last()).toBe('500');
    fake.runs[0]!.complete();
    expect(last()).toBe('1,000');
  });

  it('a retarget starts from the on-screen value, not the old target', () => {
    const { fake, show } = setup();
    show(10, '10');
    show(1000, '1,000');
    fake.runs[0]!.update(400);
    show(2000, '2,000');
    expect(fake.runs[0]!.stopped).toBe(true);
    expect(fake.runs[1]).toMatchObject({ from: 400, to: 2000 });
  });

  it('disabled writes the text at once', () => {
    const { fake, show, last } = setup();
    show(10, '10', false);
    show(1000, '1,000', false);
    expect(fake.runs).toHaveLength(0);
    expect(last()).toBe('1,000');
  });

  it('enabled flipping off mid-tween writes the final text and stops', () => {
    const { fake, show, last } = setup();
    show(10, '10');
    show(1000, '1,000');
    fake.runs[0]!.update(300);
    show(1000, '1,000', false);
    expect(fake.runs[0]!.stopped).toBe(true);
    expect(last()).toBe('1,000');
    fake.runs[0]!.update(301); // a late frame from the stopped run must not show
    fake.runs[0]!.complete();
    expect(last()).toBe('1,000');
  });

  it('stop cancels, and a remount counts from what the user last saw', () => {
    const { fake, show, ticker } = setup();
    show(10, '10');
    show(1000, '1,000');
    fake.runs[0]!.update(250);
    ticker.stop();
    expect(fake.runs[0]!.stopped).toBe(true);
    expect(recallFigure('t')).toBe(250);
    // A new ticker for the same id (the remount), without clearing the memory.
    const fake2 = fakeAnimator();
    const remount = createTileTicker({ id: 't', write: () => {} });
    remount.show({ enabled: true, text: '1,000', figure: count(1000), animate: fake2.animate });
    expect(fake2.runs[0]).toMatchObject({ from: 250, to: 1000 });
  });

  it('a finished tween remembers its target, and stop afterwards changes nothing', () => {
    const { fake, show, ticker } = setup();
    show(10, '10');
    show(1000, '1,000');
    fake.runs[0]!.complete();
    ticker.stop();
    expect(recallFigure('t')).toBe(1000);
  });

  it('value, blank, value does not tween (the blank forgets)', () => {
    const { fake, show } = setup();
    show(10, '10');
    show(null, '-');
    expect(recallFigure('t')).toBeNull();
    show(500, '500');
    expect(fake.runs).toHaveLength(0);
  });

  it('finish (before print) writes the exact text, stops the run, and is harmless when idle', () => {
    const { fake, show, ticker, last } = setup();
    ticker.finish();
    show(10, '10');
    show(1000, '1,000');
    fake.runs[0]!.update(123);
    ticker.finish();
    expect(fake.runs[0]!.stopped).toBe(true);
    expect(last()).toBe('1,000');
    expect(recallFigure('t')).toBe(1000);
  });
});

describe('forgetFigure', () => {
  it('clears one id only', () => {
    forgetFigures();
    rememberFigure('a', 1);
    rememberFigure('b', 2);
    forgetFigure('a');
    expect(recallFigure('a')).toBeNull();
    expect(recallFigure('b')).toBe(2);
  });
});
