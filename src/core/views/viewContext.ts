import { incompleteDays, outcomeLagApplies, resolveComparison } from '../comparison';
import type { IncompleteDays } from '../comparison';
import type { LocalDate } from '../localDate';
import { callsInRange } from '../metrics';
import { dataSpan } from '../ranges';
import type { DateRange, ResolvedRange } from '../ranges';
import type { CallStore, CleanCall } from '../types';
import type { Action, FactSheet, ViewName } from './facts';

/** The caveats PLAN.md 3.3 wants next to the numbers; every view returns them. */
export interface ViewNotes {
  /** The data's last local date (the range end when the store is empty). */
  asOf: LocalDate;
  /** The range was cut to the data. */
  clamped: boolean;
  comparison: { available: boolean; previous: DateRange | null; reason: string | null; overlaps: boolean };
  incompleteCurrent: IncompleteDays;
  /** null when there is no previous range. */
  incompletePrevious: IncompleteDays | null;
  outcomeLag: { days: number; applies: boolean };
  skippedRows: number;
}

export interface ViewBase {
  view: ViewName;
  range: ResolvedRange;
  notes: ViewNotes;
  /** Never empty; actions[0] is the headline. */
  actions: Action[];
  templateSentence: string;
  factSheet: FactSheet;
}

export interface ViewContext {
  store: CallStore;
  span: DateRange;
  range: ResolvedRange;
  /** Calls whose localDate is in range. */
  current: CleanCall[];
  /** null unless the comparison is available. */
  previous: CleanCall[] | null;
  notes: ViewNotes;
}

/** Resolve the comparison once and gather the caveats. A bad second range gives a reason, never a throw. */
export function makeViewContext(store: CallStore, range: ResolvedRange, previous?: DateRange): ViewContext {
  // Programmer-error guard: ranges from resolveRange are always valid, and Phase 6 validates user input.
  if (!Number.isInteger(range.days) || range.days < 1) {
    throw new Error(`Invalid range: days must be a positive integer, got ${range.days}`);
  }
  if (range.start > range.end) {
    throw new Error(`Invalid range: start ${range.start} is after end ${range.end}`);
  }
  const span = dataSpan(store.calls) ?? range;
  const result = resolveComparison(span, range, previous);

  let comparison: ViewNotes['comparison'];
  let previousWindow: DateRange | null = null;
  let previousCalls: CleanCall[] | null = null;

  if (result.ok) {
    const { comparison: c } = result;
    previousWindow = { start: c.previous.start, end: c.previous.end };
    comparison = { available: c.available, previous: previousWindow, reason: c.unavailableReason, overlaps: c.overlaps };
    if (c.available) previousCalls = callsInRange(store.calls, previousWindow);
  } else {
    comparison = { available: false, previous: null, reason: result.error.message, overlaps: false };
  }

  const notes: ViewNotes = {
    asOf: span.end,
    clamped: range.clamped,
    comparison,
    incompleteCurrent: incompleteDays(span, range),
    incompletePrevious: previousWindow ? incompleteDays(span, previousWindow) : null,
    outcomeLag: {
      days: store.dataNotes.outcomeLagDays,
      applies: outcomeLagApplies(span, range, store.dataNotes.outcomeLagDays),
    },
    skippedRows: store.dataNotes.badRows,
  };

  return { store, span, range, current: callsInRange(store.calls, range), previous: previousCalls, notes };
}
