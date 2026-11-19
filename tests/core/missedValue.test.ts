import { describe, expect, test } from 'vitest';
import { buildMissedValueRates, estimateMissedCallValue } from '../../src/core/missedValue';
import type { CleanCall, Channel } from '../../src/core/types';
import { makeCall } from './helpers';

/** `n` answered calls with an outcome for one campaign; the first `booked` are bookings paying `pay` each. */
function answered(campaignId: string, channel: Channel, n: number, booked: number, pay: number): CleanCall[] {
  return Array.from({ length: n }, (_, i) =>
    i < booked
      ? makeCall({ campaignId, channel, revenueUsd: pay })
      : makeCall({ campaignId, channel, outcome: 'not_qualified', booked: false, revenueUsd: 0 }),
  );
}

const pending = (campaignId: string, channel: Channel) =>
  makeCall({ campaignId, channel, outcome: null, booked: false, pending: true, revenueUsd: 0 });
const unanswered = (campaignId: string, channel: Channel) =>
  makeCall({ campaignId, channel, answered: false, outcome: 'missed', booked: false, revenueUsd: 0 });

// cmp_a (social): 30 answered with an outcome, 6 booked at $100, plus 5 pending and 10 unanswered.
// cmp_b (social): 29 answered with an outcome, none booked.
// cmp_c (display): 10 answered with an outcome, 1 booked at $50.
const calls = [
  ...answered('cmp_a', 'social', 30, 6, 100),
  ...Array.from({ length: 5 }, () => pending('cmp_a', 'social')),
  ...Array.from({ length: 10 }, () => unanswered('cmp_a', 'social')),
  ...answered('cmp_b', 'social', 29, 0, 0),
  ...answered('cmp_c', 'display', 10, 1, 50),
];
const rates = buildMissedValueRates(calls);

describe('estimateMissedCallValue', () => {
  test('a campaign with enough answered calls uses its own rate', () => {
    const value = estimateMissedCallValue(rates, { campaignId: 'cmp_a', channel: 'social' });
    expect(value).toMatchObject({ source: 'campaign', bookingRate: 0.2, avgBookingValueUsd: 100 });
    expect(value.valueUsd).toBeCloseTo(20, 9);
  });

  test('exactly MIN_ANSWERED_FOR_RATE answered calls is enough; one fewer falls back to the channel', () => {
    const own = estimateMissedCallValue(rates, { campaignId: 'cmp_a', channel: 'social' });
    expect(own.source).toBe('campaign'); // 30

    const thin = estimateMissedCallValue(rates, { campaignId: 'cmp_b', channel: 'social' }); // 29
    expect(thin.source).toBe('channel');
    expect(thin.valueUsd).toBeCloseTo(600 / 59, 9);
    expect(thin.bookingRate).toBeCloseTo(6 / 59, 9);
  });

  test('a thin campaign on a thin channel falls back to overall', () => {
    const value = estimateMissedCallValue(rates, { campaignId: 'cmp_c', channel: 'display' });
    expect(value.source).toBe('overall');
    expect(value.valueUsd).toBeCloseTo(650 / 69, 9);
  });

  test('an unattributed call uses its channel, or overall when the channel is thin', () => {
    expect(estimateMissedCallValue(rates, { campaignId: null, channel: 'social' }).source).toBe('channel');
    expect(estimateMissedCallValue(rates, { campaignId: null, channel: 'display' }).source).toBe('overall');
  });

  test('an unknown campaign id uses its channel', () => {
    expect(estimateMissedCallValue(rates, { campaignId: 'cmp_missing', channel: 'social' }).source).toBe('channel');
  });

  test('no bookings gives value 0 and no average', () => {
    const none = buildMissedValueRates(answered('cmp_a', 'social', 30, 0, 0));
    expect(estimateMissedCallValue(none, { campaignId: 'cmp_a', channel: 'social' })).toEqual({
      valueUsd: 0,
      source: 'campaign',
      bookingRate: 0,
      avgBookingValueUsd: null,
    });
  });

  test('a booked call with $0 revenue still counts as a booking', () => {
    const mixed = [
      makeCall({ campaignId: 'cmp_a', revenueUsd: 0 }),
      makeCall({ campaignId: 'cmp_a', revenueUsd: 100 }),
      ...answered('cmp_a', 'social', 28, 0, 0),
    ];
    const value = estimateMissedCallValue(buildMissedValueRates(mixed), { campaignId: 'cmp_a', channel: 'social' });
    expect(value.source).toBe('campaign');
    expect(value.bookingRate).toBeCloseTo(2 / 30, 9);
    expect(value.avgBookingValueUsd).toBe(50);
    expect(value.valueUsd).toBeCloseTo(100 / 30, 9);
  });

  test('no answered calls at all gives value 0 from overall, with no NaN', () => {
    const empty = buildMissedValueRates([]);
    expect(estimateMissedCallValue(empty, { campaignId: 'cmp_a', channel: 'social' })).toEqual({
      valueUsd: 0,
      source: 'overall',
      bookingRate: null,
      avgBookingValueUsd: null,
    });
  });

  test('minAnswered can be overridden', () => {
    const value = estimateMissedCallValue(rates, { campaignId: 'cmp_c', channel: 'display' }, 10);
    expect(value.source).toBe('campaign');
  });
});

describe('buildMissedValueRates', () => {
  test('pending and unanswered calls are left out of the denominators', () => {
    expect(rates.byCampaign.get('cmp_a')).toEqual({ answeredWithOutcome: 30, bookings: 6, revenueUsd: 600 });
  });

  test('rates use every call passed in, so the caller chooses the window', () => {
    const august = makeCall({ localDate: '2026-08-15' });
    const october = makeCall({ localDate: '2026-10-15' });
    expect(buildMissedValueRates([august, october]).overall.answeredWithOutcome).toBe(2);
  });
});
