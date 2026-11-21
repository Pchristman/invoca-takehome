import type { QuestionContext, FilterReply } from '../ai/question';
import { WEEKDAY_WORDS, cutName } from '../ai/question';
import type { DateRange } from '../core/ranges';
import type { CallStore } from '../core/types';
import { shorten } from './api';
import { parseAnswerQuery } from './params';
import type { Query } from './params';

export const QUESTION_MAX_CHARS = 300;

type Result = { ok: true; value: string } | { ok: false; detail: string };

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A name is quoted back only if the person's own question contains it; text only the model wrote is never shown. */
const inQuestion = (question: string, name: string): boolean => {
  const wanted = name.trim().toLowerCase();
  return wanted !== '' && question.toLowerCase().includes(wanted);
};

/**
 * The ids of the one thing called `name` (ignoring case and surrounding spaces), or the message to show.
 * The prompt cuts long names, so a reply may also give the cut form of one long name.
 */
function idsFor(
  things: readonly { id: string; name: string }[],
  names: string[],
  noun: string,
  question: string,
): { ok: true; ids: string[] } | { ok: false; detail: string } {
  const ids: string[] = [];
  for (const name of names) {
    let matches = things.filter((t) => same(t.name, name));
    if (matches.length === 0) matches = things.filter((t) => same(cutName(t.name), name));
    const shown = inQuestion(question, name);
    if (matches.length === 0) {
      return { ok: false, detail: shown ? `No ${noun} is called "${shorten(name)}".` : `The question names ${noun === 'office' ? 'an' : 'a'} ${noun} that isn't in the data.` };
    }
    if (matches.length > 1) {
      return { ok: false, detail: shown ? `"${shorten(name)}" matches more than one ${noun}.` : `The question names ${noun === 'office' ? 'an' : 'a'} ${noun} that matches more than one ${noun}.` };
    }
    if (!ids.includes(matches[0]!.id)) ids.push(matches[0]!.id);
  }
  return { ok: true, ids };
}

/** The message for a validator error. It is fixed text: the error's own message may quote what the model wrote. */
function fixedDetail(error: { code: string; field?: string }): string {
  switch (error.code) {
    case 'bad_date':
    case 'start_after_end': return 'The dates in that question are not valid dates in this data.';
    case 'outside_data': return 'The dates in that question are outside the dates of this data.';
  }
  if (error.field === 'f_office') return 'That question names too many offices.';
  if (error.field === 'f_campaign') return 'That question names too many campaigns.';
  return "That question can't be turned into a filter here.";
}

/**
 * A reply that changes nothing about the page: the default view, no list narrowed, unattributed calls not asked
 * for and the range on screen kept. Showing it would present the plain overview as the answer, so it is rejected.
 * A range alone or a view alone is a real answer ("show missed calls last week"), so either one counts.
 */
function isEmptyFilter(reply: FilterReply): boolean {
  return reply.view === 'overview' && reply.range === null && !reply.includeUnattributed
    && reply.offices.length === 0 && reply.campaigns.length === 0 && reply.weekdays.length === 0 && reply.hours.length === 0;
}

/**
 * A model reply as the same query string the URL uses. Names become ids, weekday words become numbers
 * (monday is 0), and the result goes through parseAnswerQuery, so nothing the model said is trusted.
 * `question` is the person's own text: it decides which names may be quoted back.
 */
export function replyToQuery(store: CallStore, span: DateRange | null, reply: FilterReply, question: string): Result {
  if (isEmptyFilter(reply)) return { ok: false, detail: "That question doesn't narrow the calls or pick a view." };
  const offices = idsFor(store.locations, reply.offices, 'office', question);
  if (!offices.ok) return offices;
  const campaigns = idsFor(store.campaigns, reply.campaigns, 'campaign', question);
  if (!campaigns.ok) return campaigns;

  const weekdays: string[] = [];
  for (const word of reply.weekdays) {
    const index = WEEKDAY_WORDS.indexOf(word);
    if (index < 0) return { ok: false, detail: "That question names a day that isn't a day of the week." };
    if (!weekdays.includes(String(index))) weekdays.push(String(index));
  }
  const hours: string[] = [];
  for (const hour of reply.hours) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return { ok: false, detail: "That question names an hour that isn't an hour of the day." };
    }
    if (!hours.includes(String(hour))) hours.push(String(hour));
  }

  const query: Query = { view: [reply.view] };
  if (offices.ids.length > 0) query['f_office'] = offices.ids;
  if (campaigns.ids.length > 0) query['f_campaign'] = campaigns.ids;
  if (reply.includeUnattributed) query['f_unattributed'] = ['1'];
  if (weekdays.length > 0) query['f_weekday'] = weekdays;
  if (hours.length > 0) query['f_hour'] = hours;
  if (reply.range !== null) {
    if ('preset' in reply.range) query['range'] = [reply.range.preset];
    else {
      query['start'] = [reply.range.start];
      query['end'] = [reply.range.end];
    }
  }

  const parsed = parseAnswerQuery(store, span, query);
  if (!parsed.ok) return { ok: false, detail: fixedDetail(parsed.error) };

  const params = new URLSearchParams();
  for (const [key, values] of Object.entries(query)) for (const v of values) params.append(key, v);
  return { ok: true, value: params.toString() };
}

/** What the model may know about the data: the date span and the names (never calls). */
export function questionContext(store: CallStore, span: DateRange): QuestionContext {
  return {
    firstDate: span.start,
    lastDate: span.end,
    offices: store.locations.map((l) => l.name),
    campaigns: store.campaigns.map((c) => c.name),
  };
}
