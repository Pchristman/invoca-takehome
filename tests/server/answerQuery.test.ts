import { describe, expect, it } from 'vitest';
import { dataSpan } from '../../src/core/ranges';
import { makeStore } from '../core/views/fixtures';
import { parseAnswerQuery } from '../../src/server/params';
import type { Query } from '../../src/server/params';
import { serverFixture } from './helpers';

const store = serverFixture();
const span = dataSpan(store.calls);

function parse(query: Query) {
  return parseAnswerQuery(store, span, query);
}

function failure(query: Query) {
  const r = parse(query);
  if (r.ok) throw new Error('expected a failure');
  return r.error;
}

describe('parseAnswerQuery', () => {
  it('no parameters: overview, empty lists, the default range', () => {
    const r = parse({});
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.filter).toEqual({
      view: 'overview', officeIds: [], campaignIds: [], includeUnattributed: false, weekdays: [], hours: [],
    });
    expect(r.value.range.start <= r.value.range.end).toBe(true);
  });

  it('parses a full query', () => {
    const r = parse({
      view: ['missed-calls'], f_office: ['loc_a'], f_campaign: ['cmp_b'], f_weekday: ['4', '5'], f_hour: ['9'],
      f_unattributed: ['1'], range: ['last7'],
    });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.filter).toEqual({
      view: 'missed-calls', officeIds: ['loc_a'], campaignIds: ['cmp_b'], includeUnattributed: true, weekdays: [4, 5], hours: [9],
    });
    expect(r.value.range.days).toBe(7);
  });

  it.each([
    ['f_office=nope', { f_office: ['nope'] }, 'unknown_location', 'f_office'],
    ['f_campaign=nope', { f_campaign: ['nope'] }, 'unknown_campaign', 'f_campaign'],
    ['f_weekday=7', { f_weekday: ['7'] }, 'bad_param', 'f_weekday'],
    ['f_weekday=-1', { f_weekday: ['-1'] }, 'bad_param', 'f_weekday'],
    ['f_weekday=1.5', { f_weekday: ['1.5'] }, 'bad_param', 'f_weekday'],
    ['f_weekday=abc', { f_weekday: ['abc'] }, 'bad_param', 'f_weekday'],
    ['f_hour=24', { f_hour: ['24'] }, 'bad_param', 'f_hour'],
    ['f_unattributed=yes', { f_unattributed: ['yes'] }, 'bad_param', 'f_unattributed'],
    ['view=nope', { view: ['nope'] }, 'unknown_view', 'view'],
    ['51 hours', { f_hour: Array.from({ length: 51 }, () => '1') }, 'bad_param', 'f_hour'],
    ['range twice', { range: ['last7', 'last28'] }, 'bad_param', 'range'],
  ] as const)('rejects %s', (_label, query, code, field) => {
    const error = failure(query as unknown as Query);
    expect(error.code).toBe(code);
    expect(error.field).toBe(field);
  });

  it('an empty f_weekday or f_hour counts as absent, like an empty f_office', () => {
    const r = parse({ f_weekday: [''], f_hour: ['', '9'], f_office: [''] });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.filter).toMatchObject({ weekdays: [], hours: [9], officeIds: [] });
  });

  it('a repeated view is a bad_param on view, like a repeated range', () => {
    const error = failure({ view: ['overview', 'campaigns'] });
    expect(error.code).toBe('bad_param');
    expect(error.field).toBe('view');
  });

  it('ignores compareStart and compareEnd, since an answer never compares', () => {
    const r = parse({ compareStart: ['not a date'], compareEnd: ['2026-09-01'] });
    expect(r.ok).toBe(true);
    expect(parse({ compareStart: ['a', 'b'] }).ok).toBe(true);
  });

  it('keeps a repeated id once, in order', () => {
    const r = parse({ f_office: ['loc_b', 'loc_a', 'loc_b'], f_hour: ['3', '3'] });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.filter.officeIds).toEqual(['loc_b', 'loc_a']);
    expect(r.value.filter.hours).toEqual([3]);
  });

  it('a range outside the data and an empty store fail like the views', () => {
    expect(failure({ start: ['2020-01-01'], end: ['2020-01-05'] }).code).toBe('outside_data');
    const empty = makeStore([]);
    const r = parseAnswerQuery(empty, dataSpan(empty.calls), {});
    if (r.ok) throw new Error('expected a failure');
    expect(r.error.code).toBe('no_data');
  });
});
