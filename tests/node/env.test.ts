import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadDotEnv } from '../../src/node/env';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'invoca-env-'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('loadDotEnv', () => {
  test('sets variables that are not already set', () => {
    vi.stubEnv('INVOCA_TEST_VAR', undefined);
    writeFileSync(join(dir, '.env'), 'INVOCA_TEST_VAR=from-file\n');
    loadDotEnv(join(dir, '.env'));
    expect(process.env.INVOCA_TEST_VAR).toBe('from-file');
  });

  test('never overrides a variable that is already set', () => {
    vi.stubEnv('INVOCA_TEST_VAR', 'from-shell');
    writeFileSync(join(dir, '.env'), 'INVOCA_TEST_VAR=from-file\n');
    loadDotEnv(join(dir, '.env'));
    expect(process.env.INVOCA_TEST_VAR).toBe('from-shell');
  });

  test('a missing .env is fine', () => {
    expect(() => loadDotEnv(join(dir, '.env'))).not.toThrow();
  });
});
