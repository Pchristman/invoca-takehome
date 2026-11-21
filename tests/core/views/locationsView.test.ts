import { describe, expect, it } from 'vitest';
import { buildLocations } from '../../../src/core/views/locationsView';
import { busiestMissedSlot } from '../../../src/core/views/missedSlots';
import type { CleanCall } from '../../../src/core/types';
import { makeCall } from '../helpers';
import { campaign, expectAllFinite, makeStore, office, officeCalls, range } from './fixtures';

const campaigns = [campaign('cmp_a', 'Alpha', 'social', 10), campaign('cmp_b', 'Beta', 'display', 10)];
const locations = [office('loc_a', 'Office A'), office('loc_b', 'Office B'), office('loc_c', 'Office C')];
const r = range('2026-09-01', '2026-09-14');

type Shape = { calls: number; answered: number; booked: number };
const storeOf = (calls: CleanCall[]) => makeStore(calls, { campaigns, locations });
const missedAt = (locationId: string, weekday: number, hour: number, n = 1): CleanCall[] =>
  Array.from({ length: n }, () =>
    makeCall({ locationId, answered: false, outcome: 'missed', booked: false, revenueUsd: 0, localWeekday: weekday, localHour: hour }),
  );

function l1(a: Shape, b: Shape = { calls: 500, answered: 250, booked: 150 }, c: Shape = b): CleanCall[] {
  return [
    ...officeCalls('loc_a', { ...a, missedSlot: { weekday: 1, hour: 9 } }),
    ...officeCalls('loc_b', b),
    ...officeCalls('loc_c', c),
  ];
}

describe('busiestMissedSlot', () => {
  it('counts only unanswered calls by local weekday and hour', () => {
    const calls = [
      ...missedAt('loc_a', 1, 9, 3),
      ...missedAt('loc_a', 4, 15, 2),
      makeCall({ locationId: 'loc_a', answered: true, localWeekday: 4, localHour: 15 }),
      makeCall({ locationId: 'loc_a', answered: true, localWeekday: 4, localHour: 15 }),
      makeCall({ locationId: 'loc_a', answered: true, localWeekday: 4, localHour: 15 }),
    ];
    expect(busiestMissedSlot(calls)).toEqual({ locationId: 'loc_a', weekday: 1, hour: 9, calls: 3 });
    expect(busiestMissedSlot([makeCall({ answered: true })])).toBeNull();
  });

  it('a tie for the most names no slot', () => {
    for (const calls of [
      [...missedAt('loc_b', 0, 9), ...missedAt('loc_a', 3, 9)],
      [...missedAt('loc_a', 5, 9), ...missedAt('loc_a', 2, 9)],
      [...missedAt('loc_a', 2, 14, 2), ...missedAt('loc_a', 2, 9, 2), ...missedAt('loc_a', 1, 9)],
    ]) {
      expect(busiestMissedSlot(calls)).toBeNull();
      expect(busiestMissedSlot([...calls].reverse())).toBeNull();
    }
    // A tie below the top does not matter.
    const clear = [...missedAt('loc_a', 1, 9), ...missedAt('loc_b', 2, 9), ...missedAt('loc_c', 3, 9, 2)];
    expect(busiestMissedSlot(clear)).toMatchObject({ locationId: 'loc_c', weekday: 3, hour: 9, calls: 2 });
  });
});

describe('buildLocations', () => {
  it('rows are every office, ranked by calls, ties by id', () => {
    const view = buildLocations(storeOf(l1({ calls: 100, answered: 30, booked: 30 })), r);
    expect(view.rows.map((row) => row.locationId)).toEqual(['loc_b', 'loc_c', 'loc_a']);
    expect(view.rows[2]).toMatchObject({
      calls: 100, answered: 30, answerRate: 0.3, bookings: 30, bookingRate: 0.3, revenueUsd: 3000,
    });
  });

  it('a worse answer rate is flagged with both rates', () => {
    const view = buildLocations(storeOf(l1({ calls: 100, answered: 30, booked: 30 })), r);
    const a = view.rows.find((row) => row.locationId === 'loc_a')!;
    expect(a.answerFlag).toMatchObject({ flagged: true, direction: 'worse', officeRate: 0.3, restRate: 0.5 });
    expect(a.answerFlag.z).toBeCloseTo(-3.82, 1);
    expect(a.bookingFlag.flagged).toBe(false);
    for (const id of ['loc_b', 'loc_c']) {
      const row = view.rows.find((x) => x.locationId === id)!;
      expect(row.answerFlag.flagged).toBe(false);
      expect(row.bookingFlag.flagged).toBe(false);
    }
  });

  it('the answer action names the office, both rates and its most-missed hour', () => {
    const view = buildLocations(storeOf(l1({ calls: 100, answered: 30, booked: 30 })), r);
    expect(view.actions).toHaveLength(1);
    const action = view.actions[0]!;
    expect(action.kind).toBe('review_office_answer');
    expect(action.text).toBe(
      'Office A answers 30.0% of calls versus 50.0% at other offices. Its most-missed hour is Tuesday 09:00 local.',
    );
    expect(action.link).toEqual({ view: 'missed-calls', locationId: 'loc_a' });
    expect(view.templateSentence).toBe(action.text);
    expect(view.factSheet.entities).toEqual(['Office A']);
    expect(Object.keys(view.factSheet.facts).sort()).toEqual([
      'office_answer.hour', 'office_answer.office', 'office_answer.office_rate', 'office_answer.rest_rate', 'office_answer.weekday',
    ]);
  });

  const l2 = (aOver: Partial<CleanCall> = {}): CleanCall[] => [
    ...officeCalls('loc_a', { calls: 60, answered: 60, booked: 25 }, { campaignId: 'cmp_a', ...aOver }),
    ...officeCalls('loc_a', { calls: 40, answered: 40, booked: 5 }, { campaignId: 'cmp_b', ...aOver }),
    ...officeCalls('loc_b', { calls: 1000, answered: 1000, booked: 500 }),
  ];

  it('a worse booking rate names the best campaign there', () => {
    const view = buildLocations(storeOf(l2()), r);
    const a = view.rows.find((row) => row.locationId === 'loc_a')!;
    expect(a.bookingFlag).toMatchObject({ flagged: true, direction: 'worse', officeRate: 0.3, restRate: 0.5 });
    expect(a.answerFlag.flagged).toBe(false);
    expect(a.answerFlag.z).toBeNull();
    expect(a.bestCampaign).toMatchObject({ campaignId: 'cmp_a', name: 'Alpha', calls: 60, bookings: 25 });
    expect(a.bestCampaign!.bookingRate).toBeCloseTo(0.4167, 4);
    const action = view.actions[0]!;
    expect(action.text).toBe('Office A books 30.0% of calls versus 50.0% elsewhere. Its best campaign there is Alpha.');
    expect(action.kind).toBe('review_office_booking');
    expect(action.link).toEqual({ view: 'campaigns' });
    expect(view.factSheet.entities).toEqual(['Alpha', 'Office A']);
  });

  it('no campaign with enough calls at the office', () => {
    const view = buildLocations(storeOf(l2({ campaignId: null, unattributed: true })), r);
    const a = view.rows.find((row) => row.locationId === 'loc_a')!;
    expect(a.bestCampaign).toBeNull();
    expect(view.actions[0]!.text).toBe(
      'Office A books 30.0% of calls versus 50.0% elsewhere. No campaign there has at least 20 calls to name a best one.',
    );
  });

  it('an office flagged better changes no action', () => {
    const view = buildLocations(storeOf(l1({ calls: 100, answered: 70, booked: 30 })), r);
    const a = view.rows.find((row) => row.locationId === 'loc_a')!;
    expect(a.answerFlag).toMatchObject({ flagged: true, direction: 'better' });
    expect(view.actions[0]!.kind).toBe('no_office_worse');
    expect(view.actions[0]!.text).toBe(
      'No office is doing worse than the rest on answer or booking rate. Missed calls are a company-wide issue.',
    );
    expect(view.actions[0]!.link).toEqual({ view: 'missed-calls' });
    expect(view.actions[0]!.actionable).toBe(false);
  });

  it('no office flagged gives the nothing-stands-out action', () => {
    const view = buildLocations(storeOf(l1({ calls: 100, answered: 50, booked: 30 })), r);
    const action = view.actions[0]!;
    expect(action.kind).toBe('no_office_stands_out');
    expect(action.text).toBe('No office stands out on answer or booking rate. Missed calls are a company-wide issue.');
    expect(action.actionable).toBe(false);
    expect(action.link).toEqual({ view: 'missed-calls' });
  });

  const COMBINED_KEYS = ['offices.answer_rate', 'offices.booking_rate', 'offices.compared', 'offices.unanswered'];

  it('when no office stands out, the facts are only combined figures for the range', () => {
    // Office C has too few calls to be tested, so two offices were compared; its calls still count in the totals.
    const few = { calls: 10, answered: 9, booked: 1 };
    const view = buildLocations(storeOf(l1({ calls: 100, answered: 50, booked: 30 }, { calls: 500, answered: 250, booked: 150 }, few)), r);
    const action = view.actions[0]!;
    expect(action.kind).toBe('no_office_stands_out');
    expect(action.text).toBe('No office stands out on answer or booking rate. Missed calls are a company-wide issue.');
    expect(Object.keys(action.facts).sort()).toEqual(COMBINED_KEYS);
    expect(action.facts['offices.compared']).toEqual({ kind: 'count', value: 2, noun: ['office', 'offices'] });
    expect(action.facts['offices.answer_rate']).toEqual({ kind: 'rate', value: 309 / 610 });
    expect(action.facts['offices.booking_rate']).toEqual({ kind: 'rate', value: 181 / 610 });
    expect(action.facts['offices.unanswered']).toEqual({ kind: 'count', value: 301, noun: ['call', 'calls'] });
    expect(Object.values(action.facts).some((fact) => fact.kind === 'name')).toBe(false);
    expect(view.factSheet.facts).toEqual(action.facts);
    expect(view.factSheet.entities).toEqual([]);
  });

  it('when an office is flagged only better, the facts are the same combined figures', () => {
    const view = buildLocations(storeOf(l1({ calls: 100, answered: 70, booked: 30 })), r);
    expect(view.actions[0]!.kind).toBe('no_office_worse');
    expect(Object.keys(view.factSheet.facts).sort()).toEqual(COMBINED_KEYS);
    expect(view.factSheet.facts['offices.compared']?.value).toBe(3);
    expect(view.factSheet.entities).toEqual([]);
  });

  it('with no unanswered calls, nothing is called a company-wide issue', () => {
    const all = { calls: 500, answered: 500, booked: 150 };
    const view = buildLocations(storeOf(l1({ calls: 100, answered: 100, booked: 30 }, all)), r);
    expect(view.actions[0]!.kind).toBe('no_office_stands_out');
    expect(view.actions[0]!.text).toBe('No office stands out on answer or booking rate.');
  });

  it('when no office has enough calls to be tested, it says so', () => {
    const few = { calls: 5, answered: 2, booked: 1 };
    const view = buildLocations(storeOf(l1(few, few)), r);
    expect(view.rows.every((row) => !row.answerFlag.eligible && !row.bookingFlag.eligible)).toBe(true);
    expect(view.actions[0]!.kind).toBe('no_office_stands_out');
    expect(view.actions[0]!.text).toBe('There are too few calls in this range to compare offices.');
    expect(view.factSheet.facts).toEqual({});
  });

  it('the larger z wins, even on booking rate', () => {
    const calls = [
      ...officeCalls('loc_a', { calls: 100, answered: 30, booked: 3 }),
      ...officeCalls('loc_b', { calls: 1000, answered: 500, booked: 500 }),
    ];
    const view = buildLocations(storeOf(calls), r);
    const a = view.rows.find((row) => row.locationId === 'loc_a')!;
    expect(a.answerFlag.direction).toBe('worse');
    expect(a.bookingFlag.direction).toBe('worse');
    expect(view.actions[0]!.kind).toBe('review_office_booking');
    expect(view.actions[0]!.text).toBe('Office A books 3.0% of calls versus 50.0% elsewhere. Its best campaign there is Alpha.');
  });

  // The two tests below need exactly equal z on offices the row sort would not already order by id. Offices
  // with equal calls are ordered by id anyway, so these shapes differ in size and were found by searching for
  // inputs whose floating-point z values are identical.
  it('equal z is broken by the office id, even when the row order puts the other office first', () => {
    const calls = [
      ...officeCalls('loc_a', { calls: 50, answered: 10, booked: 10 }),
      ...officeCalls('loc_c', { calls: 120, answered: 36, booked: 36 }),
      ...officeCalls('loc_b', { calls: 1000, answered: 500, booked: 500 }),
    ];
    const store = storeOf(calls);
    const view = buildLocations(store, r);
    expect(view.rows.map((row) => row.locationId)).toEqual(['loc_b', 'loc_c', 'loc_a']);
    const [a, c] = ['loc_a', 'loc_c'].map((id) => view.rows.find((row) => row.locationId === id)!);
    expect(a!.answerFlag.direction).toBe('worse');
    expect(c!.answerFlag.direction).toBe('worse');
    expect(a!.answerFlag.z).toBe(c!.answerFlag.z);
    expect(view.actions[0]!.text).toContain('Office A');

    const reversed = buildLocations({ ...store, calls: [...calls].reverse(), locations: [...locations].reverse() }, r);
    expect(reversed.actions[0]!.text).toContain('Office A');
  });

  it('equal z on answer and booking is broken by answer first, even when the booking office has the lower id', () => {
    // Office A's booking z equals office C's answer z. Office id alone would pick A's booking.
    const calls = [
      ...officeCalls('loc_a', { calls: 100, answered: 50, booked: 0 }),
      ...officeCalls('loc_c', { calls: 250, answered: 50, booked: 50 }),
      ...officeCalls('loc_b', { calls: 1000, answered: 500, booked: 500 }),
    ];
    const store = storeOf(calls);
    const check = (view: ReturnType<typeof buildLocations>) => {
      const [a, c] = ['loc_a', 'loc_c'].map((id) => view.rows.find((row) => row.locationId === id)!);
      expect(a!.bookingFlag.direction).toBe('worse');
      expect(c!.answerFlag.direction).toBe('worse');
      expect(a!.answerFlag.flagged).toBe(false);
      expect(a!.bookingFlag.z).toBe(c!.answerFlag.z);
      expect(Math.abs(c!.bookingFlag.z!)).toBeLessThan(Math.abs(c!.answerFlag.z!));
      expect(view.actions[0]!.kind).toBe('review_office_answer');
      expect(view.actions[0]!.text).toContain('Office C answers');
    };
    check(buildLocations(store, r));
    check(buildLocations({ ...store, calls: [...calls].reverse(), locations: [...locations].reverse() }, r));
  });

  it('an office with too few calls is not flagged', () => {
    const calls = [
      ...officeCalls('loc_a', { calls: 49, answered: 0, booked: 0 }),
      ...officeCalls('loc_b', { calls: 1000, answered: 500, booked: 300 }),
    ];
    const a = buildLocations(storeOf(calls), r).rows.find((row) => row.locationId === 'loc_a')!;
    expect(a.answerFlag.eligible).toBe(false);
    expect(a.answerFlag.flagged).toBe(false);
  });

  it('an office with no calls in range still has a row', () => {
    const calls = [
      ...officeCalls('loc_a', { calls: 100, answered: 30, booked: 30 }, { localDate: '2026-08-01' }),
      ...officeCalls('loc_b', { calls: 500, answered: 250, booked: 150 }),
    ];
    const a = buildLocations(storeOf(calls), r).rows.find((row) => row.locationId === 'loc_a')!;
    expect(a).toMatchObject({ calls: 0, answerRate: null, bookingRate: null, bestCampaign: null });
    expect(a.answerFlag.eligible).toBe(false);
    expect(a.bookingFlag.eligible).toBe(false);
  });

  it('an office with an invalid time zone gets no row (its calls are reported as bad in the data notes)', () => {
    const broken = { ...office('loc_x', 'Nowhere', 'Mars/Olympus'), timezoneValid: false };
    const store = makeStore(l1({ calls: 100, answered: 30, booked: 30 }), { campaigns, locations: [...locations, broken] });
    expect(buildLocations(store, r).rows.map((row) => row.locationId)).not.toContain('loc_x');
    expect(buildLocations(store, r).rows).toHaveLength(3);
  });

  it('an empty range builds', () => {
    const view = buildLocations(storeOf(l1({ calls: 100, answered: 30, booked: 30 })), range('2026-01-01', '2026-01-07'));
    expect(view.rows.every((row) => row.calls === 0)).toBe(true);
    expect(view.actions).toHaveLength(1);
    expect(view.actions[0]!.kind).toBe('no_office_stands_out');
    expect(view.actions[0]!.text).toBe('There are too few calls in this range to compare offices.');
    expectAllFinite(view);
    expect(buildLocations(makeStore([]), r).rows).toEqual([]);
  });
});
