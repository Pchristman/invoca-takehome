import { Hono } from 'hono';
import type { Context } from 'hono';
import { dataSpan } from '../core/ranges';
import type { DateRange } from '../core/ranges';
import type { CallStore } from '../core/types';
import { buildCampaigns, buildLocations, buildMissedCalls, buildOverview } from '../core/views';
import type { ViewName } from '../core/views';
import { DEFAULT_PRESET, PRESETS, statusFor } from './api';
import type { AiStatus, ApiError, DataNotesResponse, Meta, TakeawayResponse } from './api';
import { callbacksToCsv } from './csv';
import { parseViewQuery } from './params';
import { serveWebApp } from './staticFiles';
import type { Parsed, ViewQuery, ViewQueryWants } from './params';

export interface AppOptions {
  /** The built web app's folder (defaults to Vite's output folder). */
  webRoot?: string;
}

/** What each view needs from the URL and how to build it. The view routes (and the takeaway route) all read this one table. */
export interface ViewSpec {
  wants: ViewQueryWants;
  build: (store: CallStore, query: ViewQuery) => { view: ViewName; templateSentence: string };
}

export const VIEW_TABLE: Record<ViewName, ViewSpec> = {
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
};

const AI_OFF: AiStatus = { status: 'off', spendUsd: 0, cacheHits: 0, checkerFailures: 0 };

const INTERNAL_MESSAGE = 'Something went wrong on the server.';

export function createApp(store: CallStore, options: AppOptions = {}): Hono {
  const app = new Hono();
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

  app.get('/api/data-notes', (c) => {
    const response: DataNotesResponse = { dataNotes: store.dataNotes, ai: AI_OFF };
    return c.json(response);
  });

  app.get('/api/takeaway/:view', (c) => {
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
    const response: TakeawayResponse = { view: name, text: view.templateSentence, source: 'template', reason: 'ai_off' };
    return c.json(response);
  });

  app.get('/api/missed-calls/callbacks.csv', (c) => {
    const parsed = parseFor(c, 'missed-calls');
    if (!parsed.ok) return errorResponse(c, parsed.error);
    const { range, previous, locationId } = parsed.value;
    const view = buildMissedCalls(store, range, previous, { locationId });
    // The file name holds dates only, so it can't carry text from the URL.
    return c.body(`﻿${callbacksToCsv(view.callbacks.rows)}`, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="callbacks-${view.range.start}-to-${view.range.end}.csv"`,
    });
  });

  // Last, and never for the API: an unknown /api/ path must stay a JSON 404, not the app.
  const webApp = serveWebApp(options.webRoot ?? 'dist');
  app.use('*', async (c, next) => (c.req.path.startsWith('/api/') ? next() : webApp(c, next)));

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
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
