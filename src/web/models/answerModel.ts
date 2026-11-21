// What the answer page prints, decided here so the component only draws it.
// No arithmetic on metrics: every value is the API's value passed through a core format function.
import type { AnswerRow } from '../../core/answer/answerView';
import type { DateRange } from '../../core/ranges';
import { formatCount, formatHour, formatRate, formatUsd, formatWeekday } from '../../core/views/format';
import type { AnswerResponse } from '../../server/api';
import { BLANK, formatDateSpan } from '../format';
import { toSearch } from '../urlState';
import type { UrlState } from '../urlState';
import { caveatsFor } from './caveats';
import type { Caveat } from './caveats';
import { VIEW_LABELS } from './viewLabels';

export interface AnswerShow {
  interpretation: string; // how the question was read, e.g. 'Missed calls · <office> · Friday · 09:00 to 11:59 · <date span>'
  sentence: string;
  columns: string[];
  rows: { key: string; cells: string[] }[]; // the first cell is the name, as plain text
  totals: { label: string; value: string }[];
  link: { label: string; href: string };
  caveats: Caveat[];
  showTable: boolean; // false for Overview answers (totals only) and when nothing matched
}

const SEPARATOR = ' · ';
const UNATTRIBUTED = 'Unattributed';

/** The end of the last hour: 11 reads '11:59'. */
function endOfHour(hour: number): string {
  return formatHour(hour).replace(':00', ':59');
}

/** One block of hours is a span; anything else is listed. */
function hoursText(hours: number[]): string {
  if (hours.length === 0) return 'all hours';
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const first = sorted[0] as number;
  const last = sorted[sorted.length - 1] as number;
  if (last - first + 1 === sorted.length) return `${formatHour(first)} to ${endOfHour(last)}`;
  return sorted.map(formatHour).join(', ');
}

function weekdaysText(weekdays: number[]): string {
  if (weekdays.length === 0) return 'every day';
  return [...new Set(weekdays)].sort((a, b) => a - b).map(formatWeekday).join(', ');
}

/** Names for the ids, falling back to the id itself; plain text, never markup. */
function namesFor(ids: string[], known: { id: string; name: string }[]): string {
  return ids.map((id) => known.find((item) => item.id === id)?.name ?? id).join(', ');
}

function interpretationFor(answer: AnswerResponse): string {
  const { filter, names, range } = answer;
  const parts = [
    VIEW_LABELS[filter.view],
    filter.officeIds.length === 0 ? 'all offices' : namesFor(filter.officeIds, names.offices),
  ];
  const campaigns = [
    ...(filter.campaignIds.length > 0 ? [namesFor(filter.campaignIds, names.campaigns)] : []),
    ...(filter.includeUnattributed ? [UNATTRIBUTED] : []),
  ];
  if (campaigns.length > 0) parts.push(campaigns.join(', '));
  parts.push(weekdaysText(filter.weekdays), hoursText(filter.hours), formatDateSpan(range.start, range.end));
  return parts.join(SEPARATOR);
}

function cellsFor(row: AnswerRow): string[] {
  return [
    row.name,
    formatCount(row.calls),
    formatCount(row.answered),
    formatCount(row.unanswered),
    row.answerRate === null ? BLANK : formatRate(row.answerRate),
    formatCount(row.bookings),
    row.bookingRate === null ? BLANK : formatRate(row.bookingRate),
    formatUsd(row.revenueUsd),
  ];
}

/** The real view for this answer, with the range kept and, for Missed calls, the one selected office. */
function linkFor(answer: AnswerResponse): AnswerShow['link'] {
  const { filter, range } = answer;
  const target: UrlState = {
    view: filter.view,
    range: { kind: 'custom', start: range.start, end: range.end },
    compare: null,
    campaign: null,
    location: filter.view === 'missed-calls' && filter.officeIds.length === 1 ? (filter.officeIds[0] ?? null) : null,
    campaignSort: null,
    locationSort: null,
    heatmap: 'office',
    dev: false,
    print: false,
    answer: null,
  };
  return { label: `Open ${VIEW_LABELS[filter.view]}`, href: `/${toSearch(target)}` };
}

/** `span` is the data's first and last date (Meta.span), needed for the first and last day caveats. */
export function answerModel(answer: AnswerResponse, span: DateRange): AnswerShow {
  const { totals, groupBy } = answer;
  const nameColumn = groupBy === 'campaign' ? 'Campaign' : 'Office';
  return {
    interpretation: interpretationFor(answer),
    sentence: answer.sentence,
    columns: [nameColumn, 'Calls', 'Answered', 'Unanswered', 'Answer rate', 'Bookings', 'Booking rate', 'Revenue'],
    rows: answer.rows.map((row) => ({ key: row.id ?? 'unattributed', cells: cellsFor(row) })),
    totals: [
      { label: 'Calls', value: formatCount(totals.calls) },
      { label: 'Answered', value: formatCount(totals.answered) },
      { label: 'Unanswered', value: formatCount(totals.unanswered) },
      { label: 'Answer rate', value: totals.answerRate === null ? BLANK : formatRate(totals.answerRate) },
      { label: 'Bookings', value: formatCount(totals.bookings) },
      { label: 'Booking rate', value: totals.bookingRate === null ? BLANK : formatRate(totals.bookingRate) },
      { label: 'Revenue', value: formatUsd(totals.revenueUsd) },
    ],
    link: linkFor(answer),
    caveats: caveatsFor(answer.notes, span, { comparing: false, range: answer.range }),
    showTable: groupBy !== 'none' && answer.rows.length > 0,
  };
}
