import { describe, expect, test } from 'vitest';
import {
  formatCount, formatHour, formatPercentChange, formatPointsChange, formatRate, formatUsd, formatWeekday,
} from '../../../src/core/views/format';

describe('formatUsd', () => {
  test.each([
    [23.33, '$23'], [1234.5, '$1,235'], [0.4, '$0'], [-0.2, '$0'], [-5, '-$5'], [432894, '$432,894'],
  ])('%s', (v, s) => expect(formatUsd(v)).toBe(s));
});

describe('formatRate', () => {
  test.each([[0.3, '30.0%'], [0, '0.0%'], [1, '100.0%'], [0.78945, '78.9%']])('%s', (v, s) =>
    expect(formatRate(v)).toBe(s));
});

describe('formatCount', () => {
  test('nouns and separators', () => {
    expect(formatCount(1, ['call', 'calls'])).toBe('1 call');
    expect(formatCount(0, ['call', 'calls'])).toBe('0 calls');
    expect(formatCount(3, ['call', 'calls'])).toBe('3 calls');
    expect(formatCount(1204, ['booking', 'bookings'])).toBe('1,204 bookings');
    expect(formatCount(1204)).toBe('1,204');
  });
});

describe('formatWeekday and formatHour', () => {
  test('weekday', () => {
    expect(formatWeekday(0)).toBe('Monday');
    expect(formatWeekday(6)).toBe('Sunday');
  });
  test('hour', () => {
    expect(formatHour(0)).toBe('00:00');
    expect(formatHour(9)).toBe('09:00');
    expect(formatHour(23)).toBe('23:00');
  });
});

describe('change formats', () => {
  test.each([[8.2235, '+8.2%'], [-3, '-3.0%'], [0, '0.0%'], [0.04, '0.0%'], [-0.04, '0.0%']])('percent %s', (v, s) =>
    expect(formatPercentChange(v)).toBe(s));
  test.each([[5, '+5.0 points'], [-5.25, '-5.3 points'], [0, '0.0 points']])('points %s', (v, s) =>
    expect(formatPointsChange(v)).toBe(s));
});
