// The sentence that names the two ranges being compared, so "was 587" is never ambiguous.
import type { DateRange } from '../../core/ranges';
import type { ViewNotes } from '../../core/views/viewContext';
import { formatDateSpan } from '../format';

/** Null unless the comparison is usable and the second range is known. */
export function comparisonLine(notes: ViewNotes, range: DateRange): string | null {
  const { available, previous } = notes.comparison;
  if (!available || previous === null) return null;
  return `Comparing ${formatDateSpan(range.start, range.end)} with ${formatDateSpan(previous.start, previous.end)}.`;
}
