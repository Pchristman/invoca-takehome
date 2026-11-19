import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { readExportFromDir } from '../../src/node/readDataDir';

const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'original-export');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('shipped export through the loader', () => {
  test('loads 5,411 raw rows, 12 campaigns, 8 locations, no issues or notes', () => {
    const result = readExportFromDir(FIXTURE_DIR);
    expect(result.rowsRead).toBe(5411);
    expect(result.rows).toHaveLength(5411);
    expect(result.campaigns).toHaveLength(12);
    expect(result.locations).toHaveLength(8);
    expect(result.referenceIssues).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  test('has no bad rows', () => {
    const { badByReason } = readExportFromDir(FIXTURE_DIR);
    expect(Object.values(badByReason).every((n) => n === 0)).toBe(true);
  });

  test('the default DATA_DIR (repo root) loads the same row count', () => {
    vi.stubEnv('DATA_DIR', '');
    expect(readExportFromDir().rowsRead).toBe(5411);
  });

  test('a zero-budget campaign is present', () => {
    const { campaigns } = readExportFromDir(FIXTURE_DIR);
    expect(campaigns.some((c) => c.dailyBudgetUsd === 0)).toBe(true);
  });

  test('a Phoenix office is present with a valid zone', () => {
    const { locations } = readExportFromDir(FIXTURE_DIR);
    expect(locations.some((l) => l.timezone === 'America/Phoenix' && l.timezoneValid)).toBe(true);
  });
});
