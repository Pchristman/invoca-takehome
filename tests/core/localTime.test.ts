import { describe, expect, test } from 'vitest';
import { localParts } from '../../src/core/localTime';

const at = (iso: string, zone: string) => localParts(new Date(iso), zone);

describe('localParts', () => {
  test('a call at 02:00 UTC is the previous local day in Denver', () => {
    expect(at('2026-10-05T02:00:00Z', 'America/Denver')).toEqual({ date: '2026-10-04', hour: 20, weekday: 6 });
  });

  test('Phoenix and Denver differ by an hour for the same instant in the same week', () => {
    const phoenix = at('2026-09-15T20:00:00Z', 'America/Phoenix');
    const denver = at('2026-09-15T20:00:00Z', 'America/Denver');
    expect(phoenix.hour).toBe(13);
    expect(denver.hour).toBe(14);
    expect(phoenix.date).toBe('2026-09-15');
    expect(denver.date).toBe('2026-09-15');
  });

  test('Phoenix has no DST change but Denver does', () => {
    expect(at('2026-10-30T20:00:00Z', 'America/Phoenix').hour).toBe(13);
    expect(at('2026-10-30T20:00:00Z', 'America/Denver').hour).toBe(14);
    expect(at('2026-11-02T20:00:00Z', 'America/Phoenix').hour).toBe(13);
    expect(at('2026-11-02T20:00:00Z', 'America/Denver').hour).toBe(13);
  });

  test('midnight local is hour 0, never 24', () => {
    expect(at('2026-10-05T06:00:00Z', 'America/Denver')).toMatchObject({ date: '2026-10-05', hour: 0 });
  });

  test('the repeated hour when clocks fall back stays valid', () => {
    for (const iso of ['2026-11-01T07:30:00Z', '2026-11-01T08:30:00Z']) {
      expect(at(iso, 'America/Denver')).toMatchObject({ date: '2026-11-01', hour: 1 });
    }
  });

  test('year boundary', () => {
    expect(at('2027-01-01T03:00:00Z', 'America/New_York')).toEqual({ date: '2026-12-31', hour: 22, weekday: 3 });
  });

  test('weekday numbering: Monday is 0, Sunday is 6', () => {
    expect(at('2026-10-05T12:00:00Z', 'UTC').weekday).toBe(0);
    expect(at('2026-10-11T12:00:00Z', 'UTC').weekday).toBe(6);
  });

  test('a zone ahead of UTC moves the date forward', () => {
    expect(at('2026-10-05T20:00:00Z', 'Pacific/Auckland').date).toBe('2026-10-06');
  });
});
