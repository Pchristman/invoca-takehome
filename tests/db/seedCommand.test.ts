import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSeed } from '../../src/db/seedCommand';
import { start, type RunningServer } from '../../src/server/start';
import { tempDir } from '../server/helpers';
import { callLine, csvTexts } from './helpers';

// start() must not read the real .env when no data folder is given.
vi.mock('../../src/node/env', () => ({ loadDotEnv: vi.fn() }));

const running: RunningServer[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of running.splice(0)) await server.close().catch(() => undefined);
});

function folder(calls: string[]): string {
  const texts = csvTexts({ calls });
  const dir = join(tempDir(), 'data');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'calls.csv'), texts.calls);
  writeFileSync(join(dir, 'campaigns.csv'), texts.campaigns);
  writeFileSync(join(dir, 'locations.csv'), texts.locations);
  return dir;
}

const six = [
  ...[1, 2, 3, 4].map((n) => callLine({ call_id: `c_${n}`, started_at: `2026-09-0${n}T16:00:00Z`, updated_at: `2026-09-0${n}T16:05:00Z` })),
  callLine({ call_id: 'c_bad', location_id: 'loc_nope' }),
  callLine({ call_id: 'c_1', answered: 'true', outcome: 'booked', revenue_usd: '10', updated_at: '2026-09-05T10:00:00Z' }),
];

describe('runSeed', () => {
  it('the first seed reports every row as new and the second as already stored', () => {
    const dir = folder(six);
    const file = join(tempDir(), 'calls.db');
    const env = { DB_PATH: file };
    const first = runSeed([dir], env);
    expect(first.exitCode).toBe(0);
    expect(first.lines).toEqual([
      `Seeded ${file} from ${dir} (seed #1).`,
      '6 rows read: 6 new, 0 already stored, 0 new versions of existing calls, 1 bad.',
      '4 calls in the database.',
      'A running server keeps the data it started with; restart it to see this.',
    ]);
    const second = runSeed([dir], env);
    expect(second.lines[0]).toBe(`Seeded ${file} from ${dir} (seed #2).`);
    expect(second.lines[1]).toBe('6 rows read: 0 new, 6 already stored, 0 new versions of existing calls, 0 bad.');
    expect(second.lines[2]).toBe('4 calls in the database.');
  });

  it('a newer export reports new versions and the database has them', async () => {
    const file = join(tempDir(), 'calls.db');
    runSeed([folder(six)], { DB_PATH: file });
    const newer = [...six, callLine({ call_id: 'c_2', answered: 'true', outcome: 'booked', revenue_usd: '30', updated_at: '2026-09-06T10:00:00Z' }), callLine({ call_id: 'c_9' })];
    const result = runSeed([folder(newer)], { DB_PATH: file });
    expect(result.lines[1]).toBe('8 rows read: 2 new, 6 already stored, 1 new versions of existing calls, 0 bad.');
    expect(result.lines[2]).toBe('5 calls in the database.');
  });

  it('seeding while a server holds its snapshot leaves that server alone; the next start sees the new call', async () => {
    const file = join(tempDir(), 'calls.db');
    const server = await start({ dbPath: file, dataDir: folder([callLine({ call_id: 'c_1' })]), port: 0 });
    running.push(server);
    const callCount = async (s: RunningServer) => ((await (await fetch(`${s.url}/api/meta`)).json()) as { callCount: number }).callCount;
    expect(await callCount(server)).toBe(1);

    const result = runSeed([folder([callLine({ call_id: 'c_1' }), callLine({ call_id: 'c_2' })])], { DB_PATH: file });
    expect(result.exitCode).toBe(0);
    expect(await callCount(server)).toBe(1);

    vi.stubEnv('DATA_DIR', join(tempDir(), 'nowhere'));
    const next = await start({ dbPath: file, port: 0 });
    running.push(next);
    expect(await callCount(next)).toBe(2);
  });

  it('DB_PATH=:memory: is refused with exit code 1', () => {
    const result = runSeed([folder(six)], { DB_PATH: ':memory:' });
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(['Cannot seed: DB_PATH is :memory:, so there is no file to seed. Set DB_PATH to a file.']);
  });

  it('a missing data folder is one Cannot seed line, exit 1, and no file created', () => {
    const file = join(tempDir(), 'calls.db');
    const result = runSeed([join(tempDir(), 'nowhere')], { DB_PATH: file });
    expect(result.exitCode).toBe(1);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(/^Cannot seed: Data folder not found/);
    expect(existsSync(file)).toBe(false);
  });

  it('a bad CSV on a re-seed leaves the existing file byte-for-byte unchanged', () => {
    const file = join(tempDir(), 'calls.db');
    runSeed([folder(six)], { DB_PATH: file });
    const before = readFileSync(file);
    const broken = folder(six);
    writeFileSync(join(broken, 'calls.csv'), 'call_id,started_at\nc_1,2026-09-01T00:00:00Z\n');
    const result = runSeed([broken], { DB_PATH: file });
    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toMatch(/^Cannot seed: /);
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it('a bad CSV on a first seed leaves no file behind', () => {
    const file = join(tempDir(), 'calls.db');
    const broken = folder(six);
    writeFileSync(join(broken, 'calls.csv'), 'call_id,started_at\nc_1,2026-09-01T00:00:00Z\n');
    expect(runSeed([broken], { DB_PATH: file }).exitCode).toBe(1);
    expect(existsSync(file)).toBe(false);
  });

  it('a corrupt database file is a Cannot seed line and is not modified', () => {
    const file = join(tempDir(), 'calls.db');
    writeFileSync(file, 'this is not a database');
    const result = runSeed([folder(six)], { DB_PATH: file });
    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toMatch(/^Cannot seed: .*not a valid SQLite/);
    expect(readFileSync(file, 'utf8')).toBe('this is not a database');
  });

  it('the folder argument beats DATA_DIR', () => {
    const file = join(tempDir(), 'calls.db');
    const chosen = folder([callLine({ call_id: 'c_1' })]);
    const ignored = folder([callLine({ call_id: 'c_1' }), callLine({ call_id: 'c_2' })]);
    const result = runSeed(['--quiet', chosen], { DB_PATH: file, DATA_DIR: ignored });
    expect(result.lines[0]).toContain(chosen);
    expect(result.lines[2]).toBe('1 calls in the database.');
  });

  it('with no argument it uses DATA_DIR', () => {
    const file = join(tempDir(), 'calls.db');
    const dir = folder([callLine({ call_id: 'c_1' })]);
    expect(runSeed([], { DB_PATH: file, DATA_DIR: dir }).lines[0]).toContain(dir);
  });
});

describe('runSeed against a locked file', () => {
  it('says the database is in use, not the raw "database is locked"', () => {
    const file = join(tempDir(), 'calls.db');
    expect(runSeed([folder([callLine()])], { DB_PATH: file }).exitCode).toBe(0);
    const holder = new DatabaseSync(file);
    holder.exec('BEGIN EXCLUSIVE');
    try {
      const result = runSeed([folder([callLine({ call_id: 'c_2' })])], { DB_PATH: file });
      expect(result.lines[0]).toMatch(/^Cannot seed: The database .* is in use by another process/);
    } finally {
      holder.exec('ROLLBACK');
      holder.close();
    }
  }, 20_000);
});
