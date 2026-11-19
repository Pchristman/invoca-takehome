import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDotEnv } from '../../src/node/env';

// dev.ts loads .env (same semantics as loadDotEnv) before it starts Vite, so Vite's proxy sees the PORT
// that the server will use. This pins that order using a temp .env, never the real one.
describe('dev proxy port', () => {
  let dir: string;
  let saved: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dev-env-'));
    saved = process.env.PORT;
    delete process.env.PORT;
    vi.resetModules();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.PORT;
    else process.env.PORT = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  async function proxyTarget(): Promise<unknown> {
    const config = (await import('../../vite.config')).default as { server: { proxy: Record<string, string> } };
    return config.server.proxy['/api'];
  }

  it('follows PORT from .env once it is loaded', async () => {
    const envFile = join(dir, '.env');
    writeFileSync(envFile, 'PORT=4567\n');
    loadDotEnv(envFile);
    expect(await proxyTarget()).toBe('http://127.0.0.1:4567');
  });

  it('lets the shell PORT win over .env', async () => {
    const envFile = join(dir, '.env');
    writeFileSync(envFile, 'PORT=4567\n');
    process.env.PORT = '4999';
    loadDotEnv(envFile);
    expect(await proxyTarget()).toBe('http://127.0.0.1:4999');
  });

  it('falls back to 3000 with no PORT', async () => {
    expect(await proxyTarget()).toBe('http://127.0.0.1:3000');
  });
});
