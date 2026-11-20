import { describe, expect, it } from 'vitest';
import type { CampaignRow, CampaignsView } from '../../src/core/views';
import { BLANK } from '../../src/web/format';
import { campaignsModel, DEFAULT_SORT, nextSort, sortCampaignRows } from '../../src/web/models/campaignsModel';
import type { CampaignRowModel, CampaignSort } from '../../src/web/models/campaignsModel';
import { campaignsFor, emptyRangeStore, storeWithNames, storeWithZeroBudget } from './fixtures';

const server = campaignsFor('range=all');
const rowOf = (view: CampaignsView, id: string): CampaignRow => view.rows.find((r) => r.campaignId === id)!;
const modelRow = (rows: CampaignRowModel[], id: string): CampaignRowModel => rows.find((r) => r.id === id)!;

/** A bare row; only the fields a test names matter. */
function row(id: string, over: Partial<CampaignRow> = {}): CampaignRow {
  return {
    campaignId: id,
    name: id,
    channel: 'social',
    calls: 1,
    bookings: 0,
    bookingRate: 0,
    revenueUsd: 0,
    estimatedSpendUsd: 10,
    estimatedCostPerBookingUsd: null,
    revenuePerBudgetDollar: null,
    isBest: false,
    isWorst: false,
    previousCalls: null,
    callsChange: { kind: 'none' },
    alert: null,
    ...over,
  };
}

describe('columns', () => {
  it('has the plan labels in order, with the three estimate columns flagged', () => {
    const { columns } = campaignsModel(server, DEFAULT_SORT);
    expect(columns.map((c) => c.label)).toEqual([
      'Campaign',
      'Channel',
      'Calls',
      'Calls vs previous',
      'Bookings',
      'Booking rate',
      'Revenue',
      'Est. spend',
      'Est. cost per booking',
      'Est. revenue per budget $',
    ]);
    expect(columns.map((c) => c.estimate)).toEqual([false, false, false, false, false, false, false, true, true, true]);
    expect(columns.map((c) => c.numeric)).toEqual([false, false, true, true, true, true, true, true, true, true]);
  });
});

describe('sorting', () => {
  it('DEFAULT_SORT keeps the API order', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'calls', dir: 'desc' });
    expect(sortCampaignRows(server.rows, DEFAULT_SORT).map((r) => r.campaignId)).toEqual(
      server.rows.map((r) => r.campaignId),
    );
  });

  it('sorts names case-insensitively', () => {
    const rows = [row('c', { name: 'banana' }), row('a', { name: 'Cherry' }), row('b', { name: 'apple' })];
    expect(sortCampaignRows(rows, { key: 'name', dir: 'asc' }).map((r) => r.name)).toEqual(['apple', 'banana', 'Cherry']);
    expect(sortCampaignRows(rows, { key: 'name', dir: 'desc' }).map((r) => r.name)).toEqual(['Cherry', 'banana', 'apple']);
  });

  it('leaves null rows last in both directions', () => {
    const rows = [
      row('a', { estimatedCostPerBookingUsd: null }),
      row('b', { estimatedCostPerBookingUsd: 5 }),
      row('c', { estimatedCostPerBookingUsd: 9 }),
    ];
    const ids = (dir: 'asc' | 'desc') =>
      sortCampaignRows(rows, { key: 'estimatedCostPerBookingUsd', dir }).map((r) => r.campaignId);
    expect(ids('desc')).toEqual(['c', 'b', 'a']);
    expect(ids('asc')).toEqual(['b', 'c', 'a']);
  });

  it('breaks ties by campaign id ascending, in either direction', () => {
    const rows = [row('b', { calls: 3 }), row('c', { calls: 3 }), row('a', { calls: 3 })];
    expect(sortCampaignRows(rows, { key: 'calls', dir: 'desc' }).map((r) => r.campaignId)).toEqual(['a', 'b', 'c']);
    expect(sortCampaignRows(rows, { key: 'calls', dir: 'asc' }).map((r) => r.campaignId)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate its input', () => {
    const rows = [row('b', { calls: 1 }), row('a', { calls: 2 })];
    const before = rows.map((r) => r.campaignId);
    sortCampaignRows(rows, { key: 'calls', dir: 'asc' });
    expect(rows.map((r) => r.campaignId)).toEqual(before);
  });

  it('nextSort flips the same key and picks a start direction for a new one', () => {
    expect(nextSort(DEFAULT_SORT, 'calls')).toEqual({ key: 'calls', dir: 'asc' });
    expect(nextSort(DEFAULT_SORT, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort(DEFAULT_SORT, 'channel')).toEqual({ key: 'channel', dir: 'asc' });
    expect(nextSort(DEFAULT_SORT, 'revenueUsd')).toEqual({ key: 'revenueUsd', dir: 'desc' });
  });

  it('never moves the unattributed row', () => {
    const view = campaignsFor('range=all', storeWithZeroBudget());
    const sorts: CampaignSort[] = [DEFAULT_SORT, { key: 'name', dir: 'asc' }, { key: 'revenueUsd', dir: 'asc' }];
    for (const sort of sorts) {
      const model = campaignsModel(view, sort);
      expect(model.rows.every((r) => r.id !== null)).toBe(true);
      expect(model.unattributed?.name).toBe('Unattributed');
    }
  });
});

describe('blank cells explain themselves', () => {
  const view = campaignsFor('range=all', storeWithZeroBudget());
  const model = campaignsModel(view, DEFAULT_SORT);

  it('a $0 budget campaign', () => {
    const free = modelRow(model.rows, 'cmp_free').cells;
    expect(free.estimatedSpendUsd.text).toBe('$0');
    expect(free.estimatedCostPerBookingUsd.text).toBe(BLANK);
    expect(free.estimatedCostPerBookingUsd.note).toContain('$0 budget');
    expect(free.revenuePerBudgetDollar.text).toBe(BLANK);
    expect(free.revenuePerBudgetDollar.note).toContain('$0 budget');
  });

  it('a budget with no bookings', () => {
    const idle = modelRow(model.rows, 'cmp_idle').cells;
    expect(idle.estimatedCostPerBookingUsd.text).toBe(BLANK);
    expect(idle.estimatedCostPerBookingUsd.note).toContain('no bookings');
  });

  it('the Unattributed row', () => {
    const cells = model.unattributed!.cells;
    for (const key of ['estimatedSpendUsd', 'estimatedCostPerBookingUsd', 'revenuePerBudgetDollar'] as const) {
      expect(cells[key].text).toBe(BLANK);
      expect(cells[key].note).toContain('Not applicable');
    }
  });

  it('a campaign with no calls says so in the booking rate', () => {
    const idle = campaignsModel({ ...view, rows: [row('x', { calls: 0, bookingRate: null })] }, DEFAULT_SORT);
    expect(idle.rows[0]!.cells.bookingRate).toEqual({ text: BLANK, note: 'No calls in this range.' });
  });

  it('never prints infinity, NaN or undefined', () => {
    const cells = [...model.rows, model.unattributed!].flatMap((r) => Object.values(r.cells));
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell.text).not.toMatch(/Infinity|NaN|undefined/);
  });
});

describe('best and worst', () => {
  it('marks the API rows and has no note', () => {
    const base = campaignsFor('range=all', storeWithNames(['A', 'B', 'C']));
    const view: CampaignsView = {
      ...base,
      rows: base.rows.map((r, i) => ({ ...r, isBest: i === 0, isWorst: i === 2 })),
    };
    const model = campaignsModel(view, DEFAULT_SORT);
    expect(modelRow(model.rows, view.rows[0]!.campaignId!).marks).toEqual(['best']);
    expect(modelRow(model.rows, view.rows[2]!.campaignId!).marks).toEqual(['worst']);
    expect(modelRow(model.rows, view.rows[1]!.campaignId!).marks).toEqual([]);
    expect(model.bestWorstNote).toBeNull();
  });

  it('with fewer than two eligible, marks nothing and passes the reason', () => {
    const view = campaignsFor('range=all', storeWithZeroBudget());
    expect(view.bestWorst.reason).not.toBeNull();
    const model = campaignsModel(view, DEFAULT_SORT);
    expect(model.rows.every((r) => r.marks.length === 0)).toBe(true);
    expect(model.bestWorstNote).toBe(view.bestWorst.reason);
  });
});

describe('unattributed', () => {
  it('is pinned out of rows, with tracking numbers in API order', () => {
    const view = campaignsFor('range=all', storeWithZeroBudget());
    const model = campaignsModel(view, DEFAULT_SORT);
    expect(model.rows.map((r) => r.id)).not.toContain(null);
    expect(model.unattributed!.id).toBeNull();
    // Literal: the fixture's one tracking number, 14 unattributed calls.
    expect(model.unattributed!.trackingNumbers.map((t) => t.text)).toEqual(['+1-555-0100 · 14 calls']);
  });

  it('prints a thousands separator and singular "call" in tracking numbers, in API order', () => {
    const base = campaignsFor('range=all', storeWithZeroBudget());
    // Hand-edited copy of real JSON: three tracking numbers with counts 1,204, 1 and 999.
    const view: CampaignsView = {
      ...base,
      unattributed: {
        ...base.unattributed!,
        trackingNumbers: [
          { trackingNumber: '+1-555-0100', calls: 1204 },
          { trackingNumber: '+1-555-0101', calls: 1 },
          { trackingNumber: '+1-555-0102', calls: 999 },
        ],
      },
    };
    expect(campaignsModel(view, DEFAULT_SORT).unattributed!.trackingNumbers.map((t) => t.text)).toEqual([
      '+1-555-0100 · 1,204 calls',
      '+1-555-0101 · 1 call',
      '+1-555-0102 · 999 calls',
    ]);
  });

  it('is null when the API has none', () => {
    const view = campaignsFor('range=all', storeWithNames(['A', 'B']));
    expect(view.unattributed).toBeNull();
    expect(campaignsModel(view, DEFAULT_SORT).unattributed).toBeNull();
  });
});

describe('actions', () => {
  it('passes the API actions through in order', () => {
    const view = campaignsFor('range=all', storeWithZeroBudget());
    const model = campaignsModel(view, DEFAULT_SORT);
    expect(model.actions.map((a) => a.kind)).toEqual(view.actions.map((a) => a.kind));
    expect(model.actions.map((a) => a.text)).toEqual(view.actions.map((a) => a.text));
    expect(model.actions.map((a) => a.kind)).toEqual(['fix_attribution']);
  });

  it('shift_budget comes before fix_attribution', () => {
    const base = campaignsFor('range=all', storeWithZeroBudget());
    const shift = { ...base.actions[0]!, kind: 'shift_budget' as const, text: 'Shift it.', actionable: true };
    const model = campaignsModel({ ...base, actions: [shift, ...base.actions] }, DEFAULT_SORT);
    expect(model.actions.map((a) => a.kind)).toEqual(['shift_budget', 'fix_attribution']);
    expect(model.actions[0]!.text).toBe('Shift it.');
  });

  it('a no_budget_shift action is not actionable', () => {
    const view = campaignsFor('range=all', storeWithNames(['A', 'B']));
    const model = campaignsModel(view, DEFAULT_SORT);
    expect(view.actions.map((a) => a.kind)).toEqual(['no_budget_shift']);
    expect(model.actions).toEqual([{ kind: 'no_budget_shift', text: view.actions[0]!.text, actionable: false }]);
  });
});

describe('chart choices', () => {
  it('lists every campaign in rows order, zero-call ones included', () => {
    const view = campaignsFor('start=2026-09-10&end=2026-09-20', emptyRangeStore());
    const model = campaignsModel(view, DEFAULT_SORT);
    expect(model.chartChoices).toEqual(view.rows.map((r) => ({ id: r.campaignId, name: r.name })));
    expect(model.chartChoices.length).toBeGreaterThan(0);
  });

  it('selectedCampaignId follows weekly, and is null without it', () => {
    expect(campaignsModel(server, DEFAULT_SORT).selectedCampaignId).toBe(server.weekly!.campaignId);
    expect(campaignsModel({ ...server, weekly: null }, DEFAULT_SORT).selectedCampaignId).toBeNull();
  });
});

describe('very long names stay whole', () => {
  it('returns markup and 300-character names unchanged', () => {
    const long = 'x'.repeat(300);
    const markup = '<img src=x onerror=alert(1)>';
    const view = campaignsFor('range=all', storeWithNames([long, markup]));
    const model = campaignsModel(view, DEFAULT_SORT);
    const names = model.rows.map((r) => r.name);
    expect(names).toContain(long);
    expect(names).toContain(markup);
    expect(model.chartChoices.map((c) => c.name).sort()).toEqual([long, markup].sort());
    expect(model.rows.map((r) => r.cells.name.text)).toEqual(names);
  });
});

describe('empty campaigns range', () => {
  it('is empty when no row and no unattributed call has calls', () => {
    const view = campaignsFor('start=2026-09-10&end=2026-09-20', emptyRangeStore());
    expect(campaignsModel(view, DEFAULT_SORT).empty).toBe(true);
  });

  it('is not empty with calls', () => {
    expect(campaignsModel(server, DEFAULT_SORT).empty).toBe(false);
    expect(rowOf(server, server.rows[0]!.campaignId!).calls).toBeGreaterThan(0);
  });
});

describe('calls vs previous column', () => {
  const cell = (r: CampaignRow, view: CampaignsView = server) =>
    campaignsModel({ ...view, rows: [r] }, DEFAULT_SORT).rows[0]!.cells.callsChange;

  it('prints a percent with the previous count', () => {
    expect(cell(row('a', { calls: 336, previousCalls: 218, callsChange: { kind: 'percent', value: 54.1 } }))).toEqual({
      text: '+54.1% (was 218)',
    });
    expect(cell(row('a', { previousCalls: 1218, callsChange: { kind: 'percent', value: -20 } })).text).toBe(
      '-20.0% (was 1,218)',
    );
  });

  it('prints new as "new (was 0)"', () => {
    expect(cell(row('a', { previousCalls: 0, callsChange: { kind: 'new' } }))).toEqual({ text: 'new (was 0)' });
  });

  it('blanks with a reason: no previous period, or no calls in either', () => {
    const noPrevious = { ...server, alerts: { ...server.alerts, reason: 'No full previous period: x.' } };
    expect(cell(row('a'), noPrevious)).toEqual({ text: BLANK, note: 'No full previous period: x.' });
    const noReason = { ...server, alerts: { ...server.alerts, reason: null } };
    expect(cell(row('a'), noReason)).toEqual({ text: BLANK, note: 'No previous period.' });
    expect(cell(row('a', { previousCalls: 0, callsChange: { kind: 'none' } }))).toEqual({
      text: BLANK,
      note: 'No calls in either period.',
    });
  });

  it('sorts new first, then percents high to low, blanks last, ties by id', () => {
    const rows = [
      row('b', { previousCalls: 5, callsChange: { kind: 'percent', value: 0.1 } }),
      row('blank'),
      row('n2', { previousCalls: 0, callsChange: { kind: 'new' } }),
      row('c', { previousCalls: 5, callsChange: { kind: 'percent', value: 0.5 } }),
      row('n1', { previousCalls: 0, callsChange: { kind: 'new' } }),
      row('d', { previousCalls: 5, callsChange: { kind: 'percent', value: -0.3 } }),
    ];
    const ids = (dir: 'asc' | 'desc') => sortCampaignRows(rows, { key: 'callsChange', dir }).map((r) => r.campaignId);
    expect(ids('desc')).toEqual(['n1', 'n2', 'c', 'b', 'd', 'blank']);
    expect(ids('asc')).toEqual(['d', 'b', 'c', 'n1', 'n2', 'blank']);
  });

  it('starts descending when first chosen', () => {
    expect(nextSort(DEFAULT_SORT, 'callsChange')).toEqual({ key: 'callsChange', dir: 'desc' });
  });
});

describe('jump and drop marks', () => {
  const marksOf = (r: CampaignRow) => campaignsModel({ ...server, rows: [r] }, DEFAULT_SORT).rows[0]!.marks;

  it('adds the alert direction after best and worst', () => {
    expect(marksOf(row('a', { alert: { direction: 'drop', z: -4 } }))).toEqual(['drop']);
    expect(marksOf(row('a', { alert: { direction: 'jump', z: 4 } }))).toEqual(['jump']);
    expect(marksOf(row('a', { isWorst: true, alert: { direction: 'drop', z: -4 } }))).toEqual(['worst', 'drop']);
    expect(marksOf(row('a'))).toEqual([]);
  });
});

describe('alerts note and rule', () => {
  const withAlerts = (alerts: Partial<CampaignsView['alerts']>): CampaignsView => ({
    ...server,
    alerts: { checked: true, reason: null, flagged: 0, z: 3, minCalls: 20, ...alerts },
  });

  it('alertsNote gives the reason when not checked, the all-clear when none flagged, else null', () => {
    const notChecked = withAlerts({ checked: false, reason: 'No full previous period: nope.' });
    expect(campaignsModel(notChecked, DEFAULT_SORT).alertsNote).toBe('No full previous period: nope.');
    expect(campaignsModel(withAlerts({}), DEFAULT_SORT).alertsNote).toBe(
      "No campaign's calls changed by more than chance explains.",
    );
    expect(campaignsModel(withAlerts({ flagged: 2 }), DEFAULT_SORT).alertsNote).toBeNull();
  });

  it('alertsRule is null when not checked, else uses the view numbers', () => {
    expect(campaignsModel(withAlerts({ checked: false }), DEFAULT_SORT).alertsRule).toBeNull();
    const rule = campaignsModel(withAlerts({}), DEFAULT_SORT).alertsRule!;
    expect(rule).toContain('fewer than 20 calls across both periods');
    expect(rule).toContain('reaches 3 in either direction');
    const other = campaignsModel(withAlerts({ minCalls: 25, z: 4 }), DEFAULT_SORT).alertsRule!;
    expect(other).toContain('fewer than 25 calls');
    expect(other).toContain('reaches 4 in');
    expect(other).not.toContain('20');
  });

  it('passes a 300-character name through whole', () => {
    const long = 'x'.repeat(300);
    const view = { ...server, rows: [row('a', { name: long, previousCalls: 1, callsChange: { kind: 'new' } as const })] };
    expect(campaignsModel(view, DEFAULT_SORT).rows[0]!.name).toBe(long);
  });
});
