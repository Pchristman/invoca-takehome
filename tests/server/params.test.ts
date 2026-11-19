import { describe, expect, it } from 'vitest';
import { statusFor } from '../../src/server/api';
import type { ApiErrorCode } from '../../src/server/api';
import { parseViewQuery } from '../../src/server/params';
import type { Query, ViewQueryWants } from '../../src/server/params';
import { makeStore } from '../core/views/fixtures';
import { serverFixture } from './helpers';

const store = serverFixture();
const span = { start: '2026-09-01', end: '2026-09-14' };

/** Wrap plain strings into the Query shape Hono gives. */
const q = (params: Record<string, string | string[]>): Query =>
  Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v : [v]]));

const parse = (params: Record<string, string | string[]>, wants?: ViewQueryWants) =>
  parseViewQuery(store, span, q(params), wants);

function failure(result: ReturnType<typeof parse>) {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
}
function success(result: ReturnType<typeof parse>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
  return result.value;
}

describe('parseViewQuery', () => {
  it('no parameters means the default preset', () => {
    const empties: Record<string, string>[] = [{}, { range: '' }, { start: '', end: '' }];
    for (const params of empties) {
      const value = success(parse(params));
      expect(value.range).toEqual({ start: '2026-09-01', end: '2026-09-14', days: 14, clamped: true });
      expect(value.previous).toBeUndefined();
    }
  });

  it('presets', () => {
    expect(success(parse({ range: 'last7' })).range).toEqual({
      start: '2026-09-08',
      end: '2026-09-14',
      days: 7,
      clamped: false,
    });
    expect(success(parse({ range: 'all' })).range).toEqual({ ...span, days: 14, clamped: false });
  });

  it('custom range', () => {
    expect(success(parse({ start: '2026-09-03', end: '2026-09-05' })).range).toEqual({
      start: '2026-09-03',
      end: '2026-09-05',
      days: 3,
      clamped: false,
    });
    const partial = success(parse({ start: '2026-09-10', end: '2026-09-30' })).range;
    expect(partial.end).toBe('2026-09-14');
    expect(partial.clamped).toBe(true);
  });

  it('a compare range is passed through, not judged', () => {
    const shorter = success(parse({ range: 'last7', compareStart: '2026-09-01', compareEnd: '2026-09-03' }));
    expect(shorter.previous).toEqual({ start: '2026-09-01', end: '2026-09-03' });
    const outside = success(parse({ range: 'last7', compareStart: '2020-01-01', compareEnd: '2020-01-07' }));
    expect(outside.previous).toEqual({ start: '2020-01-01', end: '2020-01-07' });
  });

  describe('malformed dates are bad_date, naming the field', () => {
    const bad = ['2026-02-30', 'banana', '2026-9-1', '20260901', '2026-09-01T00:00:00Z'];
    it.each(bad)('start %s', (value) => {
      const error = failure(parse({ start: value, end: '2026-09-05' }));
      expect(error).toMatchObject({ code: 'bad_date', field: 'start' });
      expect(error.message).toContain(value);
    });
    it.each(bad)('end %s', (value) => {
      const error = failure(parse({ start: '2026-09-01', end: value }));
      expect(error).toMatchObject({ code: 'bad_date', field: 'end' });
      expect(error.message).toContain(value);
    });
    it.each(bad)('compareStart %s', (value) => {
      const error = failure(parse({ range: 'last7', compareStart: value, compareEnd: '2026-09-05' }));
      expect(error).toMatchObject({ code: 'bad_date', field: 'compareStart' });
      expect(error.message).toContain(value);
    });
    it.each(bad)('compareEnd %s', (value) => {
      const error = failure(parse({ range: 'last7', compareStart: '2026-09-01', compareEnd: value }));
      expect(error).toMatchObject({ code: 'bad_date', field: 'compareEnd' });
    });
  });

  it('start alone or end alone is bad_param', () => {
    const startOnly = failure(parse({ start: '2026-09-01' }));
    expect(startOnly.code).toBe('bad_param');
    expect(startOnly.message).toContain('start');
    expect(startOnly.message).toContain('end');
    const endOnly = failure(parse({ end: '2026-09-01' }));
    expect(endOnly.code).toBe('bad_param');
    expect(endOnly.message).toContain('end');
    const compareOnly = failure(parse({ range: 'last7', compareStart: '2026-09-01' }));
    expect(compareOnly.code).toBe('bad_param');
    expect(compareOnly.message).toContain('compareStart');
    expect(compareOnly.message).toContain('compareEnd');
    expect(failure(parse({ compareEnd: '2026-09-01' })).code).toBe('bad_param');
  });

  it('an inverted range is start_after_end', () => {
    expect(failure(parse({ start: '2026-09-10', end: '2026-09-05' })).code).toBe('start_after_end');
    expect(failure(parse({ range: 'last7', compareStart: '2026-09-10', compareEnd: '2026-09-05' })).code).toBe(
      'start_after_end',
    );
  });

  it('a range outside the data is outside_data', () => {
    const error = failure(parse({ start: '2027-01-01', end: '2027-01-31' }));
    expect(error.code).toBe('outside_data');
    expect(error.message).toContain('2026-09-01');
    expect(error.message).toContain('2026-09-14');
  });

  it('range and start/end together is bad_param; an unknown preset lists the real ones', () => {
    expect(failure(parse({ range: 'last7', start: '2026-09-01', end: '2026-09-05' })).code).toBe('bad_param');
    const error = failure(parse({ range: 'last99' }));
    expect(error.code).toBe('bad_param');
    for (const name of ['last7', 'last28', 'all']) expect(error.message).toContain(name);
  });

  it('a repeated parameter is bad_param', () => {
    expect(failure(parse({ range: ['last7', 'all'] })).code).toBe('bad_param');
    const error = failure(parse({ start: ['2026-09-01', '2026-09-02'], end: '2026-09-05' }));
    expect(error.code).toBe('bad_param');
    expect(error.message).toContain('start');
  });

  it('a very long or markup value is shortened', () => {
    const long = 'x'.repeat(5000);
    const cases: [Record<string, string>, ViewQueryWants | undefined][] = [
      [{ range: long }, undefined],
      [{ start: long, end: '2026-09-05' }, undefined],
      [{ campaign: long }, { campaign: true }],
      [{ location: long }, { location: true }],
    ];
    for (const [params, wants] of cases) {
      const error = failure(parse(params, wants));
      expect(error.message.length).toBeLessThan(200);
      expect(error.message).toContain('...');
    }
    const script = failure(parse({ range: '<script>' }));
    expect(script.code).toBe('bad_param');
    expect(script.message).toContain('<script>');
  });

  it('campaign and location are checked only when the route wants them', () => {
    expect(success(parse({ campaign: 'nope' }, {})).campaignId).toBeUndefined();
    expect(failure(parse({ campaign: 'nope' }, { campaign: true })).code).toBe('unknown_campaign');
    expect(success(parse({ campaign: 'cmp_b' }, { campaign: true })).campaignId).toBe('cmp_b');
    expect(success(parse({ campaign: '' }, { campaign: true })).campaignId).toBeUndefined();
    expect(failure(parse({ location: 'nope' }, { location: true })).code).toBe('unknown_location');
    expect(success(parse({ location: 'loc_a' }, { location: true })).locationId).toBe('loc_a');
    expect(success(parse({ location: '' }, { location: true })).locationId).toBeUndefined();
  });

  it('an empty export', () => {
    const empty = makeStore([]);
    const run = (params: Record<string, string>) => parseViewQuery(empty, null, q(params));
    expect(failure(run({})).code).toBe('no_data');
    expect(failure(run({ start: '2026-09-01', end: '2026-09-05' })).code).toBe('no_data');
    expect(failure(run({ start: 'banana', end: '2026-09-05' })).code).toBe('bad_date');
    expect(failure(run({ start: '2026-09-10', end: '2026-09-05' })).code).toBe('start_after_end');
  });
});

describe('statusFor', () => {
  it('no_data is 409, not_found 404, internal 500', () => {
    expect(statusFor('no_data')).toBe(409);
    expect(statusFor('not_found')).toBe(404);
    expect(statusFor('internal')).toBe(500);
  });
  it.each<ApiErrorCode>([
    'bad_param',
    'bad_date',
    'start_after_end',
    'outside_data',
    'unknown_campaign',
    'unknown_location',
    'unknown_view',
  ])('%s is 400', (code) => {
    expect(statusFor(code)).toBe(400);
  });
});
