import { describe, expect, it } from 'vitest';
import type { CallStore } from '../../src/core/types';
import type { LocationRow, LocationsView } from '../../src/core/views';
import { formatCount, formatRate, formatUsd } from '../../src/core/views/format';
import { BLANK } from '../../src/web/format';
import {
  DEFAULT_LOCATION_SORT,
  locationsModel,
  nextLocationSort,
  sortLocationRows,
} from '../../src/web/models/locationsModel';
import type { LocationRowModel } from '../../src/web/models/locationsModel';
import { idleOfficeStore, locationsFor, plantedStore } from './fixtures';
import { serverFixture } from '../server/helpers';

const KINDS = ['answer-worse', 'booking-worse', 'better-only', 'none'] as const;
const RANGE = 'start=2026-09-10&end=2026-09-10'; // every planted call is on this day

const planted = (kind: (typeof KINDS)[number]) => locationsFor(RANGE, plantedStore(kind));
const rowOf = (view: LocationsView, id: string): LocationRow => view.rows.find((r) => r.locationId === id)!;
const modelRow = (view: LocationsView, id: string): LocationRowModel =>
  locationsModel(view, DEFAULT_LOCATION_SORT).rows.find((r) => r.id === id)!;

describe('columns', () => {
  it('has the eight columns in order, the last one not a sort key', () => {
    const { columns } = locationsModel(planted('none'), DEFAULT_LOCATION_SORT);
    expect(columns.map((c) => c.label)).toEqual([
      'Office',
      'Calls',
      'Answer rate',
      'Bookings',
      'Booking rate',
      'Revenue',
      'Best campaign there',
      'Compared with other offices',
    ]);
    expect(columns.map((c) => c.key)).toEqual([
      'name',
      'calls',
      'answerRate',
      'bookings',
      'bookingRate',
      'revenueUsd',
      'bestCampaign',
      'flags',
    ]);
  });
});

describe('sorting', () => {
  const view = locationsFor('range=all', idleOfficeStore()); // loc_a many calls, loc_b one, loc_c none
  const ids = (rows: LocationRow[]) => rows.map((r) => r.locationId);

  it('the default order is the API order', () => {
    expect(ids(sortLocationRows(view.rows, DEFAULT_LOCATION_SORT))).toEqual(ids(view.rows));
    const p = planted('answer-worse');
    expect(ids(sortLocationRows(p.rows, DEFAULT_LOCATION_SORT))).toEqual(ids(p.rows));
  });

  it('sorts by name case-insensitively', () => {
    const rows = [
      { ...view.rows[0]!, locationId: 'x1', name: 'banana' },
      { ...view.rows[0]!, locationId: 'x2', name: 'Cherry' },
      { ...view.rows[0]!, locationId: 'x3', name: 'Apple' },
    ];
    expect(ids(sortLocationRows(rows, { key: 'name', dir: 'asc' }))).toEqual(['x3', 'x1', 'x2']);
  });

  it('leaves offices with no answer rate last in both directions', () => {
    const rows = locationsFor('start=2026-09-08&end=2026-09-14', idleOfficeStore()).rows;
    const idle = rows.filter((r) => r.answerRate === null).map((r) => r.locationId);
    expect(idle.length).toBe(2);
    for (const dir of ['asc', 'desc'] as const) {
      const sorted = sortLocationRows(rows, { key: 'answerRate', dir });
      expect(sorted[0]!.locationId).toBe('loc_a');
      expect(ids(sorted).slice(1)).toEqual([...idle].sort());
    }
  });

  it('leaves offices with no best campaign last by bestCampaign', () => {
    const rows = locationsFor('start=2026-09-08&end=2026-09-14', idleOfficeStore()).rows;
    for (const dir of ['asc', 'desc'] as const) {
      const sorted = sortLocationRows(rows, { key: 'bestCampaign', dir });
      expect(sorted.map((r) => r.bestCampaign === null)).toEqual(
        sorted.map((r) => r.bestCampaign === null).sort((a, b) => Number(a) - Number(b)),
      );
    }
  });

  it('breaks ties by office id', () => {
    const p = planted('none'); // loc_b and loc_c have identical numbers
    for (const dir of ['asc', 'desc'] as const) {
      const sorted = ids(sortLocationRows(p.rows, { key: 'bookings', dir }));
      expect(sorted.indexOf('loc_b')).toBeLessThan(sorted.indexOf('loc_c'));
    }
  });

  it('does not change the input array', () => {
    const rows = [...planted('answer-worse').rows];
    const before = ids(rows);
    sortLocationRows(rows, { key: 'name', dir: 'desc' });
    expect(ids(rows)).toEqual(before);
  });

  it('flips on the same key and starts each new key in its natural direction', () => {
    expect(nextLocationSort(DEFAULT_LOCATION_SORT, 'calls')).toEqual({ key: 'calls', dir: 'asc' });
    expect(nextLocationSort(DEFAULT_LOCATION_SORT, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextLocationSort(DEFAULT_LOCATION_SORT, 'bestCampaign')).toEqual({ key: 'bestCampaign', dir: 'asc' });
    expect(nextLocationSort(DEFAULT_LOCATION_SORT, 'revenueUsd')).toEqual({ key: 'revenueUsd', dir: 'desc' });
  });
});

describe('cells', () => {
  it("print the API's values", () => {
    const view = planted('answer-worse');
    for (const row of locationsModel(view, DEFAULT_LOCATION_SORT).rows) {
      const api = rowOf(view, row.id);
      expect(row.name).toBe(api.name);
      expect(row.cells.name.text).toBe(api.name);
      expect(row.cells.calls.text).toBe(formatCount(api.calls));
      expect(row.cells.answerRate.text).toBe(formatRate(api.answerRate!));
      expect(row.cells.bookings.text).toBe(formatCount(api.bookings));
      expect(row.cells.bookingRate.text).toBe(formatRate(api.bookingRate!));
      expect(row.cells.revenueUsd.text).toBe(formatUsd(api.revenueUsd));
      const best = api.bestCampaign!;
      expect(row.cells.bestCampaign.text).toBe(
        `${best.name} (${formatRate(best.bookingRate)} booked, ${formatCount(best.calls, ['call', 'calls'])})`,
      );
    }
  });
});

describe('flags', () => {
  it('a worse answer rate is flagged with both rates', () => {
    const view = planted('answer-worse');
    const a = rowOf(view, 'loc_a');
    const row = modelRow(view, 'loc_a');
    expect(row.flags).toHaveLength(1);
    expect(row.flags[0]).toEqual({
      metric: 'answer',
      direction: 'worse',
      text: `Answer rate worse: ${formatRate(a.answerFlag.officeRate!)} here, ${formatRate(a.answerFlag.restRate!)} at other offices.`,
    });
    expect(row.flagNote).toBeNull();
    for (const id of ['loc_b', 'loc_c']) {
      expect(modelRow(view, id).flags.some((f) => f.direction === 'worse')).toBe(false);
    }
  });

  it('a worse booking rate is flagged and the action goes to Campaigns', () => {
    const view = planted('booking-worse');
    const b = rowOf(view, 'loc_a').bookingFlag;
    const model = locationsModel(view, DEFAULT_LOCATION_SORT);
    expect(modelRow(view, 'loc_a').flags).toEqual([
      {
        metric: 'booking',
        direction: 'worse',
        text: `Booking rate worse: ${formatRate(b.officeRate!)} here, ${formatRate(b.restRate!)} at other offices.`,
      },
    ]);
    expect(model.action.link.view).toBe('campaigns');
    expect(model.action.actionable).toBe(true);
    expect(model.action.linkLabel).toBe('See Campaigns');
  });

  it('better flags show and never become the action', () => {
    const view = planted('better-only');
    const a = rowOf(view, 'loc_a').answerFlag;
    const model = locationsModel(view, DEFAULT_LOCATION_SORT);
    expect(modelRow(view, 'loc_a').flags[0]).toEqual({
      metric: 'answer',
      direction: 'better',
      text: `Answer rate better: ${formatRate(a.officeRate!)} here, ${formatRate(a.restRate!)} at other offices.`,
    });
    expect(model.action.kind).toBe('no_office_worse');
    expect(model.action.actionable).toBe(false);
  });

  it('nothing stands out', () => {
    const model = locationsModel(planted('none'), DEFAULT_LOCATION_SORT);
    for (const row of model.rows) {
      expect(row.flags).toEqual([]);
      expect(row.flagNote).toBe('In line with other offices.');
    }
    expect(model.action.kind).toBe('no_office_stands_out');
    expect(model.action.link).toEqual({ view: 'missed-calls' });
    expect(model.action.linkLabel).toBe('See Missed calls');
  });

  it('too few calls is not a clean bill of health', () => {
    const model = locationsModel(locationsFor('range=last28', serverFixture()), DEFAULT_LOCATION_SORT);
    expect(model.rows.length).toBeGreaterThan(0);
    for (const row of model.rows) expect(row.flagNote).toBe('Too few calls to compare.');
  });

  it('flagNote is set exactly when there are no flags', () => {
    for (const kind of KINDS) {
      for (const row of locationsModel(planted(kind), DEFAULT_LOCATION_SORT).rows) {
        expect(row.flagNote === null).toBe(row.flags.length > 0);
      }
    }
  });

  it('explains how offices are compared', () => {
    expect(locationsModel(planted('none'), DEFAULT_LOCATION_SORT).flagsNote).toBe(
      'Each office is compared with all other offices pooled. Only offices with enough calls are tested, and a difference is flagged only when chance does not explain it.',
    );
  });
});

describe('an office with no calls in range', () => {
  const view = locationsFor('start=2026-09-08&end=2026-09-14', idleOfficeStore());
  const model = locationsModel(view, DEFAULT_LOCATION_SORT);

  it('shows blanks with the reason and no flags', () => {
    for (const id of ['loc_b', 'loc_c']) {
      const row = model.rows.find((r) => r.id === id)!;
      expect(row.cells.calls.text).toBe('0');
      for (const key of ['answerRate', 'bookingRate', 'bestCampaign'] as const) {
        expect(row.cells[key]).toEqual({ text: BLANK, note: 'No calls in this range.' });
      }
      expect(row.flags).toEqual([]);
      expect(row.flagNote).toBe('No calls in this range.');
    }
  });

  it('is empty only when every office has no calls', () => {
    expect(model.empty).toBe(false);
    const allIdle: LocationsView = { ...view, rows: view.rows.map((r) => ({ ...r, calls: 0 })) };
    expect(locationsModel(allIdle, DEFAULT_LOCATION_SORT).empty).toBe(true);
    expect(locationsModel({ ...view, rows: [] }, DEFAULT_LOCATION_SORT).empty).toBe(true);
  });

  it('names why there is no best campaign when the office has calls but too few per campaign', () => {
    const small = locationsFor(RANGE, plantedStore('booking-worse'));
    const withCalls: LocationsView = {
      ...small,
      rows: small.rows.map((r) => (r.locationId === 'loc_b' ? { ...r, bestCampaign: null } : r)),
    };
    const row = locationsModel(withCalls, DEFAULT_LOCATION_SORT).rows.find((r) => r.id === 'loc_b')!;
    expect(row.cells.bestCampaign).toEqual({
      text: BLANK,
      note: 'No campaign has enough calls at this office to name a best one.',
    });
  });
});

describe('the action link label', () => {
  it('names the office', () => {
    const view = planted('answer-worse');
    const model = locationsModel(view, DEFAULT_LOCATION_SORT);
    expect(model.action.link.locationId).toBe('loc_a');
    expect(model.action.linkLabel).toBe(`See Missed calls for ${rowOf(view, 'loc_a').name}`);
  });

  it('falls back to the id when the office is not in the rows', () => {
    const view = planted('answer-worse');
    const model = locationsModel({ ...view, rows: view.rows.filter((r) => r.locationId !== 'loc_a') }, DEFAULT_LOCATION_SORT);
    expect(model.action.linkLabel).toBe('See Missed calls for loc_a');
  });
});

describe('text safety', () => {
  it('blank is never infinity or NaN', () => {
    const views = [
      ...KINDS.map(planted),
      locationsFor('start=2026-09-08&end=2026-09-14', idleOfficeStore()),
      locationsFor('range=last28', serverFixture()),
    ];
    for (const view of views) {
      const model = locationsModel(view, DEFAULT_LOCATION_SORT);
      const text = JSON.stringify([model.rows.map((r) => [r.cells, r.flags, r.flagNote]), model.action]);
      expect(text).not.toMatch(/Infinity|NaN|undefined/);
    }
  });

  it('long and markup names stay whole', () => {
    const long = 'x'.repeat(300);
    const markup = '<img src=x onerror=alert(1)>';
    for (const name of [long, markup]) {
      const base = plantedStore('answer-worse');
      const store: CallStore = {
        ...base,
        locations: base.locations.map((l) => (l.id === 'loc_a' ? { ...l, name } : l)),
        campaigns: base.campaigns.map((c) => (c.id === 'cmp_a' ? { ...c, name } : c)),
      };
      const model = locationsModel(locationsFor(RANGE, store), DEFAULT_LOCATION_SORT);
      const row = model.rows.find((r) => r.id === 'loc_a')!;
      expect(row.name).toBe(name);
      expect(row.cells.bestCampaign.text.startsWith(`${name} (`)).toBe(true);
      expect(model.action.linkLabel).toBe(`See Missed calls for ${name}`);
    }
  });
});
