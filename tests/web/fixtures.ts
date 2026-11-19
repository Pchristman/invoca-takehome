// Real view JSON for the web tests: the Phase 5 builders run on small stores, then pass through JSON
// so the models see what the browser sees (no Dates, no undefined).
import { dataSpan } from '../../src/core/ranges';
import type { CallStore, CleanCall } from '../../src/core/types';
import { buildCampaigns, buildOverview } from '../../src/core/views';
import type { CampaignsView, OverviewView } from '../../src/core/views';
import { DEFAULT_PRESET, PRESETS } from '../../src/server/api';
import type { Meta } from '../../src/server/api';
import { parseViewQuery } from '../../src/server/params';
import type { ViewQuery } from '../../src/server/params';
import { callAt, campaign, makeStore, office } from '../core/views/fixtures';
import { serverFixture } from '../server/helpers';

/** JSON.parse(JSON.stringify(value)): the browser sees JSON, not objects. */
export function toJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Parse a search string the way the server does; throws (a test bug) when the server would reject it. */
function queryFor(store: CallStore, search: string, wantsCampaign: boolean): ViewQuery {
  const params = new URLSearchParams(search);
  const query: Record<string, string[]> = {};
  for (const key of new Set(params.keys())) query[key] = params.getAll(key);
  const parsed = parseViewQuery(store, dataSpan(store.calls), query, {
    campaign: wantsCampaign,
  });
  if (!parsed.ok) throw new Error(`fixtures: "${search}" is not a valid query: ${parsed.error.message}`);
  return parsed.value;
}

/** The real buildOverview as JSON; `search` is an API query like 'range=last7'; `store` defaults to serverFixture(). */
export function overviewFor(search: string, store: CallStore = serverFixture()): OverviewView {
  const q = queryFor(store, search, false);
  return toJson(buildOverview(store, q.range, q.previous));
}

/** The real buildCampaigns as JSON; `search` may carry `campaign=`; `store` defaults to serverFixture(). */
export function campaignsFor(search: string, store: CallStore = serverFixture()): CampaignsView {
  const q = queryFor(store, search, true);
  return toJson(buildCampaigns(store, q.range, q.previous, { campaignId: q.campaignId }));
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
