import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type { CallStore, CleanCall } from '../../src/core/types';
import { callAt, campaign, makeStore, office } from '../core/views/fixtures';

/**
 * Two campaigns, two offices, 14 days. Each day: one answered, booked, $100 call
 * (Alpha, Office A) and one unanswered missed call (Beta, Office B). 28 calls.
 */
export function serverFixture(): CallStore {
  const calls: CleanCall[] = [];
  for (let day = 1; day <= 14; day++) {
    const date = `2026-09-${String(day).padStart(2, '0')}`;
    calls.push(
      callAt(`${date}T16:00:00Z`, {
        campaignId: 'cmp_a',
        channel: 'social',
        locationId: 'loc_a',
        answered: true,
        outcome: 'booked',
        booked: true,
        revenueUsd: 100,
        callerHash: `ok${day}`,
      }),
      callAt(`${date}T17:00:00Z`, {
        campaignId: 'cmp_b',
        channel: 'display',
        locationId: 'loc_b',
        answered: false,
        outcome: 'missed',
        booked: false,
        revenueUsd: 0,
        callerHash: `miss${day}`,
      }),
    );
  }
  return makeStore(calls, {
    campaigns: [campaign('cmp_a', 'Alpha', 'social', 10), campaign('cmp_b', 'Beta', 'display', 20)],
    locations: [office('loc_a', 'Office A', 'America/Phoenix'), office('loc_b', 'Office B', 'America/Denver')],
  });
}

/** Call the app in-process and read the body both as text and (when it parses) as JSON. */
export async function get(
  app: Hono,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; headers: Headers; text: string; json: unknown }> {
  const response = await app.request(path, init);
  const text = await response.text();
  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON (a CSV or a web page): leave json undefined
  }
  return { status: response.status, headers: response.headers, text, json };
}

/** A fresh folder under .cache/ (gitignored). The caller removes it. */
export function tempDir(): string {
  mkdirSync('.cache', { recursive: true });
  return mkdtempSync(join('.cache', 'server-test-'));
}
