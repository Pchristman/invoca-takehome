import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveRange } from '../../src/core/ranges';
import { buildCampaigns, buildLocations, buildMissedCalls, buildOverview } from '../../src/core/views';
import { createApp } from '../../src/server/app';
import { callAt, campaign, makeStore, office } from '../core/views/fixtures';
import { get, serverFixture } from './helpers';

const store = serverFixture();
const app = createApp(store);

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const body = (json: unknown): Body => json as Body;

const VIEWS = ['overview', 'campaigns', 'locations', 'missed-calls'] as const;
const AI_OFF = { status: 'off', spendUsd: 0, cacheHits: 0, checkerFailures: 0 };

afterEach(() => {
  vi.unstubAllEnvs();
});

function rangeFor(preset: 'last7' | 'last28' | 'all') {
  const resolved = resolveRange({ start: '2026-09-01', end: '2026-09-14' }, { kind: 'preset', preset });
  if (!resolved.ok) throw new Error('fixture range');
  return resolved.range;
}

const sentenceFor = (name: (typeof VIEWS)[number], preset: 'last7' | 'last28' | 'all', option?: string): string => {
  const range = rangeFor(preset);
  switch (name) {
    case 'overview':
      return buildOverview(store, range).templateSentence;
    case 'campaigns':
      return buildCampaigns(store, range, undefined, {}).templateSentence;
    case 'locations':
      return buildLocations(store, range).templateSentence;
    case 'missed-calls':
      return buildMissedCalls(store, range, undefined, { locationId: option }).templateSentence;
  }
};

describe('data notes', () => {
  it('passes the store notes through and reports AI off', async () => {
    const notesStore = makeStore([callAt('2026-09-01T16:00:00Z', { campaignId: null, locationId: 'loc_a' })], {
      locations: [office('loc_a', 'Office A')],
      dataNotes: { badRows: 12, duplicateRowsCollapsed: 7 },
    });
    const r = await get(createApp(notesStore), '/api/data-notes');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ dataNotes: JSON.parse(JSON.stringify(notesStore.dataNotes)), ai: AI_OFF });
    expect(body(r.json).dataNotes).toMatchObject({ badRows: 12, duplicateRowsCollapsed: 7 });
  });

  it('answers with or without the dev parameter', async () => {
    const plain = await get(app, '/api/data-notes');
    const dev = await get(app, '/api/data-notes?dev');
    expect(plain.status).toBe(200);
    expect(dev.status).toBe(200);
    expect(dev.json).toEqual(plain.json);
  });
});

describe('takeaway', () => {
  it.each(VIEWS)('%s: the template sentence', async (name) => {
    const r = await get(app, `/api/takeaway/${name}`);
    expect(r.status).toBe(200);
    const b = body(r.json);
    expect(b).toEqual({ view: name, text: sentenceFor(name, 'last28'), source: 'template', reason: 'ai_off' });
    expect(b.text).not.toMatch(/[{}]/);
  });

  it('follows the query', async () => {
    const overview = body((await get(app, '/api/takeaway/overview?range=last7')).json);
    expect(overview.text).toBe(sentenceFor('overview', 'last7'));

    const missed = body((await get(app, '/api/takeaway/missed-calls?location=loc_a')).json);
    expect(missed.text).toBe(sentenceFor('missed-calls', 'last28', 'loc_a'));
  });

  it('rejects bad queries the way the views do', async () => {
    const unknown = await get(app, '/api/takeaway/campaigns?campaign=nope');
    expect(unknown.status).toBe(400);
    expect(body(unknown.json).error.code).toBe('unknown_campaign');

    const bad = await get(app, '/api/takeaway/overview?range=bad');
    expect(bad.status).toBe(400);
  });

  it('is 409 for an empty export', async () => {
    const r = await get(createApp(makeStore([])), '/api/takeaway/overview');
    expect(r.status).toBe(409);
    expect(body(r.json).error.code).toBe('no_data');
  });

  it('an unknown view is 400 and the message lists the four names', async () => {
    const r = await get(app, '/api/takeaway/nope');
    expect(r.status).toBe(400);
    const e = body(r.json).error;
    expect(e.code).toBe('unknown_view');
    for (const name of VIEWS) expect(e.message).toContain(name);
  });

  it('a key in the environment changes nothing', async () => {
    const before = await get(app, '/api/takeaway/overview');
    const notesBefore = await get(app, '/api/data-notes');
    vi.stubEnv('ANTHROPIC_API_KEY', 'not-a-real-key');
    const after = await get(app, '/api/takeaway/overview');
    const notesAfter = await get(app, '/api/data-notes');
    expect(after.json).toEqual(before.json);
    expect(body(after.json).source).toBe('template');
    expect(notesAfter.json).toEqual(notesBefore.json);
    expect(body(notesAfter.json).ai.status).toBe('off');
  });
});

const CSV_HEADER = 'caller_hash,unanswered_attempts,last_attempt_local,office,campaign,tracking_number,estimated_value_usd';
const CSV_PATH = '/api/missed-calls/callbacks.csv';

/** The raw body as text. Response.text() drops a leading BOM, so read the bytes and keep it. */
async function rawText(target: ReturnType<typeof createApp>, path: string): Promise<string> {
  const response = await target.request(path);
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer());
}

/** The CSV text without its BOM, split into lines (the trailing CRLF leaves no empty last line). */
function csvLines(text: string): string[] {
  const lines = text.replace(/^\uFEFF/, '').split('\r\n');
  expect(lines.pop()).toBe('');
  return lines;
}

describe('callbacks CSV', () => {
  it('sends a spreadsheet-friendly download', async () => {
    const r = await get(app, `${CSV_PATH}?range=last7`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('content-disposition')).toBe(
      'attachment; filename="callbacks-2026-09-08-to-2026-09-14.csv"',
    );
  });

  it('has a BOM, the header, CRLF lines and the same rows as the JSON', async () => {
    const text = await rawText(app, `${CSV_PATH}?range=last7`);
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    const lines = csvLines(text);
    expect(lines[0]).toBe(CSV_HEADER);
    const view = body((await get(app, '/api/missed-calls?range=last7')).json);
    expect(lines.length - 1).toBe(view.callbacks.rows.length);
    expect(lines.length - 1).toBe(7);
    expect(lines[1]!.split(',')[0]).toBe(view.callbacks.rows[0].callerHash);
  });

  it('follows the office filter', async () => {
    const b = csvLines((await get(app, `${CSV_PATH}?range=all&location=loc_b`)).text);
    expect(b.length - 1).toBe(14);
    const a = await get(app, `${CSV_PATH}?range=all&location=loc_a`);
    expect(a.status).toBe(200);
    expect(csvLines(a.text)).toEqual([CSV_HEADER]);
  });

  it('escapes names from the data', async () => {
    const odd = makeStore(
      [
        callAt('2026-09-01T16:00:00Z', {
          campaignId: 'c1',
          locationId: 'o1',
          answered: false,
          outcome: 'missed',
          callerHash: 'h1',
          trackingNumber: '+1-555-0190',
        }),
        callAt('2026-09-02T16:00:00Z', {
          campaignId: 'c2',
          locationId: 'o1',
          answered: false,
          outcome: 'missed',
          callerHash: 'h2',
        }),
      ],
      {
        campaigns: [campaign('c1', 'Spring, "Big" Sale', 'social', 10), campaign('c2', 'Café 東京', 'social', 10)],
        locations: [office('o1', '=HYPERLINK("x")')],
      },
    );
    const text = await rawText(createApp(odd), `${CSV_PATH}?range=all`);
    expect(text.startsWith('\uFEFF')).toBe(true);
    const lines = csvLines(text);
    const spring = lines.find((l) => l.startsWith('h1,'))!;
    expect(spring).toContain(`"'=HYPERLINK(""x"")"`);
    expect(spring).toContain('"Spring, ""Big"" Sale"');
    expect(spring).toContain(',+1-555-0190,');
    expect(lines.find((l) => l.startsWith('h2,'))).toContain(',Café 東京,');
  });

  it('errors are JSON, not CSV', async () => {
    const outside = await get(app, `${CSV_PATH}?start=2027-01-01&end=2027-01-31`);
    expect(outside.status).toBe(400);
    expect(outside.headers.get('content-type')).toContain('application/json');
    expect(body(outside.json).error.code).toBe('outside_data');

    const unknown = await get(app, `${CSV_PATH}?location=nope`);
    expect(unknown.status).toBe(400);
    expect(body(unknown.json).error.code).toBe('unknown_location');

    const empty = await get(createApp(makeStore([])), CSV_PATH);
    expect(empty.status).toBe(409);
    expect(body(empty.json).error.code).toBe('no_data');
  });

  it('agrees with the JSON on callers and total value', async () => {
    const lines = csvLines((await get(app, `${CSV_PATH}?range=all`)).text);
    const view = body((await get(app, '/api/missed-calls?range=all')).json);
    const hashes = new Set<string>(view.callbacks.rows.map((x: Body) => x.callerHash));
    let cents = 0;
    for (const line of lines.slice(1)) {
      const cells = line.split(',');
      expect(hashes.has(cells[0]!)).toBe(true);
      cents += Math.round(Number(cells[cells.length - 1]) * 100);
    }
    expect(cents).toBe(Math.round(view.callbacks.totalValueUsd * 100));
  });
});

describe('GET /api/campaigns alerts', () => {
  it('last7 is checked and flags nothing when each campaign has 7 calls against 7', async () => {
    const view = body((await get(app, '/api/campaigns?range=last7')).json);
    expect(view.alerts).toEqual({ checked: true, reason: null, flagged: 0, z: 3, minCalls: 20 });
    for (const r of view.rows) {
      expect(r.previousCalls).toBe(7);
      expect(r.alert).toBeNull();
    }
  });

  it('all has no previous period, so it is not checked', async () => {
    const view = body((await get(app, '/api/campaigns?range=all')).json);
    expect(view.alerts.checked).toBe(false);
    expect(view.alerts.reason.startsWith('No full previous period')).toBe(true);
  });
});
