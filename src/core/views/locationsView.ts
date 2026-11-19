import { rate, tally } from '../metrics';
import { bestCampaignAtOffice, officeOutlier } from '../ranking';
import type { CampaignAtOffice, OutlierResult } from '../ranking';
import type { DateRange, ResolvedRange } from '../ranges';
import { THRESHOLDS } from '../thresholds';
import type { CallStore, CleanCall } from '../types';
import { makeAction, makeFactSheet } from './facts';
import type { Action, Facts } from './facts';
import { busiestMissedSlot } from './missedSlots';
import { makeViewContext } from './viewContext';
import type { ViewBase } from './viewContext';

export interface BestCampaign {
  campaignId: string;
  name: string;
  calls: number;
  bookings: number;
  bookingRate: number;
}

export interface LocationRow {
  locationId: string;
  name: string;
  calls: number;
  answered: number;
  answerRate: number | null;
  bookings: number;
  bookingRate: number | null;
  revenueUsd: number;
  /** Highest booking rate among campaigns with enough calls there; unattributed calls are not a campaign. */
  bestCampaign: BestCampaign | null;
  /** The office against all other offices pooled, in range. */
  answerFlag: OutlierResult;
  bookingFlag: OutlierResult;
}

export interface LocationsView extends ViewBase {
  view: 'locations';
  /** Every store location, calls desc, ties by location id. */
  rows: LocationRow[];
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const CALLS = ['call', 'calls'] as const;

export function buildLocations(store: CallStore, range: ResolvedRange, previous?: DateRange): LocationsView {
  const ctx = makeViewContext(store, range, previous);
  const total = tally(ctx.current);
  const campaignNames = new Map(store.campaigns.map((c) => [c.id, c.name]));

  const rows: LocationRow[] = store.locations.map((location) => {
    const calls = ctx.current.filter((c) => c.locationId === location.id);
    const t = tally(calls);
    // "Rest" is the range total minus this office; every office is computed the same way.
    const rest = { calls: total.calls - t.calls, answered: total.answered - t.answered, bookings: total.bookings - t.bookings };
    return {
      locationId: location.id,
      name: location.name,
      calls: t.calls,
      answered: t.answered,
      answerRate: rate(t.answered, t.calls),
      bookings: t.bookings,
      bookingRate: rate(t.bookings, t.calls),
      revenueUsd: t.revenueUsd,
      bestCampaign: pickBestCampaign(calls, campaignNames),
      answerFlag: officeOutlier({ successes: t.answered, calls: t.calls }, { successes: rest.answered, calls: rest.calls }),
      bookingFlag: officeOutlier({ successes: t.bookings, calls: t.calls }, { successes: rest.bookings, calls: rest.calls }),
    };
  });
  rows.sort((a, b) => b.calls - a.calls || byText(a.locationId, b.locationId));

  const action = chooseAction(rows, ctx.current);
  return {
    view: 'locations',
    range,
    notes: ctx.notes,
    actions: [action],
    templateSentence: action.text,
    factSheet: makeFactSheet('locations', action.facts),
    rows,
  };
}

function pickBestCampaign(officeCalls: readonly CleanCall[], names: ReadonlyMap<string, string>): BestCampaign | null {
  const perCampaign = new Map<string, CampaignAtOffice>();
  for (const call of officeCalls) {
    if (call.campaignId === null || !names.has(call.campaignId)) continue;
    const entry = perCampaign.get(call.campaignId) ?? { campaignId: call.campaignId, calls: 0, bookings: 0 };
    entry.calls += 1;
    if (call.booked) entry.bookings += 1;
    perCampaign.set(call.campaignId, entry);
  }
  const best = bestCampaignAtOffice([...perCampaign.values()]);
  if (best === null) return null;
  return {
    campaignId: best.campaignId,
    name: names.get(best.campaignId)!,
    calls: best.calls,
    bookings: best.bookings,
    bookingRate: best.bookings / best.calls,
  };
}

interface Candidate {
  row: LocationRow;
  kind: 'answer' | 'booking';
  flag: OutlierResult;
}

function chooseAction(rows: readonly LocationRow[], current: readonly CleanCall[]): Action {
  const candidates: Candidate[] = [];
  let anyBetter = false;
  for (const row of rows) {
    for (const [kind, flag] of [['answer', row.answerFlag], ['booking', row.bookingFlag]] as const) {
      if (!flag.flagged) continue;
      if (flag.direction === 'worse') candidates.push({ row, kind, flag });
      else anyBetter = true;
    }
  }

  // Largest |z| first; ties: answer before booking, then the lower office id.
  candidates.sort(
    (a, b) =>
      Math.abs(b.flag.z!) - Math.abs(a.flag.z!) ||
      (a.kind === b.kind ? 0 : a.kind === 'answer' ? -1 : 1) ||
      byText(a.row.locationId, b.row.locationId),
  );
  const top = candidates[0];

  if (!top) {
    const link = { view: 'missed-calls' } as const;
    return anyBetter
      ? makeAction(
          'no_office_worse',
          'No office is doing worse than the rest on answer or booking rate. Missed calls are a company-wide issue.',
          {},
          link,
        )
      : makeAction(
          'no_office_stands_out',
          'No office stands out on answer or booking rate. Missed calls are a company-wide issue.',
          {},
          link,
        );
  }

  const { row, flag } = top;
  const rates: Facts = {
    office: { kind: 'name', value: row.name },
    office_rate: { kind: 'rate', value: flag.officeRate! },
    rest_rate: { kind: 'rate', value: flag.restRate! },
  };

  if (top.kind === 'answer') {
    const slot = busiestMissedSlot(current.filter((c) => c.locationId === row.locationId));
    const facts: Facts = prefixed('office_answer', rates);
    let template = '{office_answer.office} answers {office_answer.office_rate} of calls versus {office_answer.rest_rate} at other offices.';
    if (slot) {
      facts['office_answer.weekday'] = { kind: 'weekday', value: slot.weekday };
      facts['office_answer.hour'] = { kind: 'hour', value: slot.hour };
      template += ' Its most-missed hour is {office_answer.weekday} {office_answer.hour} local.';
    }
    return makeAction('review_office_answer', template, facts, { view: 'missed-calls', locationId: row.locationId });
  }

  const facts: Facts = prefixed('office_booking', rates);
  let template = '{office_booking.office} books {office_booking.office_rate} of calls versus {office_booking.rest_rate} elsewhere.';
  if (row.bestCampaign) {
    facts['office_booking.campaign'] = { kind: 'name', value: row.bestCampaign.name };
    template += ' Its best campaign there is {office_booking.campaign}.';
  } else {
    facts['office_booking.min_calls'] = { kind: 'count', value: THRESHOLDS.MIN_CALLS_BEST_CAMPAIGN, noun: CALLS };
    template += ' No campaign there has at least {office_booking.min_calls} to name a best one.';
  }
  return makeAction('review_office_booking', template, facts, { view: 'campaigns' });
}

function prefixed(prefix: string, facts: Facts): Facts {
  return Object.fromEntries(Object.entries(facts).map(([key, fact]) => [`${prefix}.${key}`, fact]));
}
