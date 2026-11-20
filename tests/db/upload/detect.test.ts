import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readUpload } from '../../../src/db/upload/detect';
import { UploadRejected, type UploadKind } from '../../../src/db/upload/types';
import { callLine, csvTexts } from '../helpers';
import { csvOf } from './helpers';

const texts = csvTexts({ calls: [callLine()] });
const kinds: UploadKind[] = ['calls', 'campaigns', 'locations'];

function rejection(fn: () => unknown): UploadRejected {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(UploadRejected);
    return err as UploadRejected;
  }
  throw new Error('expected a rejection');
}

describe('readUpload', () => {
  test.each(kinds)('a %s file is detected as %s', (kind) => {
    const up = readUpload('f.csv', texts[kind]);
    expect(up.kind).toBe(kind);
    expect(up.fileName).toBe('f.csv');
    expect(up.table.rows.length).toBeGreaterThan(0);
  });

  test.each(kinds)('column order does not matter (%s)', (kind) => {
    const reversed = texts[kind].trim().split('\n').map((l) => l.split(',').reverse().join(',')).join('\n');
    expect(readUpload('f.csv', reversed).kind).toBe(kind);
  });

  test.each(kinds)('extra columns are fine (%s)', (kind) => {
    const [head, ...rest] = texts[kind].trim().split('\n');
    const text = [head + ',notes', ...rest.map((l) => l + ',hi')].join('\n');
    expect(readUpload('f.csv', text).kind).toBe(kind);
  });

  test.each(kinds)('a byte order mark and Windows line endings are fine (%s)', (kind) => {
    expect(readUpload('f.csv', '﻿' + texts[kind].replaceAll('\n', '\r\n')).kind).toBe(kind);
  });

  test('a header-only file is still detected', () => {
    const up = readUpload('f.csv', csvTexts().calls);
    expect(up.kind).toBe('calls');
    expect(up.table.rows).toEqual([]);
    expect(up.table.isEmpty).toBe(true);
  });

  test('header names are matched after trimming spaces', () => {
    const header = texts.calls.split('\n')[0]!.replace('call_id,started_at', ' call_id , started_at');
    expect(readUpload('f.csv', csvOf(header, [callLine()])).kind).toBe('calls');
  });

  test.each(['', '  \n \n'])('an empty file is rejected (%j)', (text) => {
    const err = rejection(() => readUpload('f.csv', text));
    expect(err.reason).toBe('empty');
    expect(err.message).toMatch(/empty/);
  });

  test.each(['hello, this is not a csv', '%PDF-1.4\n\u0000\u0001'])('a file that is not CSV is rejected with the columns it expected (%j)', (text) => {
    const err = rejection(() => readUpload('notes.txt', text));
    expect(err.reason).toBe('unknown_columns');
    expect(err.message).toContain('call_id, started_at,');
    expect(err.message).toContain('campaign_id, name, channel, daily_budget_usd');
    expect(err.message).toContain('location_id, name, timezone');
  });

  test('a file that matches none lists the columns it found', () => {
    const err = rejection(() => readUpload('f.csv', 'a,b,c\n1,2,3'));
    expect(err.reason).toBe('unknown_columns');
    expect(err.message).toContain('a, b, c');
  });

  test('a file that matches more than one is rejected', () => {
    const header = texts.calls.split('\n')[0]! + ',name,timezone,channel,daily_budget_usd';
    const err = rejection(() => readUpload('f.csv', csvOf(header, [])));
    expect(err.reason).toBe('ambiguous_columns');
    expect(err.message).toMatch(/calls.*campaigns.*locations/);
  });

  test('a calls file missing one column is not a calls file', () => {
    const header = texts.calls.split('\n')[0]!.replace(',outcome', '');
    const err = rejection(() => readUpload('f.csv', csvOf(header, [])));
    expect(err.reason).toBe('unknown_columns');
    expect(err.message).toContain('calls (missing: outcome)');
  });

  test('a repeated column is rejected', () => {
    const err = rejection(() => readUpload('dup.csv', texts.calls.replace('call_id,', 'call_id,call_id,')));
    expect(err.reason).toBe('bad_csv');
    expect(err.message).toContain('dup.csv');
    expect(err.message).toContain('appears more than once');
  });

  test('a quote that never closes is rejected', () => {
    const err = rejection(() => readUpload('f.csv', texts.locations + 'loc_x,"Office,UTC\n'));
    expect(err.reason).toBe('bad_csv');
  });

  test('the message names the uploaded file, not calls.csv', () => {
    const err = rejection(() => readUpload('my export (1).csv', 'a,b'));
    expect(err.message).toContain('my export (1).csv');
    expect(err.message).not.toContain('calls.csv');
  });

  test('textSha256 is the SHA-256 of the text and ignores nothing', () => {
    const a = readUpload('f.csv', texts.calls);
    expect(a.textSha256).toBe(createHash('sha256').update(texts.calls).digest('hex'));
    expect(readUpload('g.csv', texts.calls).textSha256).toBe(a.textSha256);
    expect(readUpload('f.csv', texts.calls + ' ').textSha256).not.toBe(a.textSha256);
  });
});
