import { describe, expect, test } from 'vitest';
import type { CallbackRow } from '../../src/core/views/callbacks';
import { formatCount, formatUsd } from '../../src/core/views/format';
import type { MissedCallsView } from '../../src/core/views/missedCallsView';
import { CALLBACK_PAGE_SIZE, missedCallsModel } from '../../src/web/models/missedCallsModel';
import { callAt, campaign, makeStore, office } from '../core/views/fixtures';
import { missedCallsFor, toJson } from './fixtures';

const SPAN = { start: '2026-09-01', end: '2026-10-29' };
const RANGE = 'range=all';

const real = (search = RANGE) => missedCallsFor(search);
const model = (view: MissedCallsView = real(), page?: number) => missedCallsModel(view, SPAN, page);

/** A copy of the real view with `n` callback rows (the first row repeated with new hashes). */
function withRows(n: number): MissedCallsView {
  const view = toJson(real());
  const first = view.callbacks.rows[0]!;
  view.callbacks.rows = Array.from({ length: n }, (_, i) => ({ ...first, callerHash: `h${i + 1}` }));
  view.callbacks.totalValueUsd = 1234;
  return view;
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [String(value)];
}

/** One missed caller who got through later, so the callback list is empty. */
function gotThroughStore() {
  const common = { locationId: 'loc_a', campaignId: 'cmp_a', channel: 'social' as const };
  const calls = [];
  for (let day = 1; day <= 14; day++) {
    const date = `2026-09-${String(day).padStart(2, '0')}`;
    calls.push(
      callAt(`${date}T16:00:00Z`, { ...common, callerHash: `m${day}`, answered: false, outcome: 'missed', booked: false, revenueUsd: 0 }),
      callAt(`${date}T18:00:00Z`, { ...common, callerHash: `m${day}`, answered: true, outcome: null, booked: false, pending: true, revenueUsd: 0 }),
    );
  }
  return makeStore(calls, {
    campaigns: [campaign('cmp_a', 'Alpha', 'social', 10)],
    locations: [office('loc_a', 'Office A', 'America/Phoenix')],
  });
}

describe('missedCallsModel', () => {
  test('lost value', () => {
    const view = real();
    const m = model(view);
    expect(m.lostValue.value).toBe(formatUsd(view.lostValue.estimatedUsd));
    expect(m.lostValue.label.toLowerCase()).toContain('est.');
    expect(m.lostValue.formula).toBe(view.lostValue.formula);
    expect(m.lostValue.sources.length).toBeGreaterThan(0);
    const edited = toJson(view);
    edited.lostValue.bySource = { campaign: 1, channel: 0, overall: 3 };
    expect(model(edited).lostValue.sources).toEqual([
      '1 call valued at their campaign\'s rates',
      '3 calls valued at the overall rates',
    ]);
    edited.lostValue.bySource = { campaign: 0, channel: 2, overall: 0 };
    expect(model(edited).lostValue.sources).toEqual(["2 calls valued at their channel's rates"]);
  });

  test("callbacks print the API's values", () => {
    const view = real();
    const row = view.callbacks.rows[0]!;
    const m = model(view);
    expect(m.callbacks.rows[0]!.key).toBe(row.callerHash);
    expect(m.callbacks.rows[0]!.cells).toEqual([
      row.callerHash,
      formatCount(row.unansweredAttempts),
      row.lastAttemptLocal,
      row.officeName,
      row.campaignName,
      row.trackingNumber,
      formatUsd(row.estimatedValueUsd),
    ]);
    expect(row.lastAttemptLocal).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(m.callbacks.columns.map((c) => c.label)).toEqual([
      'Caller',
      'Unanswered calls in range',
      'Last attempt (office local time)',
      'Office',
      'Campaign',
      'Tracking number',
      'Est. value',
    ]);
    expect(m.callbacks.columns.map((c) => c.numeric)).toEqual([false, true, false, false, false, false, true]);
    expect(m.callbacks.columns.map((c) => c.estimate)).toEqual([false, false, false, false, false, false, true]);

    const stripped = toJson(view);
    for (const r of stripped.callbacks.rows) delete (r as Partial<CallbackRow>).lastAttemptAt;
    expect(model(stripped)).toEqual(m);
  });

  test('summary and total', () => {
    const view = withRows(40);
    for (const page of [1, 2]) {
      expect(model(view, page).callbacks.summary).toBe('40 callers to call back, est. $1,234 in bookings.');
    }
  });

  test('pagination', () => {
    expect(CALLBACK_PAGE_SIZE).toBe(25);
    const view = withRows(40);
    const p1 = model(view, 1).callbacks;
    expect(p1.rows.map((r) => r.key)).toEqual(view.callbacks.rows.slice(0, 25).map((r) => r.callerHash));
    expect(p1.pager).toEqual({
      page: 1,
      pages: 2,
      label: 'Rows 1–25 of 40, highest value first. The CSV has all of them.',
      hasPrevious: false,
      hasNext: true,
    });
    const p2 = model(view, 2).callbacks;
    expect(p2.rows).toHaveLength(15);
    expect(p2.rows[0]!.key).toBe('h26');
    expect(p2.pager).toMatchObject({ page: 2, pages: 2, hasPrevious: true, hasNext: false });
    expect(p2.pager!.label).toMatch(/^Rows 26–40 of 40/);
    for (const bad of [0, -3, NaN]) expect(model(view, bad).callbacks.pager!.page).toBe(1);
    expect(model(view, 99).callbacks.pager!.page).toBe(2);
    expect(model(view, 99).callbacks.rows).toHaveLength(15);
    expect(model(withRows(25)).callbacks.pager).toBeNull();
    expect(model(withRows(25)).callbacks.rows).toHaveLength(25);
    const p26 = model(withRows(26), 2).callbacks;
    expect(p26.rows).toHaveLength(1);
    expect(p26.pager!.label).toMatch(/^Rows 26–26 of 26/);
    expect(model(withRows(26), 2).callbacks.summary).toMatch(/^26 callers/);
  });

  test('an empty callback list', () => {
    const view = missedCallsFor(RANGE, gotThroughStore());
    expect(view.callbacks.rows).toEqual([]);
    const m = model(view);
    expect(m.callbacks.rows).toEqual([]);
    expect(m.callbacks.emptyNote).toBe('No one to call back from this range.');
    expect(m.callbacks.canDownload).toBe(false);
    expect(m.callbacks.pager).toBeNull();
    expect(m.callbacks.summary).toBeDefined();
    expect(m.callbacks.summary).not.toContain('NaN');
    expect(model().callbacks.emptyNote).toBeNull();
    expect(model().callbacks.canDownload).toBe(true);
  });

  test('no missed calls', () => {
    const view = toJson(real());
    view.unansweredCalls = 0;
    view.callbacks.rows = [];
    expect(model(view).noMissed).toBe('No calls went unanswered in this range.');
    expect(model(view).callbacks.canDownload).toBe(false);
    expect(model().noMissed).toBeNull();

    view.officeFilter = { locationId: 'loc_b', name: 'Office B' };
    expect(model(view).noMissed).toBe('No calls went unanswered at Office B in this range.');
    view.officeFilter = { locationId: 'x', name: null };
    expect(model(view).noMissed).toBe('No calls went unanswered at office x in this range.');
  });

  test('a filtered office with no missed calls', () => {
    const view = real(`${RANGE}&location=loc_a`);
    expect(view.unansweredCalls).toBe(0);
    const m = model(view);
    expect(m.filterLabel).toBe('Showing Office A only.');
    expect(m.noMissed).toBe('No calls went unanswered at Office A in this range.');
    expect(m.callbacks.canDownload).toBe(false);
    expect(model().filterLabel).toBeNull();
    expect(model(real(`${RANGE}&location=loc_b`)).filterLabel).toBe('Showing Office B only.');
  });

  test('filter label for an office with no name', () => {
    const view = toJson(real());
    view.officeFilter = { locationId: 'x', name: null };
    expect(model(view).filterLabel).toBe('Showing office x only.');
  });

  test('unidentified callers', () => {
    const view = toJson(real());
    view.unidentifiedUnanswered = 1;
    expect(model(view).unidentifiedNote).toBe('1 unanswered call had no caller number, so that caller cannot be listed.');
    view.unidentifiedUnanswered = 3;
    expect(model(view).unidentifiedNote).toBe('3 unanswered calls had no caller number, so those callers cannot be listed.');
    view.unidentifiedUnanswered = 0;
    expect(model(view).unidentifiedNote).toBeNull();
    view.unidentifiedUnanswered = 2;
    view.callbacks.rows = [];
    const m = model(view);
    expect(m.callbacks.emptyNote).not.toBeNull();
    expect(m.unidentifiedNote).not.toBeNull();
  });

  test('reach note', () => {
    expect(model().reachNote).toBe(
      'Callers are checked against calls up to Oct 29, 2026, the last day in the data. Anyone who got through after that is still listed.',
    );
    expect(model(missedCallsFor(RANGE, gotThroughStore())).reachNote).toContain('Oct 29, 2026');
  });

  test('limit note', () => {
    const view = real();
    expect(model(view).limitNote).toBe(view.limitNote);
  });

  test('download note', () => {
    expect(model().callbacks.downloadNote).toBe(
      'The file has every caller, one per row. Tracking numbers start with an apostrophe so a spreadsheet keeps them as text.',
    );
    expect(model(real(`${RANGE}&location=loc_a`)).callbacks.downloadNote).toContain('apostrophe');
  });

  test('names and hashes stay whole', () => {
    const long = 'x'.repeat(300);
    const markup = '<img src=x onerror=alert(1)>';
    for (const name of [long, markup]) {
      const view = toJson(real());
      view.callbacks.rows = view.callbacks.rows.map((r) => ({
        ...r,
        callerHash: name,
        officeName: name,
        campaignName: name,
      }));
      view.officeFilter = { locationId: 'loc_b', name };
      const m = model(view);
      expect(m.callbacks.rows[0]!.cells[0]).toBe(name);
      expect(m.callbacks.rows[0]!.cells[3]).toBe(name);
      expect(m.callbacks.rows[0]!.cells[4]).toBe(name);
      expect(m.filterLabel).toBe(`Showing ${name} only.`);
    }
  });

  test('blank is never infinity or NaN', () => {
    const zero = toJson(real());
    zero.unansweredCalls = 0;
    zero.callbacks.rows = [];
    zero.callbacks.totalValueUsd = 0;
    const views = [real(), zero, missedCallsFor(RANGE, gotThroughStore()), real(`${RANGE}&location=loc_a`), withRows(40)];
    for (const view of views) {
      for (const text of strings(model(view))) {
        expect(text).not.toMatch(/Infinity|NaN|undefined/);
      }
    }
  });

  test('action passes through', () => {
    const view = real();
    expect(model(view).action).toEqual({
      kind: view.actions[0]!.kind,
      text: view.actions[0]!.text,
      actionable: view.actions[0]!.actionable,
    });
    const none = real(`${RANGE}&location=loc_a`);
    expect(none.actions[0]!.kind).toBe('no_missed_calls');
    expect(model(none).action.actionable).toBe(false);
  });
});

