import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveRange } from '../../src/core/ranges';
import type { CallStore } from '../../src/core/types';
import { buildCampaigns, buildLocations, buildMissedCalls, buildOverview } from '../../src/core/views';
import { createApp } from '../../src/server/app';
import { makeStore } from '../core/views/fixtures';
import { get, serverFixture } from './helpers';

const store = serverFixture();
const app = createApp(store);

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const body = (json: unknown): Body => json as Body;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('meta', () => {
  it('describes the data', async () => {
    const r = await get(app, '/api/meta');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(r.json).toEqual({
      hasData: true,
      callCount: 28,
      span: { start: '2026-09-01', end: '2026-09-14' },
      campaigns: [
        { id: 'cmp_a', name: 'Alpha' },
        { id: 'cmp_b', name: 'Beta' },
      ],
      locations: [
        { id: 'loc_a', name: 'Office A' },
        { id: 'loc_b', name: 'Office B' },
      ],
      presets: ['last7', 'last28', 'all'],
      defaultPreset: 'last28',
      skippedRows: store.dataNotes.badRows,
      notes: store.dataNotes.notes,
      aiStatus: 'off',
    });
  });
});

const VIEWS = ['overview', 'campaigns', 'locations', 'missed-calls'] as const;

describe('the four views', () => {
  it.each(VIEWS)('%s answers 200 with its own name', async (name) => {
    const r = await get(app, `/api/${name}`);
    expect(r.status).toBe(200);
    const b = body(r.json);
    expect(b.view).toBe(name);
    expect(b.actions.length).toBeGreaterThan(0);
    expect(b.factSheet).toBeDefined();
    expect(b.notes).toBeDefined();
  });

  it.each(VIEWS)('%s body is exactly the builder output', async (name) => {
    const resolved = resolveRange({ start: '2026-09-01', end: '2026-09-14' }, { kind: 'preset', preset: 'last7' });
    if (!resolved.ok) throw new Error('fixture range');
    const range = resolved.range;
    const build = {
      overview: () => buildOverview(store, range),
      campaigns: () => buildCampaigns(store, range, undefined, {}),
      locations: () => buildLocations(store, range),
      'missed-calls': () => buildMissedCalls(store, range, undefined, {}),
    }[name];
    const r = await get(app, `/api/${name}?range=last7`);
    expect(r.json).toEqual(JSON.parse(JSON.stringify(build())));
  });

  it('no parameters means the last 28 days, clamped to the data', async () => {
    const b = body((await get(app, '/api/overview')).json);
    expect(b.range).toMatchObject({ start: '2026-09-01', end: '2026-09-14', days: 14, clamped: true });
    expect(b.notes.comparison.available).toBe(false);
    expect(b.notes.comparison.reason).toMatch(/^No full previous period/);
  });

  it('last7 compares with the 7 days before', async () => {
    const b = body((await get(app, '/api/overview?range=last7')).json);
    expect(b.notes.comparison.available).toBe(true);
    expect(b.notes.comparison.previous).toMatchObject({ start: '2026-09-01', end: '2026-09-07' });
    expect(b.tiles.calls).toMatchObject({ current: 14, previous: 14 });
  });

  it('a custom range and an explicit comparison', async () => {
    const base = '/api/overview?start=2026-09-08&end=2026-09-10';
    const ok = body((await get(app, `${base}&compareStart=2026-09-01&compareEnd=2026-09-03`)).json);
    expect(ok.notes.comparison.available).toBe(true);

    const shortRes = await get(app, `${base}&compareStart=2026-09-01&compareEnd=2026-09-02`);
    expect(shortRes.status).toBe(200);
    const shortBody = body(shortRes.json);
    expect(shortBody.notes.comparison.available).toBe(true);
    expect(shortBody.notes.comparison.perDay).toBe(true);
    expect(shortBody.notes.comparison.reason).toBeNull();
    // 6 calls in 3 days against 4 in 2: per day that is 2 against 2 (totals would say +50%).
    expect(shortBody.tiles.calls).toEqual({ current: 6, previous: 4, change: { kind: 'percent', value: 0 } });

    const outside = await get(app, `${base}&compareStart=2026-08-01&compareEnd=2026-08-03`);
    expect(outside.status).toBe(200);
    expect(body(outside.json).notes.comparison.available).toBe(false);
  });

  it('Campaigns withholds alerts across lengths and says why', async () => {
    const r = await get(app, '/api/campaigns?start=2026-09-08&end=2026-09-10&compareStart=2026-09-01&compareEnd=2026-09-02');
    expect(r.status).toBe(200);
    const alerts = body(r.json).alerts;
    expect(alerts.checked).toBe(false);
    expect(alerts.reason).toBe('Call-change alerts need two periods of the same length; these are 3 and 2 days.');
  });

  it('a half-filled or inverted comparison range is 400 with the field', async () => {
    const base = '/api/overview?start=2026-09-08&end=2026-09-10';
    const half = await get(app, `${base}&compareStart=2026-09-01`);
    expect(half.status).toBe(400);
    expect(body(half.json).error.code).toBe('bad_param');
    expect(body(half.json).error.field).toBe('compareEnd');

    const inverted = await get(app, `${base}&compareStart=2026-09-05&compareEnd=2026-09-01`);
    expect(inverted.status).toBe(400);
    const e = body(inverted.json).error;
    // checkDates names no field for an inverted pair; the server puts it on compareEnd so the range control shows the message.
    expect(e.code).toBe('start_after_end');
    expect(e.field).toBe('compareEnd');
    expect(e.message).toMatch(/^Comparison range:/);
  });

  it('an inverted main range is 400 with field end', async () => {
    const r = await get(app, '/api/overview?start=2026-09-10&end=2026-09-05');
    expect(r.status).toBe(400);
    const e = body(r.json).error;
    expect(e.code).toBe('start_after_end');
    expect(e.field).toBe('end');
  });

  it('a partial overlap is clamped, not refused', async () => {
    const r = await get(app, '/api/overview?start=2026-09-10&end=2026-09-30');
    expect(r.status).toBe(200);
    expect(body(r.json).range).toMatchObject({ end: '2026-09-14', clamped: true });
  });
});

describe('errors', () => {
  it.each([
    ['?start=2026-09-01', 'bad_param'],
    ['?end=2026-09-05', 'bad_param'],
    ['?start=2026-02-30&end=2026-03-02', 'bad_date'],
    ['?start=banana&end=2026-09-05', 'bad_date'],
    ['?range=last99', 'bad_param'],
    ['?range=last7&start=2026-09-01&end=2026-09-05', 'bad_param'],
    ['?range=last7&range=all', 'bad_param'],
  ])('bad parameters %s are 400 with a message', async (query, code) => {
    const r = await get(app, `/api/overview${query}`);
    expect(r.status).toBe(400);
    expect(r.headers.get('content-type')).toContain('application/json');
    const b = body(r.json);
    expect(b.error.code).toBe(code);
    expect(b.error.message.length).toBeGreaterThan(0);
    expect(b.view).toBeUndefined();
  });

  it('an inverted range is 400', async () => {
    const r = await get(app, '/api/overview?start=2026-09-10&end=2026-09-05');
    expect(r.status).toBe(400);
    const e = body(r.json).error;
    expect(e.code).toBe('start_after_end');
    expect(e.message).toContain('2026-09-10');
    expect(e.message).toContain('2026-09-05');
  });

  it('a range outside the data is 400', async () => {
    const r = await get(app, '/api/overview?start=2027-01-01&end=2027-01-31');
    expect(r.status).toBe(400);
    const e = body(r.json).error;
    expect(e.code).toBe('outside_data');
    expect(e.message).toContain('2026-09-01');
    expect(e.message).toContain('2026-09-14');
  });

  it('an unknown campaign for the weekly chart is 400', async () => {
    const bad = await get(app, '/api/campaigns?campaign=nope');
    expect(bad.status).toBe(400);
    expect(body(bad.json).error.code).toBe('unknown_campaign');

    expect(body((await get(app, '/api/campaigns?campaign=cmp_b')).json).weekly.campaignId).toBe('cmp_b');

    const none = body((await get(app, '/api/campaigns')).json);
    const empty = body((await get(app, '/api/campaigns?campaign=')).json);
    expect(empty).toEqual(none);
    expect((await get(app, '/api/overview?campaign=nope')).status).toBe(200);
  });

  it('an unknown office for the missed-calls filter is 400', async () => {
    const bad = await get(app, '/api/missed-calls?location=nope');
    expect(bad.status).toBe(400);
    expect(body(bad.json).error.code).toBe('unknown_location');

    const ok = await get(app, '/api/missed-calls?location=loc_a');
    expect(ok.status).toBe(200);
    expect(body(ok.json).officeFilter).toEqual({ locationId: 'loc_a', name: 'Office A' });
    expect((await get(app, '/api/locations?location=nope')).status).toBe(200);
  });

  it('error messages stay short and are JSON', async () => {
    const long = await get(app, `/api/overview?range=${'x'.repeat(5000)}`);
    expect(long.status).toBe(400);
    expect(long.headers.get('content-type')).toContain('application/json');
    expect(body(long.json).error.message.length).toBeLessThan(200);

    const script = await get(app, `/api/overview?range=${encodeURIComponent('<script>alert(1)</script>')}`);
    expect(script.status).toBe(400);
    expect(script.headers.get('content-type')).toContain('application/json');
    expect(script.json).toBeDefined();
  });

  it('an unknown API route is a JSON 404, and routes are GET only', async () => {
    const nope = await get(app, '/api/nope');
    expect(nope.status).toBe(404);
    expect(body(nope.json).error.code).toBe('not_found');

    const post = await get(app, '/api/overview', { method: 'POST' });
    expect(post.status).toBe(404);
    expect(body(post.json).error.code).toBe('not_found');
  });
});

describe('an empty export', () => {
  const emptyStore = makeStore([], { dataNotes: { notes: ['calls.csv is empty: nothing to show.'] } });
  const emptyApp = createApp(emptyStore);

  it('meta says there is no data and why', async () => {
    const r = await get(emptyApp, '/api/meta');
    expect(r.status).toBe(200);
    const b = body(r.json);
    expect(b.hasData).toBe(false);
    expect(b.callCount).toBe(0);
    expect(b.span).toBeNull();
    expect(b.notes).toEqual(['calls.csv is empty: nothing to show.']);
  });

  it.each(VIEWS)('%s is 409 no_data', async (name) => {
    const r = await get(emptyApp, `/api/${name}`);
    expect(r.status).toBe(409);
    const e = body(r.json).error;
    expect(e.code).toBe('no_data');
    expect(e.message.length).toBeGreaterThan(0);
  });

  it('a bad parameter is still 400', async () => {
    const r = await get(emptyApp, '/api/overview?range=bad');
    expect(r.status).toBe(400);
    expect(body(r.json).error.code).toBe('bad_param');
  });
});

describe('an unexpected error', () => {
  it('is a generic 500 and the server keeps serving', async () => {
    const real = serverFixture();
    let broken = false;
    const fragile: CallStore = {
      calls: real.calls,
      campaigns: real.campaigns,
      locations: real.locations,
      dataNotes: real.dataNotes,
    };
    Object.defineProperty(fragile, 'campaigns', {
      get() {
        if (broken) throw new Error('boom C:\\secret\\path');
        return real.campaigns;
      },
    });
    const fragileApp = createApp(fragile);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    broken = true;
    const r = await get(fragileApp, '/api/campaigns');
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: { code: 'internal', message: 'Something went wrong on the server.' } });
    expect(r.text).not.toContain('boom');
    expect(r.text).not.toContain('secret');
    expect(spy).toHaveBeenCalledWith(expect.any(Error));

    broken = false;
    expect((await get(fragileApp, '/api/campaigns')).status).toBe(200);
  });
});
