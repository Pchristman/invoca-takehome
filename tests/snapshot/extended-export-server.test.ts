import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start } from '../../src/server/start';
import type { RunningServer } from '../../src/server/start';

import { EXTENDED_TOTALS } from './extendedTotals';

const EXTENDED_DIR = join(__dirname, '..', '..', 'data', 'extended');

let server: RunningServer;
beforeAll(async () => {
  server = await start({ dataDir: EXTENDED_DIR, port: 0 });
});
afterAll(async () => {
  await server.close();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJson(path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${server.url}${path}`);
  return { status: response.status, body: await response.json() };
}

describe('extended export over HTTP', () => {
  it('meta counts every call', async () => {
    const { body } = await getJson('/api/meta');
    expect(body.callCount).toBe(EXTENDED_TOTALS.calls);
  });

  it('locations flags an office to review', async () => {
    const { status, body } = await getJson('/api/locations?range=all');
    expect(status).toBe(200);
    expect(['review_office_answer', 'review_office_booking']).toContain(body.actions[0].kind);
  });

  it("missed calls for one office carry its name and busiest slot", async () => {
    const meta = (await getJson('/api/meta')).body;
    const office = meta.locations.find((l: { id: string }) => l.id === 'loc_06');
    const { status, body } = await getJson('/api/missed-calls?range=all&location=loc_06');
    expect(status).toBe(200);
    expect(body.officeFilter.name).toBe(office.name);
    expect(body.busiestSlot).not.toBeNull();
  });

  it('campaigns: the weekly chart follows the chosen campaign', async () => {
    const { status, body } = await getJson('/api/campaigns?range=last28&campaign=cmp_04');
    expect(status).toBe(200);
    expect(body.weekly.campaignId).toBe('cmp_04');
  });
});
