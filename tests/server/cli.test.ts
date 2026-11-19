import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function runCli(env: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/server/cli.ts'], {
    timeout: 30_000,
    encoding: 'utf8',
    env: { ...process.env, ...env },
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
});
