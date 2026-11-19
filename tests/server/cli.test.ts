import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from './helpers';

const CLI = resolve('src/server/cli.ts');
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const SHIPPED = resolve('tests/fixtures/original-export');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runCli(env: Record<string, string>, cwd?: string, unset: string[] = []) {
  const base = { ...process.env, ...env };
  for (const name of unset) delete base[name];
  return spawnSync(process.execPath, ['--import', TSX, CLI], {
    timeout: 30_000,
    encoding: 'utf8',
    cwd,
    env: base,
  });
}

describe('cli', () => {
  it('a missing data folder exits 1 with one clear line', () => {
    const result = runCli({ DATA_DIR: 'no/such/folder', PORT: '3999' });
    expect(result.status).toBe(1);
    expect(result.stderr.startsWith('Cannot start: Data folder not found')).toBe(true);
    expect(result.stderr).not.toMatch(/^\s+at /m);
  });

  it('a bad PORT exits 1', () => {
    const result = runCli({ DATA_DIR: 'tests/fixtures/original-export', PORT: 'abc' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Cannot start:');
    expect(result.stderr).toContain('PORT');
  });

  it('reads a .env in the current folder (a temporary one, never the real .env)', () => {
    const dir = tempDir();
    dirs.push(dir);
    writeFileSync(join(dir, '.env'), `DATA_DIR=${SHIPPED}\nPORT=abc\n`);
    const result = runCli({}, dir, ['DATA_DIR', 'PORT']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PORT must be a whole number');
  });

  it('the shell wins over .env', () => {
    const dir = tempDir();
    dirs.push(dir);
    writeFileSync(join(dir, '.env'), 'DATA_DIR=no/such/folder\nPORT=abc\n');
    const result = runCli({ DATA_DIR: SHIPPED, PORT: 'xyz' }, dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"xyz"');
  });
});
