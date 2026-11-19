import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LoadError } from '../../src/core/errors';
import { readExportFromDir } from '../../src/node/readDataDir';

const HEADER =
  'call_id,started_at,ended_at,duration_seconds,caller_number_hash,tracking_number,campaign_id,marketing_channel,location_id,answered,outcome,revenue_usd,agent_id,updated_at\n';
const CALL = 'c1,2026-03-02T10:00:00Z,2026-03-02T10:01:00Z,60,h1,+1-555-0100,cmp_a,social,loc_1,true,booked,10,agt_1,2026-03-02T10:02:00Z\n';

let dir: string;

function writeExport(target: string, files: string[] = ['calls', 'campaigns', 'locations']) {
  mkdirSync(target, { recursive: true });
  const contents: Record<string, string> = {
    calls: HEADER + CALL,
    campaigns: 'campaign_id,name,channel,daily_budget_usd\ncmp_a,Alpha,social,10\n',
    locations: 'location_id,name,timezone\nloc_1,One,UTC\n',
  };
  for (const name of files) writeFileSync(join(target, `${name}.csv`), contents[name] ?? '');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'invoca-test-'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('readExportFromDir', () => {
  test('reads the three files from an explicit dir', () => {
    writeExport(dir);
    const result = readExportFromDir(dir);
    expect(result.rowsRead).toBe(1);
    expect(result.campaigns).toHaveLength(1);
    expect(result.locations).toHaveLength(1);
  });

  test('a missing directory throws a LoadError naming the path', () => {
    const missing = join(dir, 'nope');
    expect(() => readExportFromDir(missing)).toThrow(LoadError);
    expect(() => readExportFromDir(missing)).toThrow(/nope/);
  });

  test('a missing calls.csv throws a LoadError naming calls.csv', () => {
    writeExport(dir, ['campaigns', 'locations']);
    expect(() => readExportFromDir(dir)).toThrow(LoadError);
    expect(() => readExportFromDir(dir)).toThrow(/calls\.csv/);
  });

  test('DATA_DIR is used when set', () => {
    writeExport(dir);
    vi.stubEnv('DATA_DIR', dir);
    expect(readExportFromDir().rowsRead).toBe(1);
  });

  test.each(['', '   '])('DATA_DIR %j falls back to the current working directory', (value) => {
    writeExport(dir);
    vi.stubEnv('DATA_DIR', value);
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    expect(readExportFromDir().rowsRead).toBe(1);
  });

  test('an explicit empty or blank dir is treated as unset', () => {
    writeExport(dir);
    vi.stubEnv('DATA_DIR', undefined);
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    expect(readExportFromDir('').rowsRead).toBe(1);
    expect(readExportFromDir('  ').rowsRead).toBe(1);
  });

  test('DATA_DIR with surrounding spaces is trimmed', () => {
    writeExport(dir);
    vi.stubEnv('DATA_DIR', `  ${dir}  `);
    expect(readExportFromDir().rowsRead).toBe(1);
  });

  test('DATA_DIR set in .env is used when the shell does not set it', () => {
    const dataDir = join(dir, 'data');
    writeExport(dataDir);
    writeFileSync(join(dir, '.env'), `DATA_DIR=${dataDir}\n`);
    vi.stubEnv('DATA_DIR', undefined);
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    expect(readExportFromDir().rowsRead).toBe(1);
  });
});
