import { describe, expect, it } from 'vitest';
import { dataSpan, resolveRange } from '../../src/core/ranges';
import { buildOverview } from '../../src/core/views';
import type { ViewNotes } from '../../src/core/views';
import { caveatsFor } from '../../src/web/models/caveats';
import { estimateFormulas } from '../../src/web/models/estimates';
import { callAt, campaign, makeStore, office } from '../core/views/fixtures';
import { overviewFor, toJson } from './fixtures';

// The server fixture's data runs 2026-09-01 to 2026-09-14.
const SPAN = { start: '2026-09-01', end: '2026-09-14' };
const ids = (notes: ViewNotes, comparing = true) => caveatsFor(notes, SPAN, { comparing }).map((c) => c.id);
const textOf = (notes: ViewNotes, id: string, comparing = true) =>
  caveatsFor(notes, SPAN, { comparing }).find((c) => c.id === id)?.text;

/** Real notes for a range in the middle of a 30-day store. */
function middleNotes(start: string, end: string): { notes: ViewNotes; span: { start: string; end: string } } {
  const calls = Array.from({ length: 30 }, (_, i) =>
    callAt(`2026-09-${String(i + 1).padStart(2, '0')}T16:00:00Z`, {
      campaignId: 'cmp_a',
    }),
  );
  const store = makeStore(calls, {
    campaigns: [campaign('cmp_a', 'Alpha', 'social', 10)],
    locations: [office('loc_1', 'Office', 'America/Phoenix')],
  });
  const span = dataSpan(calls)!;
  const resolved = resolveRange(span, { kind: 'custom', start, end });
  if (!resolved.ok) throw new Error('bad test range');
  return { notes: toJson(buildOverview(store, resolved.range).notes), span };
}

/** Real notes with every flag switched on, for the order test. */
function everything(): ViewNotes {
  return {
    ...overviewFor('range=last7').notes,
    clamped: true,
    comparison: {
      available: true,
      previous: { start: '2026-09-01', end: '2026-09-07' },
      reason: null,
      overlaps: true,
    },
    incompleteCurrent: { includesFirstDay: true, includesLastDay: true },
    incompletePrevious: { includesFirstDay: true, includesLastDay: true },
    outcomeLag: { days: 3, applies: true },
  };
}

/** Real notes with every flag switched off. */
function quiet(): ViewNotes {
  return {
    ...overviewFor('range=last7').notes,
    clamped: false,
    comparison: {
      available: true,
      previous: { start: '2026-09-01', end: '2026-09-07' },
      reason: null,
      overlaps: false,
    },
    incompleteCurrent: { includesFirstDay: false, includesLastDay: false },
    incompletePrevious: { includesFirstDay: false, includesLastDay: false },
    outcomeLag: { days: 0, applies: false },
  };
}

describe('caveatsFor', () => {
  it('a mid-data range has no caveats', () => {
    // Ends 14 days before the last day, well past any outcome lag.
    const { notes, span } = middleNotes('2026-09-10', '2026-09-16');
    expect(notes.comparison.available).toBe(true);
    expect(caveatsFor(notes, span, { comparing: true })).toEqual([]);
  });

  it('the first and last day of the data', () => {
    const both = caveatsFor(overviewFor('range=all').notes, SPAN, {
      comparing: true,
    });
    expect(both.map((c) => c.id)).toEqual(['first_day', 'last_day']);
    expect(both[0]?.text).toBe('Sep 1, 2026, the first day in the data, may be incomplete.');
    expect(both[1]?.text).toBe('Sep 14, 2026, the last day in the data, may be incomplete.');

    const lastOnly = caveatsFor(overviewFor('range=last7').notes, SPAN, {
      comparing: false,
    });
    expect(lastOnly.map((c) => c.id)).toEqual(['last_day']);
  });

  it('clamped', () => {
    const view = overviewFor('start=2026-09-10&end=2026-09-30');
    const notes = view.notes;
    expect(notes.clamped).toBe(true);
    const text = caveatsFor(notes, SPAN, {
      comparing: true,
      range: view.range,
    }).find((c) => c.id === 'clamped')?.text;
    expect(text).toBe(
      'Showing Sep 10 – Sep 14, 2026: the range you asked for reached outside the data and was cut to fit.',
    );
  });

  it('outcome lag', () => {
    const base = overviewFor('range=last7').notes;
    const withLag = (days: number, applies: boolean): ViewNotes => ({
      ...base,
      outcomeLag: { days, applies },
    });
    expect(textOf(withLag(3, true), 'outcome_lag')).toBe(
      'Recent bookings and revenue may still rise: in this export an outcome can be recorded up to 3 days after the call.',
    );
    expect(textOf(withLag(1, true), 'outcome_lag')).toContain('up to 1 day after');
    expect(ids(withLag(3, false))).not.toContain('outcome_lag');
  });

  it('previous-period caveats need a usable comparison', () => {
    const notes: ViewNotes = {
      ...quiet(),
      incompletePrevious: { includesFirstDay: true, includesLastDay: true },
    };
    expect(ids(notes, true)).toEqual(['previous_first_day', 'previous_last_day']);
    expect(textOf(notes, 'previous_first_day')).toBe(
      'The comparison period includes the first day in the data, which may be incomplete.',
    );
    expect(textOf(notes, 'previous_last_day')).toBe(
      'The comparison period includes the last day in the data, which may be incomplete.',
    );
    expect(ids(notes, false)).toEqual([]);
    const unavailable = {
      ...notes.comparison,
      available: false,
      reason: 'No full previous period: x',
    };
    expect(ids({ ...notes, comparison: unavailable })).toEqual([]);
  });

  it('previous-period caveats are absent for the real all-data range', () => {
    const notes = overviewFor('range=all').notes;
    expect(notes.comparison.available).toBe(false);
    expect(ids(notes)).toEqual(['first_day', 'last_day']);
  });

  it('overlap', () => {
    const notes: ViewNotes = {
      ...quiet(),
      comparison: {
        available: true,
        previous: { start: '2026-09-05', end: '2026-09-11' },
        reason: null,
        overlaps: true,
      },
    };
    expect(textOf(notes, 'overlap')).toBe('The comparison period overlaps the selected range.');
    expect(ids(notes, false)).toEqual([]);
  });

  it('order is fixed', () => {
    expect(ids(everything())).toEqual([
      'clamped',
      'first_day',
      'last_day',
      'previous_first_day',
      'previous_last_day',
      'outcome_lag',
      'overlap',
    ]);
  });
});

describe('estimateFormulas', () => {
  it('has three entries in order with the exact labels', () => {
    expect(estimateFormulas(14).map((f) => f.kind)).toEqual(['spend', 'cost_per_booking', 'revenue_per_dollar']);
    expect(estimateFormulas(14).map((f) => f.label)).toEqual([
      'Est. spend',
      'Est. cost per booking',
      'Est. revenue per budget $',
    ]);
  });

  it('counts the days in the range', () => {
    expect(estimateFormulas(14)[0]?.formula).toContain('14 days');
    expect(estimateFormulas(1)[0]?.formula).toContain('1 day');
    expect(estimateFormulas(1)[0]?.formula).not.toContain('1 days');
  });

  it('says it is an estimate', () => {
    for (const f of estimateFormulas(7)) {
      expect(f.label.toLowerCase()).toContain('est.');
      expect(/estimate|Blank/.test(f.formula)).toBe(true);
    }
  });

  it('uses the exact copy', () => {
    const [spend, cost, revenue] = estimateFormulas(14);
    expect(spend?.formula).toBe(
      'Estimated spend = daily budget × 14 days in this range. The export has no actual spend, so this is an estimate.',
    );
    expect(cost?.formula).toBe(
      'Estimated cost per booking = estimated spend ÷ bookings. Blank when the budget is $0 or there are no bookings.',
    );
    expect(revenue?.formula).toBe(
      'Revenue per budget dollar = revenue ÷ estimated spend. Blank when estimated spend is $0.',
    );
  });
});
