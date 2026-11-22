// The notes that sit next to the numbers (PLAN.md 3.3). Pure: server notes in, sentences out.
import type { DateRange } from '../../core/ranges';
import type { ViewNotes } from '../../core/views/viewContext';
import { formatCount } from '../../core/views/format';
import { formatDateSpan, formatLongDate } from '../format';

export interface Caveat {
  id: 'clamped' | 'first_day' | 'previous_first_day' | 'overlap' | 'per_day';
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
  options: { comparing: boolean; range: DateRange; view?: 'overview' | 'campaigns' },
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
  if (showPrevious && notes.incompletePrevious?.includesFirstDay) {
    add('previous_first_day', 'The comparison period includes the first day in the data, which may be incomplete.');
  }
  if (showPrevious && notes.comparison.overlaps) {
    add('overlap', 'The comparison period overlaps the selected range.');
  }
  const { perDay, currentDays, previousDays } = notes.comparison;
  // perDay always comes with previousDays; the null check skips the text rather than print "0 days".
  if (showPrevious && perDay && previousDays !== null) {
    const lengths = `${formatCount(currentDays, ['day', 'days'])} and ${formatCount(previousDays, ['day', 'days'])}`;
    // Only the Overview has a unique-callers figure to say is not compared.
    const callers = options.view === 'overview' ? ' Unique callers are not compared.' : '';
    add(
      'per_day',
      `The two ranges are different lengths (${lengths}), so changes in calls, bookings and revenue compare per day.${callers}`,
    );
  }
  return found;
}
