import { describe, expect, test } from 'vitest';
import {
  isValidTimeZone,
  normalizeTimeZone,
  parseBoolean,
  parseEnum,
  parseInteger,
  parseMoney,
  parseTimestamp,
} from '../../src/core/fields';

describe('parseTimestamp', () => {
  test.each(['2026-09-01T00:39:12Z', '2026-09-01T00:39:12.500Z'])('accepts %s', (s) => {
    expect(parseTimestamp(s)?.toISOString().slice(0, 19)).toBe(s.slice(0, 19));
  });

  test('accepts surrounding whitespace and returns the exact UTC instant', () => {
    expect(parseTimestamp('  2026-09-01T00:39:12Z ')?.getTime()).toBe(Date.UTC(2026, 8, 1, 0, 39, 12));
  });

  test.each([
    '',
    'garbage',
    '2026-09-01 00:39:12',
    '2026-09-01T00:39:12',
    '2026-09-01T00:39:12+02:00',
    '2026-02-30T10:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-09-01T24:00:00Z',
    '2026-09-01',
  ])('rejects %j', (s) => {
    expect(parseTimestamp(s)).toBeNull();
  });
});

describe('parseBoolean', () => {
  test.each([
    ['true', true],
    ['TRUE', true],
    [' false ', false],
  ])('parses %j', (s, expected) => {
    expect(parseBoolean(s)).toBe(expected);
  });

  test.each(['', 'yes', '1', 't', 'null'])('rejects %j', (s) => {
    expect(parseBoolean(s)).toBeNull();
  });
});

describe('parseEnum', () => {
  const allowed = ['booked', 'missed'] as const;
  test('exact value passes after trim', () => {
    expect(parseEnum(' booked ', allowed)).toBe('booked');
  });
  test('is case-sensitive: the enum is the documented contract', () => {
    expect(parseEnum('Booked', allowed)).toBeNull();
  });
  test('empty and unknown are null', () => {
    expect(parseEnum('', allowed)).toBeNull();
    expect(parseEnum('won', allowed)).toBeNull();
  });
});

describe('parseInteger', () => {
  test.each([
    ['97', 97],
    ['0', 0],
    ['-5', -5],
  ])('parses %j', (s, expected) => {
    expect(parseInteger(s)).toBe(expected);
  });
  test.each(['', '1.5', 'abc', '1e3'])('rejects %j', (s) => {
    expect(parseInteger(s)).toBeNull();
  });
});

describe('parseMoney', () => {
  test.each([
    ['89', 89],
    ['432.50', 432.5],
    ['0', 0],
    ['-3.25', -3.25],
  ])('parses %j', (s, expected) => {
    expect(parseMoney(s)).toBe(expected);
  });
  test.each(['', '$5', '1,200', 'NaN', 'Infinity', '1e3'])('rejects %j', (s) => {
    expect(parseMoney(s)).toBeNull();
  });
});

describe('isValidTimeZone', () => {
  test.each(['America/Phoenix', 'America/New_York', 'UTC'])('accepts %s', (tz) => {
    expect(isValidTimeZone(tz)).toBe(true);
  });
  test.each(['Mars/Olympus', '', '   ', '+05:00', '-0700', '+05', '-08:00'])('rejects %j', (tz) => {
    expect(isValidTimeZone(tz)).toBe(false);
  });
  test('accepts tzdb aliases (they are IANA identifiers)', () => {
    expect(isValidTimeZone('EST')).toBe(true);
    expect(isValidTimeZone('US/Arizona')).toBe(true);
  });
});

describe('normalizeTimeZone', () => {
  test('returns the canonical IANA spelling', () => {
    expect(normalizeTimeZone('america/phoenix')).toBe('America/Phoenix');
    expect(normalizeTimeZone(' America/Denver ')).toBe('America/Denver');
  });
  test('returns null for offsets and unknown names', () => {
    expect(normalizeTimeZone('+05:00')).toBeNull();
    expect(normalizeTimeZone('Mars/Olympus')).toBeNull();
    expect(normalizeTimeZone('')).toBeNull();
  });
});

describe('negative zero and huge numbers', () => {
  test('-0 parses as plain 0, not negative zero', () => {
    expect(Object.is(parseInteger('-0'), 0)).toBe(true);
    expect(Object.is(parseMoney('-0'), 0)).toBe(true);
    expect(Object.is(parseMoney('-0.00'), 0)).toBe(true);
  });
  test('numbers too large to be exact are rejected', () => {
    expect(parseInteger('99999999999999999999')).toBeNull();
    expect(parseMoney('9'.repeat(400))).toBeNull();
  });
});
