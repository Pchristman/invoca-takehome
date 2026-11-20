import { beforeEach, describe, expect, it } from 'vitest';
import { overviewModel } from '../../src/web/models/overviewModel';
import { forgetFigures, formatFigure, recallFigure, rememberFigure, tweenPlan } from '../../src/web/models/tween';
import { overviewFor } from './fixtures';

const tiles = overviewModel(overviewFor('range=last7')).tiles;

describe('formatFigure', () => {
  it('equals the tile text for every tile', () => {
    expect(tiles).toHaveLength(5);
    for (const tile of tiles) {
      expect(tile.figure).not.toBeNull();
      expect(formatFigure(tile.figure!.kind, tile.figure!.value)).toBe(tile.value);
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
