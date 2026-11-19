import { describe, expect, test } from 'vitest';
import { ActionKind, fillPlaceholders, formatFact, makeAction, makeFactSheet } from '../../../src/core/views/facts';

describe('formatFact', () => {
  test('each kind', () => {
    expect(formatFact({ kind: 'rate', value: 0.5 })).toBe('50.0%');
    expect(formatFact({ kind: 'weekday', value: 1 })).toBe('Tuesday');
    expect(formatFact({ kind: 'name', value: 'Alpha' })).toBe('Alpha');
    expect(formatFact({ kind: 'count', value: 1, noun: ['call', 'calls'] })).toBe('1 call');
    expect(formatFact({ kind: 'usd', value: 12 })).toBe('$12');
    expect(formatFact({ kind: 'usd_per_dollar', value: 4.2857 })).toBe('$4.29');
    expect(formatFact({ kind: 'usd_per_dollar', value: 2 })).toBe('$2.00');
    expect(formatFact({ kind: 'hour', value: 9 })).toBe('09:00');
    expect(formatFact({ kind: 'percent_change', value: 8.2235 })).toBe('+8.2%');
    expect(formatFact({ kind: 'points_change', value: 5 })).toBe('+5.0 points');
  });
  test('throws on non-finite numbers', () => {
    expect(() => formatFact({ kind: 'usd', value: NaN })).toThrow();
    expect(() => formatFact({ kind: 'rate', value: Infinity })).toThrow();
    expect(() => formatFact({ kind: 'usd_per_dollar', value: NaN })).toThrow();
  });
});

describe('fillPlaceholders', () => {
  const facts = { 'a.x': { kind: 'name', value: 'Alpha' }, 'a.n': { kind: 'count', value: 3 } } as const;
  test('fills, including repeats', () => {
    expect(fillPlaceholders('{a.x} and {a.x} got {a.n}', facts)).toBe('Alpha and Alpha got 3');
  });
  test('no braces is unchanged', () => expect(fillPlaceholders('plain', facts)).toBe('plain'));
  test('unknown keys throw and are named', () => {
    expect(() => fillPlaceholders('{nope}', facts)).toThrow(/nope/);
    expect(() => fillPlaceholders('{one} {two}', facts)).toThrow(/one.*two|two.*one/);
  });
  test('malformed placeholders throw and are named', () => {
    expect(() => fillPlaceholders('Call {Office} now', facts)).toThrow(/\{Office\}/);
    expect(() => fillPlaceholders('{a x}', facts)).toThrow(/a x/);
    expect(() => fillPlaceholders('{}', facts)).toThrow(/Malformed/);
  });
});

describe('makeFactSheet', () => {
  test('distinct names in character order, ignoring other facts', () => {
    const s = makeFactSheet('campaigns', {
      a: { kind: 'name', value: 'b' }, b: { kind: 'name', value: 'B' }, c: { kind: 'name', value: 'b' },
      d: { kind: 'count', value: 2 },
    });
    expect(s.view).toBe('campaigns');
    expect(s.entities).toEqual(['B', 'b']);
  });
  test('no names', () => expect(makeFactSheet('overview', {}).entities).toEqual([]));
});

describe('makeAction', () => {
  const kinds: [ActionKind, boolean][] = [
    ['shift_budget', true], ['fix_attribution', true], ['review_office_answer', true],
    ['review_office_booking', true], ['call_back', true],
    ['no_budget_shift', false], ['no_office_stands_out', false], ['no_office_worse', false],
    ['no_missed_calls', false], ['no_callbacks', false],
  ];
  test.each(kinds)('%s actionable=%s', (kind, actionable) => {
    const a = makeAction(kind, 'Hello {x}', { x: { kind: 'name', value: 'Z' } }, { view: 'overview' });
    expect(a.text).toBe('Hello Z');
    expect(a.actionable).toBe(actionable);
    expect(a.kind).toBe(kind);
    expect(a.template).toBe('Hello {x}');
  });
});
