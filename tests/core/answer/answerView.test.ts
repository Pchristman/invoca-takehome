import { describe, expect, it } from 'vitest';
import { buildAnswer } from '../../../src/core/answer';
import type { AnswerFilter } from '../../../src/core/answer';
import { callAt, campaign, expectAllFinite, makeStore, office, range } from '../views/fixtures';

const open: AnswerFilter = {
  view: 'missed-calls',
  officeIds: [],
  campaignIds: [],
  includeUnattributed: false,
  weekdays: [],
  hours: [],
};

const FRI = '2026-10-02T16:00:00Z';
const SAT = '2026-10-03T16:00:00Z';
const fri = { localWeekday: 4 };
const sat = { localWeekday: 5 };

// Alpha: 4 Friday calls (3 unanswered, 1 booked at $300) and 1 Saturday call. Beta: 2 Friday calls, answered.
const alphaMissed = { locationId: 'a', answered: false, outcome: 'missed' as const, booked: false, revenueUsd: 0 };
const notQualified = { answered: true, outcome: 'not_qualified' as const, booked: false, revenueUsd: 0 };
const calls = [
  callAt(FRI, { locationId: 'a', answered: true, outcome: 'booked', booked: true, revenueUsd: 300, ...fri }),
  callAt(FRI, { ...alphaMissed, ...fri }),
  callAt(FRI, { ...alphaMissed, ...fri }),
  callAt(FRI, { ...alphaMissed, ...fri }),
  callAt(SAT, { locationId: 'a', ...notQualified, ...sat }),
  callAt(FRI, { locationId: 'b', ...notQualified, ...fri }),
  callAt(FRI, { locationId: 'b', ...notQualified, ...fri }),
];
const store = makeStore(calls, {
  locations: [office('a', 'Alpha Office'), office('b', 'Beta Office')],
  campaigns: [campaign('cmp_a', 'Spring', 'social', 10)],
});
const r = range('2026-10-02', '2026-10-03');

describe('buildAnswer', () => {
  it('missed-calls groups by office and sorts by unanswered', () => {
    const v = buildAnswer(store, r, { ...open, weekdays: [4] });
    expect(v.groupBy).toBe('office');
    expect(v.rows[0]).toEqual({
      id: 'a',
      name: 'Alpha Office',
      calls: 4,
      answered: 1,
      unanswered: 3,
      answerRate: 0.25,
      bookings: 1,
      bookingRate: 0.25,
      revenueUsd: 300,
    });
    expect(v.rows[1]!.id).toBe('b');
    expect(v.rows[1]!.unanswered).toBe(0);
    expect(v.totals.calls).toBe(6);
    expect(v.sentence).toBe('Alpha Office had the most unanswered calls: 3 of 4.');
  });

  it('locations sorts by calls', () => {
    const v = buildAnswer(store, r, { ...open, view: 'locations' });
    expect(v.rows.map((x) => x.name)).toEqual(['Alpha Office', 'Beta Office']);
    expect(v.rows[0]!.calls).toBe(5);
    expect(v.sentence).toBe('Alpha Office took the most calls: 5, of which 2 were answered.');
  });

  it('campaigns groups by campaign, with Unattributed as its own row', () => {
    const withNull = makeStore([...calls, callAt(FRI, { campaignId: null, unattributed: true, locationId: 'a', ...fri })], {
      locations: store.locations,
      campaigns: store.campaigns,
    });
    const v = buildAnswer(withNull, r, { ...open, view: 'campaigns' });
    expect(v.groupBy).toBe('campaign');
    expect(v.rows.map((x) => x.name)).toEqual(['Spring', 'Unattributed']);
    expect(v.rows[1]!.id).toBeNull();
    expect(v.sentence).toBe('Spring had the most calls: 7, with 1 booking.');
  });

  it('overview gives totals only', () => {
    const v = buildAnswer(store, r, { ...open, view: 'overview' });
    expect(v.groupBy).toBe('none');
    expect(v.rows).toEqual([]);
    expect(v.sentence).toBe('7 calls matched: 57.1% answered, 1 booked, $300 in revenue.');
  });

  it('a filter that matches nothing gives blanks, not NaN', () => {
    const v = buildAnswer(store, r, { ...open, weekdays: [6] });
    expect(v.rows).toEqual([]);
    expect(v.totals.calls).toBe(0);
    expect(v.totals.answerRate).toBeNull();
    expect(v.totals.bookingRate).toBeNull();
    expect(v.sentence).toBe('No calls match this question in this range.');
    expectAllFinite(v);
  });

  describe('ties for the top value (M11)', () => {
    const miss = { answered: false, outcome: 'missed' as const, booked: false, revenueUsd: 0 };
    const tied = (count: number) =>
      makeStore(
        ['a', 'b', 'c', 'd', 'e'].slice(0, count).flatMap((id) => [
          callAt(FRI, { locationId: id, ...miss, ...fri }),
          callAt(FRI, { locationId: id, ...miss, ...fri }),
        ]),
        {
          locations: [office('a', 'Alpha Office'), office('b', 'Beta Office'), office('c', 'Canyon Office'),
            office('d', 'Delta Office'), office('e', 'Echo Office')],
          campaigns: [],
        },
      );

    it('two tied groups are named together', () => {
      expect(buildAnswer(tied(2), r, open).sentence).toBe(
        'Alpha Office and Beta Office tied for the most unanswered calls: 2.',
      );
    });

    it('a tie states only the tied value, not the first leader\'s other numbers', () => {
      const got = { answered: true, outcome: 'not_qualified' as const, booked: false, revenueUsd: 0, ...fri };
      const uneven = (bCall: object) =>
        makeStore(
          [
            callAt(FRI, { locationId: 'a', ...miss, ...fri }),
            callAt(FRI, { locationId: 'a', ...got }),
            callAt(FRI, { locationId: 'b', ...miss, ...fri }),
            callAt(FRI, { locationId: 'b', ...bCall }),
          ],
          { locations: [office('a', 'Alpha Office'), office('b', 'Beta Office')], campaigns: [] },
        );
      // Locations: 2 calls each; Alpha answered 1, Beta none.
      expect(buildAnswer(uneven({ ...miss, ...fri }), r, { ...open, view: 'locations' }).sentence).toBe(
        'Alpha Office and Beta Office tied for the most calls: 2.',
      );
      // Missed calls: 1 unanswered each; Alpha of 2 calls, Beta of 1 (its second call is on Saturday, out of the filter).
      expect(buildAnswer(uneven({ ...miss, ...sat }), r, { ...open, weekdays: [4] }).sentence).toBe(
        'Alpha Office and Beta Office tied for the most unanswered calls: 1.',
      );
    });

    it('three are listed; more than three say "and N more"', () => {
      expect(buildAnswer(tied(3), r, open).sentence).toBe(
        'Alpha Office, Beta Office and Canyon Office tied for the most unanswered calls: 2.',
      );
      expect(buildAnswer(tied(5), r, open).sentence).toBe(
        'Alpha Office, Beta Office, Canyon Office and 2 more tied for the most unanswered calls: 2.',
      );
    });

    it('locations and campaigns ties are worded the same way; a single leader is unchanged', () => {
      expect(buildAnswer(tied(2), r, { ...open, view: 'locations' }).sentence).toBe(
        'Alpha Office and Beta Office tied for the most calls: 2.',
      );
      expect(buildAnswer(store, r, { ...open, weekdays: [4] }).sentence).toBe(
        'Alpha Office had the most unanswered calls: 3 of 4.',
      );
    });
  });

  it('a missed-calls top row with nothing unanswered says so', () => {
    const v = buildAnswer(store, r, { ...open, officeIds: ['b'] });
    expect(v.sentence).toBe('No matching call went unanswered.');
  });

  it('adds revenue in whole cents and counts pending as answered, not booked', () => {
    const s = makeStore(
      [
        callAt(FRI, { revenueUsd: 0.1 }),
        callAt(FRI, { revenueUsd: 0.2 }),
        callAt(FRI, { answered: true, outcome: null, pending: true, booked: false, revenueUsd: 0 }),
      ],
      { locations: [], campaigns: [] },
    );
    const v = buildAnswer(s, r, { ...open, view: 'overview' });
    expect(v.totals.revenueUsd).toBe(0.3);
    expect(v.totals.answered).toBe(3);
    expect(v.totals.bookings).toBe(2);
  });

  it('keeps the range notes and builds on an empty store', () => {
    const clamped = buildAnswer(store, { ...r, clamped: true }, open);
    expect(clamped.notes.clamped).toBe(true);
    const empty = buildAnswer(makeStore([]), r, open);
    expect(empty.totals.calls).toBe(0);
    expect(empty.sentence).toBe('No calls match this question in this range.');
  });
});
