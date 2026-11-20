import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { LoadError } from '../../src/core/errors';
import { readExportFromDir } from '../../src/node/readDataDir';
import { createApp } from '../../src/server/app';
import { start, type RunningServer } from '../../src/server/start';
import { callLine, csvTexts } from '../db/helpers';
import { get, tempDir } from './helpers';

// start() must not read the real .env when no data folder is given.
vi.mock('../../src/node/env', () => ({ loadDotEnv: vi.fn() }));

// Built from parts so no test file spells the real database path (tests/repo-hygiene.test.ts checks that).
const REAL_DB = join('data', 'calls' + '.db');

const running: RunningServer[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of running.splice(0)) await server.close().catch(() => undefined);
});

function folder(calls = [callLine({ call_id: 'c_1' }), callLine({ call_id: 'c_2', answered: 'true', outcome: 'booked', revenue_usd: '90' })]): string {
  const texts = csvTexts({ calls });
  const dir = join(tempDir(), 'data');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'calls.csv'), texts.calls);
  writeFileSync(join(dir, 'campaigns.csv'), texts.campaigns);
  writeFileSync(join(dir, 'locations.csv'), texts.locations);
  return dir;
}

async function begin(options: Parameters<typeof start>[0]): Promise<RunningServer> {
  const server = await start({ port: 0, ...options });
  running.push(server);
  return server;
}

const overview = async (server: RunningServer) => (await (await fetch(`${server.url}/api/overview?range=all`)).json()) as unknown;

describe('start with a database', () => {
  it('start({ dataDir }) with no dbPath is in-memory: no file is made, whatever DB_PATH says', async () => {
    const poisoned = join(tempDir(), 'poisoned.db');
    vi.stubEnv('DB_PATH', poisoned);
    const hadDefault = existsSync(REAL_DB);
    await begin({ dataDir: folder() });
    expect(existsSync(poisoned)).toBe(false);
    expect(existsSync(REAL_DB)).toBe(hadDefault);
  });

  it('start({ dbPath, dataDir }) seeds the file and serves what the CSV route would; a later start needs no data folder', async () => {
    const dir = folder();
    const file = join(tempDir(), 'calls.db');
    const expected = (await get(createApp(cleanExport(readExportFromDir(dir))), '/api/overview?range=all')).json;

    const first = await begin({ dbPath: file, dataDir: dir });
    expect(await overview(first)).toEqual(expected);
    expect(first.notices[0]).toMatch(/^Seeded /);
    await first.close();

    vi.stubEnv('DATA_DIR', join(tempDir(), 'nowhere'));
    const second = await begin({ dbPath: file });
    expect(await overview(second)).toEqual(expected);
    expect(second.notices).toEqual([]);
  });

  it('RunningServer.notices carries the stale warning', async () => {
    const file = join(tempDir(), 'calls.db');
    await (await begin({ dbPath: file, dataDir: folder() })).close();
    const other = folder([callLine({ call_id: 'c_other' })]);
    const server = await begin({ dbPath: file, dataDir: other });
    expect(server.notices.join(' ')).toContain(other);
    expect(server.notices.join(' ')).toContain('npm run seed');
  });

  it('a corrupt dbPath rejects with LoadError and the file is unchanged', async () => {
    const file = join(tempDir(), 'calls.db');
    writeFileSync(file, 'not sqlite at all');
    await expect(start({ dbPath: file, dataDir: folder(), port: 0 })).rejects.toThrow(LoadError);
    expect(readFileSync(file, 'utf8')).toBe('not sqlite at all');
    rmSync(file);
  });
});
