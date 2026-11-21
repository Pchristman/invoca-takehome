import { describe, it, expect } from 'vitest';
import { dataSpan } from '../../src/core/ranges';
import { buildAnswer } from '../../src/core/answer';
import type { AnswerFilter } from '../../src/core/answer';
import { formatHour } from '../../src/core/views/format';
import type { AnswerResponse } from '../../src/server/api';
import { BLANK, formatDateSpan } from '../../src/web/format';
import { answerModel } from '../../src/web/models/answerModel';
import { serverFixture } from '../server/helpers';
import { toJson } from './fixtures';

const store = serverFixture();
const span = dataSpan(store.calls)!;
const RANGE = { start: '2026-09-02', end: '2026-09-09', days: 8, clamped: false };
const NAMES = {
  offices: [
    { id: 'loc_a', name: 'Office A' },
    { id: 'loc_b', name: 'Office B' },
  ],
  campaigns: [
    { id: 'cmp_a', name: 'Alpha' },
    { id: 'cmp_b', name: 'Beta' },
  ],
};

function filter(changes: Partial<AnswerFilter>): AnswerFilter {
  return { view: 'overview', officeIds: [], campaignIds: [], includeUnattributed: false, weekdays: [], hours: [], ...changes };
}

function answer(changes: Partial<AnswerFilter>, names = NAMES): AnswerResponse {
  return toJson({ ...buildAnswer(store, RANGE, filter(changes)), names });
}

describe('answerModel', () => {
  it('reads the question back in one line', () => {
    const show = answerModel(
      answer({ view: 'missed-calls', officeIds: ['loc_a'], weekdays: [4], hours: [9, 10, 11] }),
      span,
    );
    const expected = [
      'Missed calls',
      'Office A',
      'Friday',
      `${formatHour(9)} to ${formatHour(11).replace(':00', ':59')}`,
      formatDateSpan(RANGE.start, RANGE.end),
    ].join(' · ');
    expect(show.interpretation).toBe(expected);
    expect(show.interpretation).toBe(
      'Missed calls · Office A · Friday · 09:00 to 11:59 · Sep 2 – Sep 9, 2026',
    );
  });

  it('empty lists read all offices, every day, all hours; non-adjacent hours are listed; campaigns and Unattributed show', () => {
    const none = answerModel(answer({}), span).interpretation;
    expect(none).toContain('all offices');
    expect(none).toContain('every day');
    expect(none).toContain('all hours');
    expect(answerModel(answer({ hours: [9, 11] }), span).interpretation).toContain(`${formatHour(9)}, ${formatHour(11)}`);
    expect(answerModel(answer({ campaignIds: ['cmp_a'], includeUnattributed: true }), span).interpretation).toContain(
      'Alpha, Unattributed',
    );
  });

  it('a null rate is a blank cell and nothing is NaN', () => {
    const base = answer({ view: 'locations' });
    const row = { ...base.rows[0]!, calls: 0, answered: 0, unanswered: 0, answerRate: null, bookingRate: null };
    const show = answerModel({ ...base, rows: [row] }, span);
    expect(show.rows[0]!.cells[4]).toBe(BLANK);
    expect(show.rows[0]!.cells[6]).toBe(BLANK);
    expect(JSON.stringify(show)).not.toContain('NaN');
  });

  it('names are plain text and kept whole', () => {
    const long = 'x'.repeat(200);
    const names = {
      offices: [
        { id: 'loc_a', name: '<b>x</b>' },
        { id: 'loc_b', name: long },
      ],
      campaigns: NAMES.campaigns,
    };
    const base = answer({ view: 'locations' }, names);
    const rows = base.rows.map((row, i) => ({ ...row, name: i === 0 ? '<b>x</b>' : long }));
    const show = answerModel({ ...base, rows }, span);
    expect(show.rows[0]!.cells[0]).toBe('<b>x</b>');
    expect(show.rows[1]!.cells[0]).toBe(long);
    expect(answerModel(answer({ officeIds: ['loc_a'] }, names), span).interpretation).toContain('<b>x</b>');
  });

  it('says so when no call matches', () => {
    const show = answerModel(answer({ weekdays: [6], hours: [3] }), span);
    expect(show.sentence).toBe('No calls match this question in this range.');
    expect(show.rows).toEqual([]);
    expect(answerModel(answer({}), span).sentence).not.toBe('No calls match this question in this range.');
  });

  it('links to the real view with the range kept', () => {
    const range = 'start=2026-09-02&end=2026-09-09';
    expect(answerModel(answer({ view: 'missed-calls', officeIds: ['loc_a'] }), span).link).toEqual({
      label: 'Open Missed calls',
      href: `/?view=missed-calls&${range}&location=loc_a`,
    });
    expect(
      answerModel(answer({ view: 'missed-calls', officeIds: ['loc_a', 'loc_b'] }), span).link.href,
    ).not.toContain('location');
    expect(answerModel(answer({}), span).link.href).toBe(`/?${range}`);
  });

  it('shows no comparison caveats', () => {
    const base = answer({});
    const comparison = { ...base.notes.comparison, available: true, perDay: true, previousDays: 3, overlaps: true };
    const ids = answerModel({ ...base, notes: { ...base.notes, comparison } }, span).caveats.map((c) => c.id);
    expect(ids).not.toContain('per_day');
    expect(ids).not.toContain('overlap');
  });
});
