import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { dataSpan, resolveRange } from '../../src/core/ranges';
import { readExportFromDir } from '../../src/node/readDataDir';
import { buildCampaigns, buildLocations, buildMissedCalls, buildOverview } from '../../src/core/views';
import { start } from '../../src/server/start';
import type { RunningServer } from '../../src/server/start';

const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'original-export');

const store = cleanExport(readExportFromDir(FIXTURE_DIR));
const allResult = resolveRange(dataSpan(store.calls)!, { kind: 'preset', preset: 'all' });
if (!allResult.ok) throw new Error(allResult.error.message);
const all = allResult.range;

let server: RunningServer;
beforeAll(async () => {
  server = await start({ dataDir: FIXTURE_DIR, port: 0 });
});
afterAll(async () => {
  await server.close();
});

// The tests only read what they ask about, so the body is untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJson(path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${server.url}${path}`);
  return { status: response.status, body: await response.json() };
}

describe('shipped export over HTTP', () => {
  it('meta', async () => {
    const { status, body } = await getJson('/api/meta');
    expect(status).toBe(200);
    expect(body.hasData).toBe(true);
    expect(body.callCount).toBe(5000);
    expect(body.span.start < body.span.end).toBe(true);
    expect(body.campaigns).toHaveLength(12);
    expect(body.locations).toHaveLength(8);
  });

  it('every view answers on the default range', async () => {
    for (const path of ['/api/overview', '/api/campaigns', '/api/locations', '/api/missed-calls']) {
      const { status, body } = await getJson(path);
      expect([path, status]).toEqual([path, 200]);
      expect([path, body.notes.comparison.available]).toEqual([path, true]);
    }
  });

  it('overview totals match the known export', async () => {
    const { body } = await getJson('/api/overview?range=all');
    expect(body.tiles.calls.current).toBe(5000);
    expect(body.tiles.bookings.current).toBe(1204);
    expect(body.tiles.revenueUsd.current).toBe(432894);
    expect(body.tiles.uniqueCallers.current).toBe(2040);
    for (const tile of Object.values<{ change: { kind: string } }>(body.tiles)) expect(tile.change.kind).toBe('none');
  });

  it('the server returns what the builder builds', async () => {
    const builds = {
      '/api/overview': buildOverview(store, all),
      '/api/campaigns': buildCampaigns(store, all),
      '/api/locations': buildLocations(store, all),
      '/api/missed-calls': buildMissedCalls(store, all),
    };
    for (const [path, built] of Object.entries(builds)) {
      const { body } = await getJson(`${path}?range=all`);
      expect([path, body]).toEqual([path, JSON.parse(JSON.stringify(built))]);
    }
  });

  it('campaigns keep their unattributed row', async () => {
    const { body } = await getJson('/api/campaigns?range=all');
    expect(body.unattributed.calls).toBe(144);
  });

  it('locations: nothing stands out', async () => {
    const { body } = await getJson('/api/locations?range=all');
    expect(body.actions[0].kind).toBe('no_office_stands_out');
  });

  it('missed calls: 1055 unanswered', async () => {
    const { body } = await getJson('/api/missed-calls?range=all');
    expect(body.unansweredCalls).toBe(1055);
  });

  it('the callback CSV matches the view', async () => {
    const { body } = await getJson('/api/missed-calls?range=all');
    const response = await fetch(`${server.url}/api/missed-calls/callbacks.csv?range=all`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder('utf-8', { ignoreBOM: true })
      .decode(bytes)
      .slice(1)
      .split('\r\n');
    // Every line, the last included, ends CRLF, so splitting on CRLF leaves one empty piece at the end.
    expect(lines.pop()).toBe('');
    expect(lines.some((line) => line.includes('\n') || line.includes('\r'))).toBe(false);
    expect(lines[0]).toBe(
      'caller_hash,unanswered_attempts,last_attempt_local,office,campaign,tracking_number,estimated_value_usd',
    );
    expect(lines.length - 1).toBe(body.callbacks.rows.length);
  });

  it('a takeaway for each view', async () => {
    for (const view of ['overview', 'campaigns', 'locations', 'missed-calls']) {
      const { status, body } = await getJson(`/api/takeaway/${view}`);
      expect([view, status]).toEqual([view, 200]);
      expect(body.source).toBe('template');
      expect(body.text.length).toBeGreaterThan(0);
    }
  });

  it('bad input never reaches a builder', async () => {
    const bad = await getJson('/api/overview?start=nope&end=2026-09-05');
    expect(bad.status).toBe(400);
    expect((await getJson('/api/meta')).status).toBe(200);
  });
});
