import { Hono } from 'hono';
import type { Context } from 'hono';
import { offService } from '../ai/service';
import type { TakeawayService } from '../ai/service';
import type { UploadService } from '../db/upload/service';
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
import { mountUploadRoutes } from './uploadRoutes';
import type { Parsed, ViewQuery, ViewQueryWants } from './params';

export interface AppOptions {
  /** The built web app's folder (defaults to Vite's output folder). */
  webRoot?: string;
  /** Writes the takeaways (defaults to AI off: every takeaway is the template sentence). */
  ai?: TakeawayService;
  /** Previews and writes uploaded CSVs. Omitted: the upload routes answer upload_unavailable. */
  uploads?: UploadService;
  /** Builds the takeaway service for the store an upload produced. Omitted: the service stays as it was. */
  rebuildAi?: (store: CallStore) => TakeawayService;
  /** Host names (no port) the upload routes accept besides localhost, 127.0.0.1 and [::1]: the address the server was told to bind. */
  allowedHosts?: string[];
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** The host name in a Host header, lower case, without the port; IPv6 keeps its brackets. */
function hostName(host: string): string {
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
  return name.toLowerCase();
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

/** What every route reads: replaced as a whole when an upload succeeds. */
interface Current {
  store: CallStore;
  span: DateRange | null;
  ai: TakeawayService;
}

const INTERNAL_MESSAGE = 'Something went wrong on the server.';

export function createApp(store: CallStore, options: AppOptions = {}): Hono {
  const app = new Hono();
  // The data, its span and the takeaway service live in one slot that every handler reads once, at request time,
  // so a successful upload can replace all three at once without disturbing a request already running.
  const current: Current = { store, span: dataSpan(store.calls), ai: options.ai ?? offService() };

  const errorResponse = (c: Context, error: ApiError) => c.json({ error }, statusFor(error.code));

  /**
   * For the paid routes: a page on another site can make the browser send a GET here. Browsers say where a
   * request came from in Sec-Fetch-Site; anything but same-origin or none is refused. No header (curl, tests) passes.
   */
  const crossSite = (c: Context): Response | null => {
    const site = c.req.header('Sec-Fetch-Site');
    if (site === undefined || site === 'same-origin' || site === 'none') return null;
    return errorResponse(c, { code: 'forbidden', message: 'Cross-site requests are not allowed.' });
  };

  /**
   * For the upload routes, on top of crossSite: a DNS-rebinding page is "same-origin" with 127.0.0.1 and a
   * multipart POST needs no CORS check, so the Host must be one of ours and an Origin, when sent, must match the Host.
   * A missing Host (the in-process tests; every real HTTP/1.1 client sends one) passes.
   */
  const allowedHosts = [...LOCAL_HOSTS, ...(options.allowedHosts ?? []).map((h) => h.toLowerCase())];
  const uploadGuard = (c: Context): Response | null => {
    const refused = crossSite(c);
    if (refused) return refused;
    const host = c.req.header('Host');
    const origin = c.req.header('Origin');
    let ok = host === undefined || allowedHosts.includes(hostName(host));
    if (ok && origin !== undefined) {
      try {
        ok = host !== undefined && new URL(origin).host.toLowerCase() === host.toLowerCase();
      } catch {
        ok = false;
      }
    }
    return ok ? null : errorResponse(c, { code: 'forbidden', message: 'Cross-site requests are not allowed.' });
  };

  /** Parse the query the way `name`'s view does; the caller gets the parsed query or the error response to return. */
  const parseFor = (c: Context, name: ViewName): Parsed<ViewQuery> =>
    parseViewQuery(current.store, current.span, c.req.queries(), VIEW_TABLE[name].wants);

  const metaOf = (): Meta => {
    const { store, span, ai } = current;
    return {
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
  };
  app.get('/api/meta', (c) => c.json(metaOf()));

  /** One route per view: parse, map a parse error to its JSON response, build, return the builder's output untouched. */
  const route = (name: ViewName) =>
    app.get(`/api/${name}`, (c) => {
      const { store } = current;
      const parsed = parseFor(c, name);
      if (!parsed.ok) return errorResponse(c, parsed.error);
      return c.json(VIEW_TABLE[name].build(store, parsed.value));
    });
  const viewNames = Object.keys(VIEW_TABLE) as ViewName[];
  for (const name of viewNames) route(name);

  // Code only: the filter comes from the URL, and the AI service is never touched.
  app.get('/api/answer', (c) => {
    const { store, span } = current;
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
    const refused = crossSite(c);
    if (refused) return refused;
    const { store, span, ai } = current;
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
    const result = await ai.interpret(q, questionContext(store, span), (reply) => replyToQuery(store, span, reply, q));
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
    const { store, ai } = current;
    const response: DataNotesResponse = { dataNotes: store.dataNotes, ai: ai.status() };
    return c.json(response);
  });

  app.get('/api/takeaway/:view', async (c) => {
    const refused = crossSite(c);
    if (refused) return refused;
    const { store, ai } = current;
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
    const { store } = current;
    const parsed = parseFor(c, 'missed-calls');
    if (!parsed.ok) return errorResponse(c, parsed.error);
    const view = VIEW_TABLE['missed-calls'].build(store, parsed.value);
    // The file name holds dates only, so it can't carry text from the URL.
    return c.body(`\uFEFF${callbacksToCsv(view.callbacks.rows)}`, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="callbacks-${view.range.start}-to-${view.range.end}.csv"`,
    });
  });

  mountUploadRoutes(app, {
    uploads: options.uploads,
    crossSite: uploadGuard,
    meta: metaOf,
    adopt: (store) => {
      // Build everything first, then assign all three together: a failure leaves nothing half swapped.
      // If the AI service cannot be rebuilt the rows are already committed, so the new data is adopted with AI
      // off (template text only). The old service is never kept: it holds the old data's names and snapshot.
      let ai = current.ai;
      let warning: string | undefined;
      if (options.rebuildAi) {
        try {
          ai = options.rebuildAi(store);
        } catch {
          console.error('The AI service could not be rebuilt after an upload; AI is off until the server restarts.');
          ai = offService();
          warning = 'The rows were saved, but AI could not be set up for the new data, so AI is off until the server restarts.';
        }
      }
      current.store = store;
      current.span = dataSpan(store.calls);
      current.ai = ai;
      return { meta: metaOf(), warning };
    },
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
