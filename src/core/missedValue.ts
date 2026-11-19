import { rate } from './metrics';
import { THRESHOLDS } from './thresholds';
import type { Channel, CleanCall } from './types';

/** What a group's answered calls with an outcome add up to. Pending and unanswered calls are not in it. */
export interface RateBasis {
  answeredWithOutcome: number;
  bookings: number;
  revenueUsd: number;
}

export interface MissedValueRates {
  byCampaign: Map<string, RateBasis>;
  byChannel: Map<Channel, RateBasis>;
  overall: RateBasis;
}

export interface MissedCallValue {
  valueUsd: number;
  /** Whose rates were used: the campaign's own, its channel's, or the whole export's. */
  source: 'campaign' | 'channel' | 'overall';
  /** Null when no answered call has an outcome. */
  bookingRate: number | null;
  /** Null when there are no bookings. */
  avgBookingValueUsd: number | null;
}

const emptyBasis = (): RateBasis => ({ answeredWithOutcome: 0, bookings: 0, revenueUsd: 0 });

function add(basis: RateBasis, call: CleanCall): void {
  basis.answeredWithOutcome += 1;
  if (call.booked) basis.bookings += 1;
  basis.revenueUsd += call.revenueUsd;
}

function basisFor<K>(map: Map<K, RateBasis>, key: K): RateBasis {
  let basis = map.get(key);
  if (!basis) {
    basis = emptyBasis();
    map.set(key, basis);
  }
  return basis;
}

/**
 * Booking rates and booking values by campaign, channel and overall. Pass every call in the export, not a
 * date range: rates from the whole export stay stable when the marketer changes the range.
 * Unattributed calls count toward their channel and overall, not toward any campaign.
 */
export function buildMissedValueRates(calls: readonly CleanCall[]): MissedValueRates {
  const rates: MissedValueRates = { byCampaign: new Map(), byChannel: new Map(), overall: emptyBasis() };
  for (const call of calls) {
    if (!call.answered || call.outcome === null) continue;
    add(rates.overall, call);
    add(basisFor(rates.byChannel, call.channel), call);
    if (call.campaignId !== null) add(basisFor(rates.byCampaign, call.campaignId), call);
  }
  return rates;
}

/**
 * The expected bookings value of one missed call: its campaign's booking rate x that campaign's average
 * booking value. A campaign with fewer than `minAnswered` answered calls with an outcome borrows its
 * channel's rates, and a thin channel borrows the overall rates (which are used even when thin).
 */
export function estimateMissedCallValue(
  rates: MissedValueRates,
  call: { campaignId: string | null; channel: Channel },
  minAnswered: number = THRESHOLDS.MIN_ANSWERED_FOR_RATE,
): MissedCallValue {
  const own = call.campaignId === null ? undefined : rates.byCampaign.get(call.campaignId);
  const channel = rates.byChannel.get(call.channel);

  let source: MissedCallValue['source'] = 'overall';
  let basis = rates.overall;
  if (own && own.answeredWithOutcome >= minAnswered) {
    source = 'campaign';
    basis = own;
  } else if (channel && channel.answeredWithOutcome >= minAnswered) {
    source = 'channel';
    basis = channel;
  }

  return {
    // Booking rate x average booking value is revenue / answered calls; this form needs no bookings to divide by.
    valueUsd: basis.answeredWithOutcome === 0 ? 0 : basis.revenueUsd / basis.answeredWithOutcome,
    source,
    bookingRate: rate(basis.bookings, basis.answeredWithOutcome),
    avgBookingValueUsd: basis.bookings === 0 ? null : basis.revenueUsd / basis.bookings,
  };
}
