import { describe, expect, it } from 'vitest';
import { callbacksToCsv, csvCell, toCsv } from '../../src/server/csv';
import type { CallbackRow } from '../../src/core/views/callbacks';

describe('csvCell', () => {
  it('writes plain values', () => {
    expect(csvCell('abc')).toBe('abc');
    expect(csvCell('')).toBe('');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(0.5)).toBe('0.5');
    expect(csvCell(-3)).toBe('-3');
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"');
    expect(csvCell('a\rb')).toBe('"a\rb"');
    expect(csvCell('Spring, "Big" Sale\nWeek')).toBe('"Spring, ""Big"" Sale\nWeek"');
  });

  it.each([
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+1+cmd', "'+1+cmd"],
    ['+SUM(A1)', "'+SUM(A1)"],
    ['-2+3', "'-2+3"],
    ['@cmd', "'@cmd"],
    ['\tx', "'\tx"],
    ['\rx', "\"'\rx\""],
  ])('neutralises %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it.each(['+1-555-0190', '+1 (555) 019-0190', '+44 20 7946 0958'])('writes the phone number %j as it is', (phone) => {
    expect(csvCell(phone)).toBe(phone);
  });

  it('leaves later formula characters alone', () => {
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell('1-2')).toBe('1-2');
  });

  it('neutralises then quotes a formula with commas', () => {
    expect(csvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
  });

  it('passes non-ASCII through', () => {
    expect(csvCell('Café Ñandú 東京')).toBe('Café Ñandú 東京');
  });

  it('throws on NaN and Infinity', () => {
    expect(() => csvCell(NaN)).toThrow();
    expect(() => csvCell(Infinity)).toThrow();
  });
});

describe('toCsv', () => {
  it('writes a header and CRLF rows', () => {
    expect(toCsv(['a', 'b'], [['1', 'x,y'], [2, null]])).toBe('a,b\r\n1,"x,y"\r\n2,\r\n');
  });
  it('writes only the header with no rows', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b\r\n');
  });
  it('throws on a short row, naming the row', () => {
    expect(() => toCsv(['a', 'b'], [['1', '2'], ['3']])).toThrow(/row 2/);
  });
});

describe('callbacksToCsv', () => {
  const header =
    'caller_hash,unanswered_attempts,last_attempt_local,office,campaign,tracking_number,estimated_value_usd';
  const row = (value: number): CallbackRow => ({
    callerHash: 'h_1',
    unansweredAttempts: 3,
    lastAttemptAt: new Date('2026-09-10T14:00:00Z'),
    lastAttemptLocal: '2026-09-10 09:00',
    locationId: 'loc_a',
    officeName: 'Office A',
    campaignId: 'cmp_a',
    campaignName: 'Spring, "Big" Sale',
    trackingNumber: '+1-555-0190',
    estimatedValueUsd: value,
  });

  it('writes one row per callback', () => {
    expect(callbacksToCsv([row(20)])).toBe(
      `${header}\r\nh_1,3,2026-09-10 09:00,Office A,"Spring, ""Big"" Sale",+1-555-0190,20.00\r\n`,
    );
  });
  it('writes the value with two decimals', () => {
    expect(callbacksToCsv([row(23.3)])).toContain(',23.30\r\n');
  });
  it('writes only the header with no rows', () => {
    expect(callbacksToCsv([])).toBe(`${header}\r\n`);
  });
});
