import type { QuestionContext, FilterReply } from '../ai/question';
import { WEEKDAY_WORDS } from '../ai/question';
import type { DateRange } from '../core/ranges';
import type { CallStore } from '../core/types';
import { shorten } from './api';
import { parseAnswerQuery } from './params';
import type { Query } from './params';

export const QUESTION_MAX_CHARS = 300;

type Result = { ok: true; value: string } | { ok: false; detail: string };

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The ids of the one thing called `name` (ignoring case and surrounding spaces), or the message to show. */
function idsFor(
  things: readonly { id: string; name: string }[],
  names: string[],
  noun: string,
): { ok: true; ids: string[] } | { ok: false; detail: string } {
  const ids: string[] = [];
  for (const name of names) {
    const matches = things.filter((t) => same(t.name, name));
    if (matches.length === 0) return { ok: false, detail: `No ${noun} is called "${shorten(name)}".` };
    if (matches.length > 1) return { ok: false, detail: `"${shorten(name)}" matches more than one ${noun}.` };
    ids.push(matches[0]!.id);
  }
  return { ok: true, ids };
}

/**
 * A model reply as the same query string the URL uses. Names become ids, weekday words become numbers
 * (monday is 0), and the result goes through parseAnswerQuery, so nothing the model said is trusted.
 */
export function replyToQuery(store: CallStore, span: DateRange | null, reply: FilterReply): Result {
  const offices = idsFor(store.locations, reply.offices, 'office');
  if (!offices.ok) return offices;
  const campaigns = idsFor(store.campaigns, reply.campaigns, 'campaign');
  if (!campaigns.ok) return campaigns;

  const weekdays: string[] = [];
  for (const word of reply.weekdays) {
    const index = WEEKDAY_WORDS.indexOf(word);
    if (index < 0) return { ok: false, detail: `"${shorten(String(word))}" is not a day of the week.` };
    weekdays.push(String(index));
  }
  const hours: string[] = [];
  for (const hour of reply.hours) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return { ok: false, detail: `Hour ${shorten(String(hour))} is not an hour of the day.` };
    }
    hours.push(String(hour));
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
  if (!parsed.ok) return { ok: false, detail: parsed.error.message };

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
