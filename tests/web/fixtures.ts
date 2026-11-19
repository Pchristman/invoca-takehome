// Real view JSON for the web tests: the Phase 5 builders run on small stores, then pass through JSON
// so the models see what the browser sees (no Dates, no undefined).
import { dataSpan } from '../../src/core/ranges';
import type { CallStore, CleanCall } from '../../src/core/types';
import { buildCampaigns, buildLocations, buildMissedCalls, buildOverview } from '../../src/core/views';
import type { CampaignsView, LocationsView, MissedCallsView, OverviewView } from '../../src/core/views';
import { DEFAULT_PRESET, PRESETS } from '../../src/server/api';
import type { Meta } from '../../src/server/api';
import { parseViewQuery } from '../../src/server/params';
import type { ViewQuery, ViewQueryWants } from '../../src/server/params';
import { callAt, campaign, makeStore, office, officeCalls } from '../core/views/fixtures';
import { serverFixture } from '../server/helpers';

/** JSON.parse(JSON.stringify(value)): the browser sees JSON, not objects. */
export function toJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Parse a search string the way the server does; throws (a test bug) when the server would reject it. */
function queryFor(store: CallStore, search: string, wants: ViewQueryWants): ViewQuery {
  const params = new URLSearchParams(search);
  const query: Record<string, string[]> = {};
  for (const key of new Set(params.keys())) query[key] = params.getAll(key);
  const parsed = parseViewQuery(store, dataSpan(store.calls), query, wants);
  if (!parsed.ok) throw new Error(`fixtures: "${search}" is not a valid query: ${parsed.error.message}`);
  return parsed.value;
}

/** The real buildOverview as JSON; `search` is an API query like 'range=last7'; `store` defaults to serverFixture(). */
export function overviewFor(search: string, store: CallStore = serverFixture()): OverviewView {
  const q = queryFor(store, search, {});
  return toJson(buildOverview(store, q.range, q.previous));
}

/** The real buildCampaigns as JSON; `search` may carry `campaign=`; `store` defaults to serverFixture(). */
export function campaignsFor(search: string, store: CallStore = serverFixture()): CampaignsView {
  const q = queryFor(store, search, { campaign: true });
  return toJson(buildCampaigns(store, q.range, q.previous, { campaignId: q.campaignId }));
}

/** The real buildLocations as JSON. */
export function locationsFor(search: string, store: CallStore = serverFixture()): LocationsView {
  const q = queryFor(store, search, {});
  return toJson(buildLocations(store, q.range, q.previous));
}

/** The real buildMissedCalls as JSON; `search` may carry `location=`. */
export function missedCallsFor(search: string, store: CallStore = serverFixture()): MissedCallsView {
  const q = queryFor(store, search, { location: true });
  return toJson(buildMissedCalls(store, q.range, q.previous, { locationId: q.locationId }));
}

/** 30 days (2026-09-01 to 2026-09-30) with calls only on the first and last date, so a middle range has none. */
export function emptyRangeStore(): CallStore {
  const calls: CleanCall[] = ['2026-09-01', '2026-09-30'].map((date) =>
    callAt(`${date}T16:00:00Z`, {
      campaignId: 'cmp_a',
      channel: 'social',
      locationId: 'loc_a',
    }),
  );
  return makeStore(calls, {
    campaigns: [campaign('cmp_a', 'Alpha', 'social', 10)],
    locations: [office('loc_a', 'Office A', 'America/Phoenix')],
  });
}

/** The body of GET /api/meta for this store, built the way the server builds it. */
export function metaFor(store: CallStore): Meta {
  const span = dataSpan(store.calls);
  return toJson({
    hasData: span !== null,
    callCount: store.calls.length,
    span,
    campaigns: store.campaigns.map((x) => ({ id: x.id, name: x.name })),
    locations: store.locations.map((x) => ({ id: x.id, name: x.name })),
    presets: PRESETS,
    defaultPreset: DEFAULT_PRESET,
    skippedRows: store.dataNotes.badRows,
    notes: store.dataNotes.notes,
  });
}

/** 14 days (2026-09-01 to 2026-09-14), one booked $100 call per campaign per day; one campaign per name, ids cmp_0, cmp_1, ... */
export function storeWithNames(names: string[]): CallStore {
  const calls: CleanCall[] = [];
  for (let day = 1; day <= 14; day++) {
    const date = `2026-09-${String(day).padStart(2, '0')}`;
    names.forEach((_, i) => {
      calls.push(
        callAt(`${date}T16:00:00Z`, {
          campaignId: `cmp_${i}`,
          channel: 'social',
          locationId: 'loc_a',
          booked: true,
          outcome: 'booked',
          revenueUsd: 100,
        }),
      );
    });
  }
  return makeStore(calls, {
    campaigns: names.map((name, i) => campaign(`cmp_${i}`, name, 'social', 10)),
    locations: [office('loc_a', 'Office A', 'America/Phoenix')],
  });
}

/**
 * 14 days (2026-09-01 to 2026-09-14). cmp_paid: $10 budget, bookings. cmp_free: $0 budget, bookings.
 * cmp_idle: $5 budget, answered calls and no bookings. Plus one unattributed missed call a day.
 */
export function storeWithZeroBudget(): CallStore {
  const calls: CleanCall[] = [];
  const common = { locationId: 'loc_a', channel: 'social' as const };
  for (let day = 1; day <= 14; day++) {
    const date = `2026-09-${String(day).padStart(2, '0')}T16:00:00Z`;
    calls.push(
      callAt(date, {
        ...common,
        campaignId: 'cmp_paid',
        booked: true,
        outcome: 'booked',
        revenueUsd: 100,
      }),
      callAt(date, {
        ...common,
        campaignId: 'cmp_free',
        booked: true,
        outcome: 'booked',
        revenueUsd: 50,
      }),
      callAt(date, {
        ...common,
        campaignId: 'cmp_idle',
        answered: true,
        booked: false,
        outcome: 'not_qualified',
        revenueUsd: 0,
      }),
      callAt(date, {
        ...common,
        campaignId: null,
        unattributed: true,
        booked: false,
        answered: false,
        outcome: 'missed',
        revenueUsd: 0,
      }),
    );
  }
  return makeStore(calls, {
    campaigns: [
      campaign('cmp_paid', 'Paid', 'social', 10),
      campaign('cmp_free', 'Free', 'social', 0),
      campaign('cmp_idle', 'Idle', 'display', 5),
    ],
    locations: [office('loc_a', 'Office A', 'America/Phoenix')],
  });
}

/** One answered $100 booked call a day for campaign cmp_a, every date from `first` to `last` (YYYY-MM-DD, inclusive). */
export function storeOverDates(first: string, last: string): CallStore {
  const calls: CleanCall[] = [];
  const end = Date.parse(`${last}T00:00:00Z`);
  for (let at = Date.parse(`${first}T00:00:00Z`); at <= end; at += 24 * 60 * 60 * 1000) {
    const date = new Date(at).toISOString().slice(0, 10);
    calls.push(
      callAt(`${date}T16:00:00Z`, {
        campaignId: 'cmp_a',
        channel: 'social',
        locationId: 'loc_a',
        answered: true,
        booked: true,
        outcome: 'booked',
        revenueUsd: 100,
      }),
    );
  }
  return makeStore(calls, {
    campaigns: [campaign('cmp_a', 'Alpha', 'social', 10)],
    locations: [office('loc_a', 'Office A', 'America/Phoenix')],
  });
}

const THREE_OFFICES = [office('loc_a', 'Office A'), office('loc_b', 'Office B'), office('loc_c', 'Office C')];
const TWO_CAMPAIGNS = [campaign('cmp_a', 'Alpha', 'social', 10), campaign('cmp_b', 'Beta', 'display', 10)];
type Shape = { calls: number; answered: number; booked: number };
const OTHER: Shape = { calls: 500, answered: 250, booked: 150 };

/** loc_a has the given shape; loc_b and loc_c are the same ordinary office. All calls are on 2026-09-10. */
function threeOffices(a: Shape): CleanCall[] {
  return [...officeCalls('loc_a', a), ...officeCalls('loc_b', OTHER), ...officeCalls('loc_c', OTHER)];
}

/**
 * Stores with a known Locations outcome, shaped like tests/core/views/locationsView.test.ts.
 * answer-worse: loc_a answers 30% against 50%. booking-worse: loc_a books 30% against 50%.
 * better-only: loc_a answers 70% against 50%. none: every office eligible, none flagged.
 */
export function plantedStore(kind: 'answer-worse' | 'booking-worse' | 'better-only' | 'none'): CallStore {
  let calls: CleanCall[];
  if (kind === 'answer-worse') calls = threeOffices({ calls: 100, answered: 30, booked: 30 });
  else if (kind === 'better-only') calls = threeOffices({ calls: 100, answered: 70, booked: 30 });
  else if (kind === 'none') calls = threeOffices({ calls: 100, answered: 50, booked: 30 });
  else {
    calls = [
      ...officeCalls('loc_a', { calls: 60, answered: 60, booked: 25 }, { campaignId: 'cmp_a' }),
      ...officeCalls('loc_a', { calls: 40, answered: 40, booked: 5 }, { campaignId: 'cmp_b' }),
      ...officeCalls('loc_b', { calls: 1000, answered: 1000, booked: 500 }),
    ];
  }
  return makeStore(calls, { campaigns: TWO_CAMPAIGNS, locations: THREE_OFFICES });
}

/** 14 days (2026-09-01 to 14). loc_a has calls daily, loc_b only on 2026-09-01, loc_c never; range 2026-09-08..14 leaves b and c idle. */
export function idleOfficeStore(): CallStore {
  const calls: CleanCall[] = [];
  for (let day = 1; day <= 14; day++) {
    const date = `2026-09-${String(day).padStart(2, '0')}T16:00:00Z`;
    calls.push(callAt(date, { locationId: 'loc_a', campaignId: 'cmp_a', channel: 'social' }));
    if (day === 1) calls.push(callAt(date, { locationId: 'loc_b', campaignId: 'cmp_a', channel: 'social' }));
  }
  return makeStore(calls, { campaigns: TWO_CAMPAIGNS, locations: THREE_OFFICES });
}

/** Only loc_a has calls (`calls` of them, all on 2026-09-10); `offices` says how many offices exist (loc_a, loc_b, ...). */
export function busyOfficeOnlyStore(calls: number, offices: number): CallStore {
  const ids = ['loc_a', 'loc_b', 'loc_c'].slice(0, offices);
  return makeStore(officeCalls('loc_a', { calls, answered: Math.floor(calls / 2), booked: Math.floor(calls / 4) }), {
    campaigns: TWO_CAMPAIGNS,
    locations: ids.map((id) => office(id, `Office ${id.slice(-1).toUpperCase()}`)),
  });
}
