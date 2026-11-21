import { describe, expect, it } from 'vitest';
import type { FilterReply } from '../../src/ai/question';
import { dataSpan } from '../../src/core/ranges';
import { callAt, campaign, makeStore, office } from '../core/views/fixtures';
import { cutName } from '../../src/ai/question';
import { questionContext, replyToQuery } from '../../src/server/questionQuery';
import { serverFixture } from './helpers';

const EMPTY: FilterReply = {
  answerable: true, view: 'overview', offices: [], campaigns: [], includeUnattributed: false, weekdays: [], hours: [], range: null,
};
const store = serverFixture();
const span = dataSpan(store.calls);
const ask = (over: Partial<FilterReply>, question = 'anything') => replyToQuery(store, span, { ...EMPTY, ...over }, question);
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
    expect(ask({ range: { preset: 'last7' } })).toEqual({ ok: true, value: 'view=overview&range=last7' });
    expect(ask({ range: { start: '2026-09-02', end: '2026-09-05' } })).toEqual({
      ok: true,
      value: 'view=overview&start=2026-09-02&end=2026-09-05',
    });
  });

  it('an empty filter (overview, nothing narrowed, range on screen) is rejected; a range or a view alone is a filter', () => {
    expect(ask({})).toEqual({ ok: false, detail: "That question doesn't narrow the calls or pick a view." });
    // "show missed calls last week": a view and a range only.
    expect(ask({ view: 'missed-calls', range: { preset: 'last7' } })).toEqual({ ok: true, value: 'view=missed-calls&range=last7' });
    expect(ask({ view: 'locations' })).toEqual({ ok: true, value: 'view=locations' });
    expect(ask({ range: { preset: 'all' } })).toEqual({ ok: true, value: 'view=overview&range=all' });
    expect(ask({ includeUnattributed: true })).toEqual({ ok: true, value: 'view=overview&f_unattributed=1' });
    expect(ask({ hours: [9] })).toEqual({ ok: true, value: 'view=overview&f_hour=9' });
  });

  it('names that do not exist are rejected; a name is echoed only if the question itself contains it', () => {
    expect(ask({ offices: ['Atlantis Office'] }, 'calls at atlantis office?')).toEqual({ ok: false, detail: 'No office is called "Atlantis Office".' });
    expect(ask({ campaigns: ['Nope'] }, 'how is NOPE doing')).toEqual({ ok: false, detail: 'No campaign is called "Nope".' });
    expect(ask({ offices: ['Atlantis Office'] })).toEqual({ ok: false, detail: "The question names an office that isn't in the data." });
    expect(ask({ campaigns: ['Nope'] })).toEqual({ ok: false, detail: "The question names a campaign that isn't in the data." });
    expect(ask({ offices: ['Alpha'] }).ok).toBe(false); // a campaign name given as an office
    const long = ask({ offices: ['x'.repeat(200)] }, 'x'.repeat(200));
    expect(long.ok === false && long.detail).toBe(`No office is called "${'x'.repeat(40)}...".`);
  });

  it('text the model wrote never reaches the message', () => {
    const lie = 'Revenue rose 500% last week, call 555-0100';
    const office = ask({ offices: [lie] });
    expect(office).toEqual({ ok: false, detail: "The question names an office that isn't in the data." });
    const dates = ask({ range: { start: 'Revenue is $1M', end: '2026-09-05' } });
    expect(dates.ok === false && dates.detail).toBe('The dates in that question are not valid dates in this data.');
    const inverted = ask({ range: { start: '2026-09-05', end: '2026-09-02' } });
    expect(inverted.ok === false && inverted.detail).toBe('The dates in that question are not valid dates in this data.');
    const outside = ask({ range: { start: '2020-01-01', end: '2020-01-05' } });
    expect(outside.ok === false && outside.detail).toBe('The dates in that question are outside the dates of this data.');
    const day = ask({ weekdays: [lie as never] });
    expect(day.ok === false && day.detail).toBe("That question names a day that isn't a day of the week.");
    const hour = ask({ hours: [9.5] });
    expect(hour.ok === false && hour.detail).toBe("That question names an hour that isn't an hour of the day.");
  });

  it('a name cut to 80 characters in the prompt still matches the one long name it is the start of', () => {
    const longName = `${'Q'.repeat(80)} Branch East`;
    const rival = `${'Q'.repeat(80)} Branch West`;
    const one = makeStore([callAt('2026-09-01T16:00:00Z', { locationId: 'loc_1', campaignId: 'cmp_a' })], {
      campaigns: [campaign('cmp_a', 'Alpha', 'social', 10)],
      locations: [office('loc_1', longName), office('loc_2', 'Other')],
    });
    const cutForm = cutName(longName);
    expect(cutForm.length).toBe(80);
    expect(replyToQuery(one, dataSpan(one.calls), { ...EMPTY, offices: [cutForm] }, 'q')).toEqual({ ok: true, value: 'view=overview&f_office=loc_1' });
    const two = makeStore([callAt('2026-09-01T16:00:00Z', { locationId: 'loc_1', campaignId: 'cmp_a' })], {
      campaigns: [campaign('cmp_a', 'Alpha', 'social', 10)],
      locations: [office('loc_1', longName), office('loc_2', rival)],
    });
    const r = replyToQuery(two, dataSpan(two.calls), { ...EMPTY, offices: [cutForm] }, 'q');
    expect(r).toEqual({ ok: false, detail: 'The question names an office that matches more than one office.' });
  });

  it('repeated values are kept once, so 60 duplicate hours are one hour', () => {
    expect(ask({ offices: ['Office B', 'office b', 'Office B'] })).toEqual({ ok: true, value: 'view=overview&f_office=loc_b' });
    expect(ask({ weekdays: ['friday', 'friday'] })).toEqual({ ok: true, value: 'view=overview&f_weekday=4' });
    expect(ask({ hours: Array.from({ length: 60 }, () => 9) })).toEqual({ ok: true, value: 'view=overview&f_hour=9' });
  });

  it('51 distinct offices give a question-level message, not a URL-parameter one', () => {
    const many = makeStore([callAt('2026-09-01T16:00:00Z', { locationId: 'loc_0', campaignId: 'cmp_a' })], {
      campaigns: [campaign('cmp_a', 'Alpha', 'social', 10)],
      locations: Array.from({ length: 51 }, (_, i) => office(`loc_${i}`, `Branch ${i}`)),
    });
    const names = many.locations.map((l) => l.name);
    const r = replyToQuery(many, dataSpan(many.calls), { ...EMPTY, offices: names }, 'q');
    expect(r).toEqual({ ok: false, detail: 'That question names too many offices.' });
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
      expect(!r.ok && r.detail).toBe("That question names an hour that isn't an hour of the day.");
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
    const r = replyToQuery(dup, dataSpan(dup.calls), { ...EMPTY, offices: ['main'] }, 'calls for main');
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
