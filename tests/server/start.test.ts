import { copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoadError } from '../../src/core/errors';
import { ConfigError, parsePort } from '../../src/server/config';
import { start } from '../../src/server/start';
import type { RunningServer } from '../../src/server/start';
import { loadDotEnv } from '../../src/node/env';
import { tempDir } from './helpers';

// start() must not read a .env file: only the npm start entry does. The spy keeps this test off the real .env.
vi.mock('../../src/node/env', () => ({ loadDotEnv: vi.fn() }));

const SHIPPED = 'tests/fixtures/original-export';
const HEADER =
  'call_id,started_at,ended_at,duration_seconds,caller_number_hash,tracking_number,campaign_id,marketing_channel,location_id,answered,outcome,revenue_usd,agent_id,updated_at';

const running: RunningServer[] = [];
const dirs: string[] = [];

async function startServer(dataDir: string, port = 0): Promise<RunningServer> {
  const server = await start({ dataDir, port });
  running.push(server);
  return server;
}

/** A temp export folder: the shipped campaigns and locations plus the given calls.csv text (null = no calls.csv). */
function exportDir(callsCsv: string | null): string {
  const dir = tempDir();
  dirs.push(dir);
  copyFileSync(join(SHIPPED, 'campaigns.csv'), join(dir, 'campaigns.csv'));
  copyFileSync(join(SHIPPED, 'locations.csv'), join(dir, 'locations.csv'));
  if (callsCsv !== null) writeFileSync(join(dir, 'calls.csv'), callsCsv);
  return dir;
}

afterEach(async () => {
  for (const server of running.splice(0)) await server.close().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('start', () => {
  it('serves the shipped export over HTTP', async () => {
    const server = await startServer(SHIPPED);
    expect(server.url.startsWith('http://127.0.0.1:')).toBe(true);
    const response = await fetch(`${server.url}/api/meta`);
    expect(response.status).toBe(200);
    const meta = (await response.json()) as { hasData: boolean; callCount: number };
    expect(meta.hasData).toBe(true);
    expect(meta.callCount).toBe(5000);
  });

  it('listens on loopback only', async () => {
    const server = await startServer(SHIPPED);
    expect(server.host).toBe('127.0.0.1'); // the address the socket really bound, not just the URL text
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    // Not reachable through the IPv6 loopback, which a server on "::" or all interfaces would answer.
    await expect(fetch(`http://[::1]:${server.port}/api/meta`)).rejects.toThrow();
  });

  it('close stops it', async () => {
    const server = await startServer(SHIPPED);
    await server.close();
    await expect(fetch(`${server.url}/api/meta`)).rejects.toThrow();
  });

  it('a missing data folder is a clear LoadError', async () => {
    const error = await start({ dataDir: 'no/such/folder', port: 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoadError);
    expect((error as Error).message).toContain('Data folder not found');
    expect((error as Error).message).toContain('no/such/folder');
  });

  it('a folder without calls.csv names the file', async () => {
    const dir = tempDir();
    dirs.push(dir);
    const error = await start({ dataDir: dir, port: 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoadError);
    expect((error as Error).message).toContain('calls.csv');
  });

  it('a missing column names the file and column', async () => {
    const dir = exportDir(HEADER.replace('started_at,', '') + '\n');
    const error = await start({ dataDir: dir, port: 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoadError);
    expect((error as Error).message).toContain('calls.csv');
    expect((error as Error).message).toContain('started_at');
  });

  it('an empty export starts and says so', async () => {
    const server = await startServer(exportDir(HEADER + '\n'));
    const meta = (await (await fetch(`${server.url}/api/meta`)).json()) as {
      hasData: boolean;
      notes: string[];
    };
    expect(meta.hasData).toBe(false);
    expect(meta.notes.join(' ')).toMatch(/calls\.csv is empty/);
    const overview = await fetch(`${server.url}/api/overview`);
    expect(overview.status).toBe(409);
    const body = (await overview.json()) as { error: { code: string } };
    expect(body.error.code).toBe('no_data');
  });

  it('a busy port is a clear ConfigError', async () => {
    const first = await startServer(SHIPPED);
    const error = await start({ dataDir: SHIPPED, port: first.port }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toContain('already in use');
    expect((error as Error).message).toContain(String(first.port));
  });

  it('bad rows do not stop startup', async () => {
    const stamp = '2026-09-01T00:39:12Z';
    const rows = [
      `c_1,${stamp},${stamp},16,h_1,+1-555-0100,cmp_01,paid_search,loc_08,false,missed,,,${stamp}`,
      `c_2,${stamp},${stamp},16,h_2,+1-555-0100,cmp_01,paid_search,loc_nope,false,missed,,,${stamp}`,
    ];
    const server = await startServer(exportDir([HEADER, ...rows].join('\n') + '\n'));
    const meta = (await (await fetch(`${server.url}/api/meta`)).json()) as {
      skippedRows: number;
      callCount: number;
    };
    expect(meta.skippedRows).toBe(1);
    expect(meta.callCount).toBe(1);
  });
});

describe('parsePort', () => {
  it.each([undefined, '', '  '])('%j gives the default 3000', (value) => {
    expect(parsePort(value)).toBe(3000);
  });

  it.each([
    ['8080', 8080],
    ['1', 1],
    ['65535', 65535],
  ])('accepts %s', (value, expected) => {
    expect(parsePort(value)).toBe(expected);
  });

  it.each(['abc', '0', '65536', '3000.5', '-1', '80 80', '0x50'])('rejects %j', (value) => {
    expect(() => parsePort(value)).toThrow(ConfigError);
    expect(() => parsePort(value)).toThrow(/PORT/);
  });

  it('shortens a very long value in the message', () => {
    expect(() => parsePort('x'.repeat(5000))).toThrow(ConfigError);
    try {
      parsePort('x'.repeat(5000));
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(300);
    }
  });
});

describe('start and .env', () => {
  it('does not read a .env file (the npm start entry does that)', async () => {
    await startServer(SHIPPED);
    expect(loadDotEnv).not.toHaveBeenCalled();
  });
});
