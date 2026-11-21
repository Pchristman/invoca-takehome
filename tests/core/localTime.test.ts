import { describe, expect, test } from 'vitest';
import { localDateTime, localParts } from '../../src/core/localTime';

describe('localDateTime', () => {
  const when = (iso: string, zone: string) => localDateTime(new Date(iso), zone);

  test('formats date and time in the zone', () => {
    expect(when('2026-09-10T16:05:00Z', 'America/Phoenix')).toBe('2026-09-10 09:05');
    expect(when('2026-09-10T16:05:00Z', 'America/Denver')).toBe('2026-09-10 10:05');
  });

  test('early UTC is the previous local day', () => {
    expect(when('2026-09-10T06:30:00Z', 'America/Phoenix')).toBe('2026-09-09 23:30');
  });

  test('local midnight is 00:00, never 24:00', () => {
    expect(when('2026-09-10T07:00:00Z', 'America/Phoenix')).toBe('2026-09-10 00:00');
  });

  test('a half-hour zone keeps its minutes', () => {
    expect(when('2031-05-10T20:00:00Z', 'Asia/Kolkata')).toBe('2031-05-11 01:30');
  });
});

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

  test('when clocks spring forward, no call lands in the skipped hour', () => {
    // Denver, 2026-03-08: 02:00 MST jumps to 03:00 MDT, so local hour 2 does not exist that day.
    expect(at('2026-03-08T08:59:00Z', 'America/Denver')).toEqual({ date: '2026-03-08', hour: 1, weekday: 6 });
    expect(at('2026-03-08T09:00:00Z', 'America/Denver')).toEqual({ date: '2026-03-08', hour: 3, weekday: 6 });
    expect(at('2026-03-08T09:30:00Z', 'America/Denver').hour).toBe(3);
    expect(localDateTime(new Date('2026-03-08T09:00:00Z'), 'America/Denver')).toBe('2026-03-08 03:00');
  });

  test('a year before 1000 is padded to four digits, so dates still sort as text', () => {
    expect(at('0998-12-31T18:00:00Z', 'UTC').date).toBe('0998-12-31');
    expect(localDateTime(new Date('0998-12-31T18:00:00Z'), 'UTC')).toBe('0998-12-31 18:00');
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
