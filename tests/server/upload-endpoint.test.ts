import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { offService, type TakeawayService } from '../../src/ai/service';
import type { CallStore } from '../../src/core/types';
import { CALL_COLUMNS } from '../../src/core/validate';
import { loadStore, type LoadedStore } from '../../src/db/prepare';
import { createUploadService } from '../../src/db/upload/service';
import type { ApiError, Meta, UploadCommitResponse, UploadPreviewResponse } from '../../src/server/api';
import { createApp } from '../../src/server/app';
import { UPLOAD_MAX_BYTES } from '../../src/server/config';
import { callLine, campaignLine, count, csvTexts } from '../db/helpers';
import { csvOf } from '../db/upload/helpers';
import { get, tempDir } from './helpers';

const CALLS_HEADER = CALL_COLUMNS.join(',');
const BOOM_RAW = `CREATE TRIGGER boom BEFORE INSERT ON raw_calls WHEN NEW.call_id = 'c_boom' BEGIN SELECT RAISE(ABORT, 'boom'); END`;

const dirs: string[] = [];
const loaded: LoadedStore[] = [];
afterEach(() => {
  for (const l of loaded.splice(0)) l.database.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A server over an in-memory database seeded from a temp folder: one call, c_1, on 2026-09-01. */
function setup(options: { ai?: TakeawayService; rebuildAi?: (store: CallStore) => TakeawayService; withUploads?: boolean } = {}) {
  const root = tempDir();
  dirs.push(root);
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  const texts = csvTexts({ calls: [callLine({ call_id: 'c_1' })] });
  writeFileSync(join(dataDir, 'calls.csv'), texts.calls);
  writeFileSync(join(dataDir, 'campaigns.csv'), texts.campaigns);
  writeFileSync(join(dataDir, 'locations.csv'), texts.locations);
  const store = loadStore({ dbPath: ':memory:', dataDir });
  loaded.push(store);
  const app = createApp(store.store, {
    ai: options.ai,
    uploads: options.withUploads === false ? undefined : createUploadService(store.database),
    rebuildAi: options.rebuildAi,
  });
  const rows = (table = 'raw_calls') => store.database.use((db) => count(db, table));
  return { app, store, rows, root };
}

interface Parts {
  file?: { name: string; text: string | Uint8Array<ArrayBuffer> };
  files?: { name: string; text: string }[];
  fields?: Record<string, string | { name: string; text: string }>;
}

function formOf(parts: Parts): FormData {
  const form = new FormData();
  if (parts.file) form.append('file', new File([parts.file.text], parts.file.name, { type: 'text/csv' }));
  for (const f of parts.files ?? []) form.append('file', new File([f.text], f.name));
  for (const [name, value] of Object.entries(parts.fields ?? {})) {
    form.append(name, typeof value === 'string' ? value : new File([value.text], value.name));
  }
  return form;
}

const post = (app: Hono, path: string, parts: Parts, headers: Record<string, string> = {}) =>
  get(app, path, { method: 'POST', body: formOf(parts), headers });
const preview = (app: Hono, parts: Parts, headers?: Record<string, string>) => post(app, '/api/upload/preview', parts, headers);
const commit = (app: Hono, parts: Parts, headers?: Record<string, string>) => post(app, '/api/upload/commit', parts, headers);

const callsFile = (lines: string[], name = 'more.csv') => ({ name, text: csvOf(CALLS_HEADER, lines) });
const later = (id: string, day = '10') => callLine({ call_id: id, started_at: `2026-09-${day}T16:00:00Z`, updated_at: `2026-09-${day}T16:02:00Z` });
const meta = async (app: Hono) => (await get(app, '/api/meta')).json as Meta;
const errorOf = (json: unknown) => (json as { error: ApiError }).error;
const written = (r: { json: unknown }) => (r.json as UploadCommitResponse).written;

describe('POST /api/upload/preview', () => {
  it('returns counts, examples and hints for a valid calls file, and writes nothing', async () => {
    const { app, rows } = setup();
    const before = { raw: rows(), seeds: rows('seeds'), meta: await meta(app) };
    const r = await preview(app, { file: callsFile([later('c_a'), later('c_b'), callLine({ call_id: 'c_1' }), callLine({ call_id: 'c_x', location_id: 'loc_nope' })]) });
    expect(r.status).toBe(200);
    const { preview: p } = r.json as UploadPreviewResponse;
    expect(p.kind).toBe('calls');
    expect(p.counts).toMatchObject({ rowsRead: 4, newRows: 2, duplicates: 1, bad: 1 });
    expect(p.examples.new.length).toBe(2);
    expect(p.hints.join(' ')).toContain('Upload locations.csv first');
    expect(rows()).toBe(before.raw);
    expect(rows('seeds')).toBe(before.seeds);
    expect(await meta(app)).toEqual(before.meta);
  });
});

describe('POST /api/upload/commit', () => {
  it('writes, and meta, overview and campaigns reflect it on the next request', async () => {
    const { app, rows } = setup();
    const before = await meta(app);
    const overview = async () => ((await get(app, '/api/overview?range=all')).json as { tiles: { calls: { current: number } } }).tiles.calls.current;
    const callsBefore = await overview();

    await commit(app, { file: { name: 'campaigns.csv', text: csvOf('campaign_id,name,channel,daily_budget_usd', [campaignLine('cmp_new', 'Gamma', 'paid_search', '75')]) } });
    expect((await meta(app)).campaigns.map((c) => c.id)).toContain('cmp_new');
    expect((await get(app, '/api/campaigns?range=all')).status).toBe(200);

    const r = await commit(app, { file: callsFile([later('c_a'), later('c_b', '12')]) });
    expect(r.status).toBe(200);
    expect(written(r)).toBe(2);
    const after = await meta(app);
    expect(after.span!.end > before.span!.end).toBe(true);
    expect(after.callCount).toBe(before.callCount + 2);
    expect(await overview()).toBe(callsBefore + 2);
    expect(rows()).toBe(3);
  });

  it('the commit response carries the new meta', async () => {
    const { app } = setup();
    const r = await commit(app, { file: callsFile([later('c_a')]) });
    expect((r.json as UploadCommitResponse).meta).toEqual(await meta(app));
  });

  it('a second commit of the same file imports nothing', async () => {
    const { app, rows } = setup();
    const parts = { file: callsFile([later('c_a'), later('c_b')]) };
    expect(written(await commit(app, parts))).toBe(2);
    const second = await commit(app, parts);
    expect(written(second)).toBe(0);
    expect((second.json as UploadCommitResponse).preview.counts.duplicates).toBe(2);
    expect(rows()).toBe(3);
  });

  it('two commits of the same file at once import once', async () => {
    const { app, rows } = setup();
    const parts = () => ({ file: callsFile([later('c_a'), later('c_b'), later('c_c')]) });
    const results = await Promise.all([commit(app, parts()), commit(app, parts())]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map(written).sort()).toEqual([0, 3]);
    expect(rows()).toBe(4);
  });

  it('a failed write is 500 upload_failed, the store is unchanged, and a later commit works', async () => {
    const { app, store, rows } = setup();
    const before = await meta(app);
    store.database.use((db) => db.exec(BOOM_RAW));
    const lines = () => [later('c_ok'), later('c_boom'), later('c_ok2')];
    const r = await commit(app, { file: callsFile(lines()) });
    expect(r.status).toBe(500);
    expect(errorOf(r.json).code).toBe('upload_failed');
    expect(errorOf(r.json).message).toContain('nothing was stored');
    expect(rows()).toBe(1);
    expect(await meta(app)).toEqual(before);

    store.database.use((db) => db.exec('DROP TRIGGER boom'));
    const again = await commit(app, { file: callsFile(lines()) });
    expect(written(again)).toBe(3);
    expect((await meta(app)).callCount).toBe(before.callCount + 3);
  });

  it('takeaways follow the data: the service is rebuilt once per commit that writes, with the new store', async () => {
    const stores: CallStore[] = [];
    const rebuildAi = vi.fn((s: CallStore) => {
      stores.push(s);
      return offService();
    });
    const { app } = setup({ rebuildAi });
    await commit(app, { file: callsFile([callLine({ call_id: 'c_1' })]) }); // nothing new
    expect(rebuildAi).not.toHaveBeenCalled();
    await commit(app, { file: callsFile([later('c_a')]) });
    expect(rebuildAi).toHaveBeenCalledTimes(1);
    expect(stores[0]!.calls.map((c) => c.callId)).toContain('c_a');
  });

  it('the rebuilt service is the one the next request uses', async () => {
    const rebuilt: TakeawayService = { ...offService(), status: () => ({ status: 'on', spendUsd: 0, cacheHits: 0, checkerFailures: 0 }) };
    const { app } = setup({ rebuildAi: () => rebuilt });
    expect((await meta(app)).aiStatus).toBe('off');
    await commit(app, { file: callsFile([later('c_a')]) });
    expect((await meta(app)).aiStatus).toBe('on');
  });

  it('an upload does not disturb a takeaway request already running', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: TakeawayService = {
      ...offService(),
      takeaway: async (_sheet, template) => {
        await gate;
        return { text: template, source: 'template', reason: 'ai_off' };
      },
    };
    const { app } = setup({ ai: slow });
    const running = get(app, '/api/takeaway/overview?range=all');
    const result = await commit(app, { file: callsFile([later('c_a')]) });
    release();
    expect(result.status).toBe(200);
    expect((await running).status).toBe(200);
  });
});

describe('cross-site requests', () => {
  it.each(['/api/upload/preview', '/api/upload/commit'])('%s refuses cross-site and same-site, and writes nothing', async (path) => {
    const { app, rows } = setup();
    for (const site of ['cross-site', 'same-site']) {
      const r = await post(app, path, { file: callsFile([later('c_a')]) }, { 'Sec-Fetch-Site': site });
      expect(r.status).toBe(403);
      expect(errorOf(r.json).code).toBe('forbidden');
    }
    expect(rows()).toBe(1);
    expect(rows('seeds')).toBe(1);
    for (const site of ['same-origin', 'none']) {
      expect((await post(app, path, { file: callsFile([later('c_a')]) }, { 'Sec-Fetch-Site': site })).status).toBe(200);
    }
    expect((await post(app, path, { file: callsFile([later('c_b')]) })).status).toBe(200);
  });

  it('a cross-site request is refused before the body is read', async () => {
    const { app } = setup();
    const r = await get(app, '/api/upload/commit', { method: 'POST', body: 'not even multipart', headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(r.status).toBe(403);
  });
});

describe('a request that is not an upload of one file', () => {
  it.each(['/api/upload/preview', '/api/upload/commit'])('%s: no file, wrong field, two files, text field, JSON, no body', async (path) => {
    const { app, rows } = setup();
    const f = callsFile([later('c_a')]);
    const cases: (() => Promise<{ status: number; json: unknown }>)[] = [
      () => post(app, path, {}),
      () => post(app, path, { fields: { document: { name: f.name, text: f.text } } }),
      () => post(app, path, { files: [f, { name: 'b.csv', text: f.text }] }),
      () => post(app, path, { fields: { file: f.text } }),
      () => get(app, path, { method: 'POST', body: JSON.stringify({ file: f.text }), headers: { 'Content-Type': 'application/json' } }),
      () => get(app, path, { method: 'POST' }),
      () => get(app, path, { method: 'POST', body: 'garbage', headers: { 'Content-Type': 'multipart/form-data; boundary=x' } }),
    ];
    for (const run of cases) {
      const r = await run();
      expect(r.status).toBe(400);
      expect(errorOf(r.json)).toMatchObject({ code: 'bad_upload', field: 'file' });
    }
    expect(rows()).toBe(1);
    expect(rows('seeds')).toBe(1);
  });
});

describe('a file that is not usable', () => {
  it.each([
    ['an empty file', { name: 'e.csv', text: '' }],
    ['a PDF', { name: 'x.pdf', text: '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj' }],
    ['an image', { name: 'x.png', text: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0xff, 0xfe, 0, 1]) }],
    ['a text file', { name: 'notes.txt', text: 'Hello there.\nThis is not a CSV at all.\n' }],
    ['a file that matches no kind', { name: 'x.csv', text: 'a,b,c\n1,2,3\n' }],
  ])('%s is a 400 bad_upload on both routes, and nothing is written', async (_label, file) => {
    const { app, rows } = setup();
    for (const path of ['/api/upload/preview', '/api/upload/commit']) {
      const r = await post(app, path, { file });
      expect(r.status).toBe(400);
      expect(errorOf(r.json)).toMatchObject({ code: 'bad_upload', field: 'file' });
    }
    expect(rows()).toBe(1);
    expect(rows('seeds')).toBe(1);
  });

  it('a file that matches no kind lists the expected columns', async () => {
    const { app } = setup();
    const r = await preview(app, { file: { name: 'x.csv', text: 'a,b,c\n1,2,3\n' } });
    expect(errorOf(r.json).message).toContain(CALLS_HEADER.split(',').join(', '));
  });

  it('a file that matches more than one kind is rejected with the kinds named', async () => {
    const { app } = setup();
    const header = [...new Set([...CALL_COLUMNS, 'campaign_id', 'name', 'channel', 'daily_budget_usd'])].join(',');
    const r = await preview(app, { file: { name: 'x.csv', text: `${header}\n` } });
    expect(r.status).toBe(400);
    expect(errorOf(r.json).message).toContain('more than one kind');
  });

  it('a header-only file is 200 with all-zero counts, and commit writes 0', async () => {
    const { app, rows } = setup();
    const file = { name: 'h.csv', text: `${CALLS_HEADER}\n` };
    const p = await preview(app, { file });
    expect(p.status).toBe(200);
    expect((p.json as UploadPreviewResponse).preview.counts).toEqual({ rowsRead: 0, newRows: 0, newVersions: 0, duplicates: 0, conflicts: 0, bad: 0 });
    const c = await commit(app, { file });
    expect(c.status).toBe(200);
    expect(written(c)).toBe(0);
    expect(rows('seeds')).toBe(1);
  });
});

describe('the size limit', () => {
  const header = `${CALLS_HEADER}\n`;

  it.each(['/api/upload/preview', '/api/upload/commit'])('%s: a body over the limit is 413 too_large', async (path) => {
    const { app, rows } = setup();
    const text = header + 'x'.repeat(UPLOAD_MAX_BYTES + 1 - header.length);
    const r = await post(app, path, { file: { name: 'big.csv', text } });
    expect(r.status).toBe(413);
    expect(errorOf(r.json).code).toBe('too_large');
    expect(errorOf(r.json).message).toBe('The file is larger than 10 MB.');
    expect(rows()).toBe(1);
  });

  it('a declared Content-Length over the limit is refused without reading the body', async () => {
    const { app } = setup();
    const r = await get(app, '/api/upload/preview', {
      method: 'POST',
      body: 'tiny',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(UPLOAD_MAX_BYTES + 64 * 1024 + 1) },
    });
    expect(r.status).toBe(413);
    expect(errorOf(r.json).code).toBe('too_large');
  });

  it('a body just under the limit passes the limit check', async () => {
    const { app } = setup();
    const line = callLine({ call_id: 'c_1' }) + '\n';
    const lines = Math.floor((UPLOAD_MAX_BYTES - 4096 - header.length) / line.length);
    const text = header + line.repeat(lines); // a valid calls file of repeated duplicates; the limit counts the whole body
    const r = await preview(app, { file: { name: 'big.csv', text } });
    expect(r.status).not.toBe(413);
  });
});

describe('file names', () => {
  it('a name with a path, markup or 300 characters is cut, stored as text and never used as a path', async () => {
    const { app, store, root } = setup();
    const filesBefore = readdirSync(root, { recursive: true }).length;
    const name = `../../x<script>${'a'.repeat(300)}.csv`;
    const p = await preview(app, { file: callsFile([later('c_a')], name) });
    expect((p.json as UploadPreviewResponse).preview.fileName).toBe(name.slice(0, 100));
    const c = await commit(app, { file: callsFile([later('c_a')], name) });
    expect((c.json as UploadCommitResponse).preview.fileName).toBe(name.slice(0, 100));
    const label = store.database.use((db) => (db.prepare('SELECT label FROM seeds ORDER BY id DESC LIMIT 1').get() as { label: string }).label);
    expect(label).toBe(`upload: ${name.slice(0, 100)}`);
    expect(readdirSync(root, { recursive: true }).length).toBe(filesBefore);
    expect(existsSync(join(root, '..', '..', 'x<script>'))).toBe(false);
  });
});

describe('the rest of the API', () => {
  it('a server with no uploads option answers upload_unavailable (409) on both routes', async () => {
    const { app } = setup({ withUploads: false });
    for (const path of ['/api/upload/preview', '/api/upload/commit']) {
      const r = await post(app, path, { file: callsFile([later('c_a')]) });
      expect(r.status).toBe(409);
      expect(errorOf(r.json)).toMatchObject({ code: 'upload_unavailable', message: 'This server has no database to store uploads in.' });
    }
  });

  it('other routes are still GET only, and an unknown API path is still a JSON 404', async () => {
    const { app } = setup();
    expect((await get(app, '/api/overview', { method: 'POST' })).status).not.toBe(200);
    expect((await get(app, '/api/upload/preview')).status).not.toBe(200);
    const r = await get(app, '/api/nope');
    expect(r.status).toBe(404);
    expect(errorOf(r.json).code).toBe('not_found');
    expect((await get(app, '/api/upload/other', { method: 'POST' })).status).toBe(404);
  });
});

describe('host and origin checks on the upload routes (DNS rebinding)', () => {
  const paths = ['/api/upload/preview', '/api/upload/commit'];
  const send = (app: Hono, path: string, headers: Record<string, string>) => post(app, path, { file: callsFile([later('c_a')]) }, headers);

  it.each(paths)('%s refuses a foreign Host and writes nothing', async (path) => {
    const { app, rows } = setup();
    const r = await send(app, path, { Host: 'evil.example:3000' });
    expect(r.status).toBe(403);
    expect(errorOf(r.json).code).toBe('forbidden');
    expect(rows()).toBe(1);
    expect(rows('seeds')).toBe(1);
  });

  it.each(paths)('%s refuses a foreign Origin even with a local Host', async (path) => {
    const { app, rows } = setup();
    for (const origin of ['http://evil.example:3000', 'null', 'not a url']) {
      const r = await send(app, path, { Host: 'localhost:3000', Origin: origin });
      expect(r.status).toBe(403);
      expect(errorOf(r.json).code).toBe('forbidden');
    }
    expect(rows()).toBe(1);
  });

  it.each(paths)('%s accepts local Hosts, a matching Origin, and no Origin', async (path) => {
    const { app } = setup();
    for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'localhost']) {
      expect((await send(app, path, { Host: host })).status).toBe(200);
    }
    expect((await send(app, path, { Host: 'localhost:3000', Origin: 'http://localhost:3000' })).status).toBe(200);
  });

  it('a configured host is allowed too', async () => {
    const root = tempDir();
    dirs.push(root);
    const dataDir = join(root, 'data');
    mkdirSync(dataDir);
    const texts = csvTexts({ calls: [callLine({ call_id: 'c_1' })] });
    writeFileSync(join(dataDir, 'calls.csv'), texts.calls);
    writeFileSync(join(dataDir, 'campaigns.csv'), texts.campaigns);
    writeFileSync(join(dataDir, 'locations.csv'), texts.locations);
    const l = loadStore({ dbPath: ':memory:', dataDir });
    loaded.push(l);
    const app = createApp(l.store, { uploads: createUploadService(l.database), allowedHosts: ['calls.lan'] });
    expect((await send(app, paths[0]!, { Host: 'calls.lan:3000' })).status).toBe(200);
    expect((await send(app, paths[0]!, { Host: 'other.lan:3000' })).status).toBe(403);
  });
});

describe('the swap after a commit', () => {
  it('a rebuildAi that throws still returns the written result (200 with a warning) and adopts the new data with AI off', async () => {
    const on: TakeawayService = { ...offService(), status: () => ({ status: 'on', spendUsd: 0, cacheHits: 0, checkerFailures: 0 }) };
    const { app, rows } = setup({ ai: on, rebuildAi: () => { throw new Error('boom'); } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await commit(app, { file: callsFile([later('c_a')]) });
    expect(r.status).toBe(200);
    const body = r.json as UploadCommitResponse;
    expect(body.written).toBe(1);
    expect(body.warning).toMatch(/AI/);
    expect(rows()).toBe(2);
    const m = await meta(app);
    expect(m.callCount).toBe(2);
    expect(m.aiStatus).toBe('off'); // never the old service answering about the new data
  });

  it('a commit with a working rebuild has no warning', async () => {
    const { app } = setup({ rebuildAi: () => offService() });
    const r = await commit(app, { file: callsFile([later('c_a')]) });
    expect((r.json as UploadCommitResponse).warning).toBeUndefined();
  });
});

describe('the size limit, file size exactly', () => {
  const header = `${CALLS_HEADER}\n`;
  const exact = (bytes: number) => {
    const line = callLine({ call_id: 'c_1' }) + '\n';
    const body = header + line;
    // pad with a trailing comment-free run of newlines to reach the exact byte count
    return body + '\n'.repeat(bytes - body.length);
  };

  it('a file of exactly UPLOAD_MAX_BYTES is accepted; one more byte is 413', async () => {
    const { app } = setup();
    const ok = await preview(app, { file: { name: 'a.csv', text: exact(UPLOAD_MAX_BYTES) } });
    expect(ok.status).toBe(200);
    const big = await preview(app, { file: { name: 'a.csv', text: exact(UPLOAD_MAX_BYTES + 1) } });
    expect(big.status).toBe(413);
    expect(errorOf(big.json).message).toBe('The file is larger than 10 MB.');
  });

  it('an enormous body is still refused by the body limit', async () => {
    const { app } = setup();
    const r = await preview(app, { file: { name: 'a.csv', text: 'x'.repeat(UPLOAD_MAX_BYTES + 200 * 1024) } });
    expect(r.status).toBe(413);
  });
});
