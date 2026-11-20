import { Hono } from 'hono';
import type { Context } from 'hono';
import { offService } from '../ai/service';
import type { TakeawayService } from '../ai/service';
import type { QuestionReason, TakeawayResult } from '../ai/types';
import { buildAnswer } from '../core/answer';
import { dataSpan } from '../core/ranges';
import type { DateRange } from '../core/ranges';
import type { CallStore } from '../core/types';
import { buildCampaigns, buildLocations, buildMissedCalls, buildOverview } from '../core/views';
import type { FactSheet, ViewName } from '../core/views';
import { DEFAULT_PRESET, PRESETS, statusFor } from './api';
import type { AnswerResponse, ApiError, DataNotesResponse, Meta, QuestionResponse, TakeawayResponse } from './api';
import { callbacksToCsv } from './csv';
import { parseAnswerQuery, parseViewQuery } from './params';
import { QUESTION_MAX_CHARS, questionContext, replyToQuery } from './questionQuery';
import { serveWebApp } from './staticFiles';
import type { Parsed, ViewQuery, ViewQueryWants } from './params';

export interface AppOptions {
  /** The built web app's folder (defaults to Vite's output folder). */
  webRoot?: string;
  /** Writes the takeaways (defaults to AI off: every takeaway is the template sentence). */
  ai?: TakeawayService;
}

/** What each view needs from the URL and how to build it. The view routes (and the takeaway route) all read this one table. */
interface ViewSpec {
  wants: ViewQueryWants;
  build: (store: CallStore, query: ViewQuery) => { view: ViewName; templateSentence: string; factSheet: FactSheet };
}

// `satisfies` keeps each entry's own result type, so the CSV route can build through this table and still see `callbacks`.
const VIEW_TABLE = {
  overview: { wants: {}, build: (store, q) => buildOverview(store, q.range, q.previous) },
  campaigns: {
    wants: { campaign: true },
    build: (store, q) => buildCampaigns(store, q.range, q.previous, { campaignId: q.campaignId }),
  },
  locations: { wants: {}, build: (store, q) => buildLocations(store, q.range, q.previous) },
  'missed-calls': {
    wants: { location: true },
    build: (store, q) => buildMissedCalls(store, q.range, q.previous, { locationId: q.locationId }),
  },
} satisfies Record<ViewName, ViewSpec>;

const COULDNT = "Couldn't turn that into a filter";

/** The fixed text for each reason. Only invalid_filter carries a detail, and that detail came from our own validator. */
function questionMessage(reason: QuestionReason, detail: string | null): string {
  switch (reason) {
    case 'ai_off': return 'Questions need an AI key.';
    case 'budget_reached': return 'The AI budget for this app is used up.';
    case 'timeout':
    case 'api_error': return "The AI service didn't answer. Try again.";
    case 'refusal':
    case 'malformed': return `${COULDNT}. Try rewording it.`;
    case 'unanswerable': return "That isn't a question about these calls.";
    case 'invalid_filter': return detail ? `${COULDNT}: ${detail}` : `${COULDNT}.`;
    case 'log_unavailable': return 'AI is off for this session.';
  }
}

const INTERNAL_MESSAGE ='Something went wrong on the server.';

export function createApp(store: CallStore, options: AppOptions = {}): Hono {
  const app = new Hono();
  const ai = options.ai ?? offService();
  const span: DateRange | null = dataSpan(store.calls);

  const errorResponse = (c: Context, error: ApiError) => c.json({ error }, statusFor(error.code));

  /** Parse the query the way `name`'s view does; the caller gets the parsed query or the error response to return. */
  const parseFor = (c: Context, name: ViewName): Parsed<ViewQuery> =>
    parseViewQuery(store, span, c.req.queries(), VIEW_TABLE[name].wants);

  app.get('/api/meta', (c) => {
    const meta: Meta = {
      hasData: span !== null,
      callCount: store.calls.length,
      span,
      campaigns: store.campaigns.map((x) => ({ id: x.id, name: x.name })),
      locations: store.locations.map((x) => ({ id: x.id, name: x.name })),
      presets: PRESETS,
      defaultPreset: DEFAULT_PRESET,
      skippedRows: store.dataNotes.badRows,
      notes: store.dataNotes.notes,
      aiStatus: ai.status().status,
    };
    return c.json(meta);
  });

  /** One route per view: parse, map a parse error to its JSON response, build, return the builder's output untouched. */
  const route = (name: ViewName) =>
    app.get(`/api/${name}`, (c) => {
      const parsed = parseFor(c, name);
      if (!parsed.ok) return errorResponse(c, parsed.error);
      return c.json(VIEW_TABLE[name].build(store, parsed.value));
    });
  const viewNames = Object.keys(VIEW_TABLE) as ViewName[];
  for (const name of viewNames) route(name);

  // Code only: the filter comes from the URL, and the AI service is never touched.
  app.get('/api/answer', (c) => {
    const parsed = parseAnswerQuery(store, span, c.req.queries());
    if (!parsed.ok) return errorResponse(c, parsed.error);
    const { range, filter } = parsed.value;
    const response: AnswerResponse = {
      ...buildAnswer(store, range, filter),
      names: {
        offices: store.locations.filter((l) => filter.officeIds.includes(l.id)).map((l) => ({ id: l.id, name: l.name })),
        campaigns: store.campaigns.filter((x) => filter.campaignIds.includes(x.id)).map((x) => ({ id: x.id, name: x.name })),
      },
    };
    return c.json(response);
  });

  // The only AI step of the question box: the model's reply is a filter, and it is shown only after the URL validator accepts it.
  app.get('/api/question', async (c) => {
    const asked = c.req.queries('q') ?? [];
    const q = (asked[0] ?? '').trim();
    if (asked.length > 1) {
      return errorResponse(c, { code: 'bad_param', field: 'q', message: 'The parameter q was given more than once.' });
    }
    if (q === '') {
      return errorResponse(c, { code: 'bad_param', field: 'q', message: 'Type a question first.' });
    }
    if (q.length > QUESTION_MAX_CHARS) {
      return errorResponse(c, { code: 'bad_param', field: 'q', message: `A question may have at most ${QUESTION_MAX_CHARS} characters.` });
    }
    if (span === null) {
      return errorResponse(c, { code: 'no_data', message: 'There are no calls to ask about.' });
    }
    const result = await ai.interpret(q, questionContext(store, span), (reply) => replyToQuery(store, span, reply));
    const response: QuestionResponse = result.ok
      ? { ok: true, source: 'ai', cached: result.cached, query: result.value }
      : {
          ok: false,
          reason: result.reason,
          message: questionMessage(result.reason, result.detail),
        };
    return c.json(response);
  });

  app.get('/api/data-notes', (c) => {
    const response: DataNotesResponse = { dataNotes: store.dataNotes, ai: ai.status() };
    return c.json(response);
  });

  app.get('/api/takeaway/:view', async (c) => {
    const name = viewNames.find((n) => n === c.req.param('view'));
    if (!name) {
      return errorResponse(c, {
        code: 'unknown_view',
        message: `Unknown view. Use one of: ${viewNames.join(', ')}.`,
        field: 'view',
      });
    }
    const parsed = parseFor(c, name);
    if (!parsed.ok) return errorResponse(c, parsed.error);
    const view = VIEW_TABLE[name].build(store, parsed.value);
    let result: TakeawayResult;
    try {
      result = await ai.takeaway(view.factSheet, view.templateSentence);
    } catch {
      // The service should never throw. The message is fixed: an error's own text could carry request details.
      console.error('The takeaway service failed; sending the template text.');
      result = { text: view.templateSentence, source: 'template', reason: 'api_error' };
    }
    const response: TakeawayResponse =
      result.source === 'ai'
        ? { view: name, text: result.text, source: 'ai', reason: null }
        : { view: name, text: result.text, source: 'template', reason: result.reason ?? 'api_error' };
    return c.json(response);
  });

  app.get('/api/missed-calls/callbacks.csv', (c) => {
    const parsed = parseFor(c, 'missed-calls');
    if (!parsed.ok) return errorResponse(c, parsed.error);
    const view = VIEW_TABLE['missed-calls'].build(store, parsed.value);
    // The file name holds dates only, so it can't carry text from the URL.
    return c.body(`\uFEFF${callbacksToCsv(view.callbacks.rows)}`, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="callbacks-${view.range.start}-to-${view.range.end}.csv"`,
    });
  });

  // Last, and only for GET and HEAD, never for the API: an unknown API path must stay a JSON 404, not the app.
  const isApiPath = (path: string) => path === '/api' || path.startsWith('/api/');
  const webApp = serveWebApp(options.webRoot ?? 'dist');
  app.use('*', async (c, next) => {
    const readsPage = c.req.method === 'GET' || c.req.method === 'HEAD';
    return isApiPath(c.req.path) || !readsPage ? next() : webApp(c, next);
  });

  app.notFound((c) => {
    if (isApiPath(c.req.path)) {
      return errorResponse(c, { code: 'not_found', message: 'There is no such endpoint.' });
    }
    return c.text('Not found', 404);
  });

  app.onError((error, c) => {
    console.error(error);
    return errorResponse(c, { code: 'internal', message: INTERNAL_MESSAGE });
  });

  return app;
}
