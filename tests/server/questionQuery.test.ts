import { describe, expect, it } from 'vitest';
import type { FilterReply } from '../../src/ai/question';
import { dataSpan } from '../../src/core/ranges';
import { callAt, campaign, makeStore, office } from '../core/views/fixtures';
import { questionContext, replyToQuery } from '../../src/server/questionQuery';
import { serverFixture } from './helpers';

const EMPTY: FilterReply = {
  answerable: true, view: 'overview', offices: [], campaigns: [], includeUnattributed: false, weekdays: [], hours: [], range: null,
};
const store = serverFixture();
const span = dataSpan(store.calls);
const ask = (over: Partial<FilterReply>) => replyToQuery(store, span, { ...EMPTY, ...over });
const hourParams = (hours: number[]) => hours.map((h) => `f_hour=${h}`).join('&');

describe('replyToQuery', () => {
  it('maps names to ids and weekday words to numbers, matching ignoring case and spaces', () => {
    expect(ask({ view: 'missed-calls', offices: [' office a '], weekdays: ['friday'] })).toEqual({
      ok: true,
      value: 'view=missed-calls&f_office=loc_a&f_weekday=4',
    });
    expect(ask({ campaigns: ['BETA'] })).toEqual({ ok: true, value: 'view=overview&f_campaign=cmp_b' });
  });

  it('leaves out the range for null and passes a preset or a start and end', () => {
    expect(ask({})).toEqual({ ok: true, value: 'view=overview' });
    expect(ask({ range: { preset: 'last7' } })).toEqual({ ok: true, value: 'view=overview&range=last7' });
    expect(ask({ range: { start: '2026-09-02', end: '2026-09-05' } })).toEqual({
      ok: true,
      value: 'view=overview&start=2026-09-02&end=2026-09-05',
    });
  });

  it('names that do not exist are rejected, and the detail names the text', () => {
    expect(ask({ offices: ['Atlantis Office'] })).toEqual({ ok: false, detail: 'No office is called "Atlantis Office".' });
    expect(ask({ campaigns: ['Nope'] })).toEqual({ ok: false, detail: 'No campaign is called "Nope".' });
    expect(ask({ offices: ['Alpha'] }).ok).toBe(false); // a campaign name given as an office
    const long = ask({ offices: ['x'.repeat(200)] });
    expect(long.ok === false && long.detail).toBe(`No office is called "${'x'.repeat(40)}...".`);
  });

  it('accepts the glossary expansions', () => {
    expect(ask({ weekdays: ['saturday', 'sunday'] })).toEqual({ ok: true, value: 'view=overview&f_weekday=5&f_weekday=6' });
    const morning = [6, 7, 8, 9, 10, 11];
    expect(ask({ hours: morning })).toEqual({ ok: true, value: `view=overview&${hourParams(morning)}` });
    const nineToFive = [9, 10, 11, 12, 13, 14, 15, 16];
    expect(ask({ hours: nineToFive })).toEqual({ ok: true, value: `view=overview&${hourParams(nineToFive)}` });
    expect(ask({ includeUnattributed: true })).toEqual({ ok: true, value: 'view=overview&f_unattributed=1' });
  });

  it('rejects hours, weekdays and ranges that are not valid', () => {
    for (const hours of [[24], [-1], [9.5], [Number.NaN]]) {
      const r = ask({ hours });
      expect(r.ok, String(hours)).toBe(false);
      expect(!r.ok && r.detail).toMatch(/is not an hour of the day\.$/);
    }
    expect(ask({ weekdays: ['funday' as never] }).ok).toBe(false);
    expect(ask({ range: { start: '2026-09-05', end: '2026-09-02' } }).ok).toBe(false);
    expect(ask({ range: { start: '2020-01-01', end: '2020-01-05' } }).ok).toBe(false);
  });

  it('two offices whose names differ only in case are ambiguous', () => {
    const dup = makeStore([callAt('2026-09-01T16:00:00Z', { locationId: 'loc_1', campaignId: 'cmp_a' })], {
      campaigns: [campaign('cmp_a', 'Alpha', 'social', 10)],
      locations: [office('loc_1', 'Main'), office('loc_2', 'MAIN')],
    });
    const r = replyToQuery(dup, dataSpan(dup.calls), { ...EMPTY, offices: ['main'] });
    expect(r).toEqual({ ok: false, detail: '"main" matches more than one office.' });
  });
});

describe('questionContext', () => {
  it('holds the dates and names only', () => {
    expect(questionContext(store, span!)).toEqual({
      firstDate: span!.start,
      lastDate: span!.end,
      offices: ['Office A', 'Office B'],
      campaigns: ['Alpha', 'Beta'],
    });
  });
});
