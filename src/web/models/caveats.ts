// The notes that sit next to the numbers (PLAN.md 3.3). Pure: server notes in, sentences out.
import type { DateRange } from '../../core/ranges';
import type { ViewNotes } from '../../core/views/viewContext';
import { formatCount } from '../../core/views/format';
import { formatDateSpan, formatLongDate } from '../format';

export interface Caveat {
  id: 'clamped' | 'first_day' | 'last_day' | 'previous_first_day' | 'previous_last_day' | 'outcome_lag' | 'overlap';
  text: string;
}

/**
 * The caveats that apply, in a fixed order. `span` is the data's first and last date.
 * `options.range` is the resolved range, named in the clamped sentence (notes do not carry it), so it is required.
 * The previous-period ones appear only when the comparison is being shown and is usable.
 */
export function caveatsFor(
  notes: ViewNotes,
  span: DateRange,
  options: { comparing: boolean; range: DateRange },
): Caveat[] {
  const found: Caveat[] = [];
  const add = (id: Caveat['id'], text: string) => found.push({ id, text });
  const showPrevious = options.comparing && notes.comparison.available;

  if (notes.clamped) {
    add(
      'clamped',
      `Showing ${formatDateSpan(options.range.start, options.range.end)}: the range you asked for reached outside the data and was cut to fit.`,
    );
  }
  if (notes.incompleteCurrent.includesFirstDay) {
    add('first_day', `${formatLongDate(span.start)}, the first day in the data, may be incomplete.`);
  }
  if (notes.incompleteCurrent.includesLastDay) {
    add('last_day', `${formatLongDate(span.end)}, the last day in the data, may be incomplete.`);
  }
  if (showPrevious && notes.incompletePrevious?.includesFirstDay) {
    add('previous_first_day', 'The comparison period includes the first day in the data, which may be incomplete.');
  }
  if (showPrevious && notes.incompletePrevious?.includesLastDay) {
    add('previous_last_day', 'The comparison period includes the last day in the data, which may be incomplete.');
  }
  if (notes.outcomeLag.applies) {
    const days = formatCount(notes.outcomeLag.days, ['day', 'days']);
    add(
      'outcome_lag',
      `Recent bookings and revenue may still rise: in this export an outcome can be recorded up to ${days} after the call.`,
    );
  }
  if (showPrevious && notes.comparison.overlaps) {
    add('overlap', 'The comparison period overlaps the selected range.');
  }
  return found;
}
