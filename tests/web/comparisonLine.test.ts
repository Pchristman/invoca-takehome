import { describe, expect, it } from 'vitest';
import { formatDateSpan } from '../../src/web/format';
import { comparisonLine } from '../../src/web/models/comparisonLine';
import { overviewFor } from './fixtures';

describe('comparisonLine', () => {
  it('names both ranges for an available comparison', () => {
    const view = overviewFor('start=2026-09-08&end=2026-09-14');
    expect(comparisonLine(view.notes, view.range)).toBe(
      `Comparing ${formatDateSpan('2026-09-08', '2026-09-14')} with ${formatDateSpan('2026-09-01', '2026-09-07')}.`,
    );
  });

  it('names a second range of another length', () => {
    const view = overviewFor('start=2026-09-08&end=2026-09-14&compareStart=2026-09-01&compareEnd=2026-09-03');
    expect(comparisonLine(view.notes, view.range)).toBe(
      `Comparing ${formatDateSpan('2026-09-08', '2026-09-14')} with ${formatDateSpan('2026-09-01', '2026-09-03')}.`,
    );
  });

  it('prints a one-day second range once, not as a span', () => {
    const view = overviewFor('start=2026-09-08&end=2026-09-14&compareStart=2026-09-01&compareEnd=2026-09-01');
    const line = comparisonLine(view.notes, view.range)!;
    expect(line).toBe(`Comparing ${formatDateSpan('2026-09-08', '2026-09-14')} with Sep 1, 2026.`);
    expect(line).not.toContain('Sep 1 – Sep 1');
  });

  it('is null when the comparison is unavailable (outside the data)', () => {
    const view = overviewFor('range=all');
    expect(view.notes.comparison.available).toBe(false);
    expect(comparisonLine(view.notes, view.range)).toBeNull();
  });

  it('is null when previous is null', () => {
    const view = overviewFor('range=last7');
    const notes = { ...view.notes, comparison: { ...view.notes.comparison, previous: null } };
    expect(comparisonLine(notes, view.range)).toBeNull();
  });

  it('is null for a bad second range', () => {
    const view = overviewFor('range=last7');
    const notes = {
      ...view.notes,
      comparison: { ...view.notes.comparison, available: false, previous: null, reason: 'bad', previousDays: null },
    };
    expect(comparisonLine(notes, view.range)).toBeNull();
  });
});

describe('comparisonLine for a later second range', () => {
  it('names both ranges, selected first', () => {
    const view = overviewFor('start=2026-09-01&end=2026-09-03&compareStart=2026-09-12&compareEnd=2026-09-14');
    expect(comparisonLine(view.notes, view.range)).toBe(
      `Comparing ${formatDateSpan('2026-09-01', '2026-09-03')} with ${formatDateSpan('2026-09-12', '2026-09-14')}.`,
    );
  });
});
