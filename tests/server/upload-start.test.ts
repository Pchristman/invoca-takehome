import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { offService, type TakeawayService } from '../../src/ai/service';
import { CALL_COLUMNS } from '../../src/core/validate';
import { start, type RunningServer } from '../../src/server/start';
import type { Meta, UploadCommitResponse } from '../../src/server/api';
import { callLine, csvTexts } from '../db/helpers';
import { csvOf } from '../db/upload/helpers';
import { tempDir } from './helpers';

// start() must not read the real .env.
vi.mock('../../src/node/env', () => ({ loadDotEnv: vi.fn() }));

const running: RunningServer[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of running.splice(0)) await server.close().catch(() => undefined);
});

function folder(): string {
  const texts = csvTexts({ calls: [callLine({ call_id: 'c_1' })] });
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

const upload = async (server: RunningServer, mode: 'preview' | 'commit') => {
  const form = new FormData();
  const text = csvOf(CALL_COLUMNS.join(','), [callLine({ call_id: 'c_up', started_at: '2026-09-10T16:00:00Z', updated_at: '2026-09-10T16:01:00Z' })]);
  form.append('file', new File([text], 'up.csv', { type: 'text/csv' }));
  return fetch(`${server.url}/api/upload/${mode}`, { method: 'POST', body: form });
};
const meta = async (server: RunningServer) => (await (await fetch(`${server.url}/api/meta`)).json()) as Meta;

describe('start with uploads', () => {
  it('an in-memory server accepts an upload and serves it', async () => {
    const server = await begin({ dataDir: folder() });
    expect((await meta(server)).callCount).toBe(1);
    expect((await upload(server, 'preview')).status).toBe(200);
    expect((await meta(server)).callCount).toBe(1);
    const r = await upload(server, 'commit');
    expect(r.status).toBe(200);
    expect(((await r.json()) as UploadCommitResponse).written).toBe(1);
    expect((await meta(server)).callCount).toBe(2);
  });

  it('a file database keeps the upload across a restart, with no data folder', async () => {
    const file = join(tempDir(), 'calls.db');
    const first = await begin({ dbPath: file, dataDir: folder() });
    expect(((await (await upload(first, 'commit')).json()) as UploadCommitResponse).written).toBe(1);
    await first.close();

    vi.stubEnv('DATA_DIR', join(tempDir(), 'nowhere'));
    const second = await begin({ dbPath: file });
    expect((await meta(second)).callCount).toBe(2);
    expect(second.store.calls.map((c) => c.callId)).toContain('c_up');
  });

  it('close() releases the database file (it can be deleted on Windows)', async () => {
    const dir = tempDir();
    const file = join(dir, 'calls.db');
    const server = await begin({ dbPath: file, dataDir: folder() });
    await upload(server, 'commit');
    await server.close();
    rmSync(file);
    expect(existsSync(file)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('a file database is not held open between requests', async () => {
    const dir = tempDir();
    const file = join(dir, 'calls.db');
    const moved = join(dir, 'moved.db');
    const server = await begin({ dbPath: file, dataDir: folder() });
    await upload(server, 'commit');
    renameSync(file, moved); // fails on Windows while a connection is open
    renameSync(moved, file);
    expect((await upload(server, 'commit')).status).toBe(200);
  });
});

describe('start with an injected AI service', () => {
  it('keeps the injected service after an upload', async () => {
    const injected: TakeawayService = { ...offService(), status: () => ({ status: 'on', spendUsd: 0, cacheHits: 0, checkerFailures: 0 }) };
    const server = await begin({ dataDir: folder(), ai: injected });
    expect((await meta(server)).aiStatus).toBe('on');
    expect((await upload(server, 'commit')).status).toBe(200);
    expect((await meta(server)).aiStatus).toBe('on');
  });
});
