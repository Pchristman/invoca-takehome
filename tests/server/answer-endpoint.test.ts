import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTakeawayService } from '../../src/ai/service';
import type { TakeawayService } from '../../src/ai/service';
import { CHANNELS } from '../../src/core/types';
import { createApp } from '../../src/server/app';
import { makeStore } from '../core/views/fixtures';
import { FakeModel } from '../ai/fakeModel';
import { get, serverFixture, tempDir } from './helpers';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const throwing: TakeawayService = {
  takeaway: () => { throw new Error('AI must not be called'); },
  interpret: () => { throw new Error('AI must not be called'); },
  status: () => { throw new Error('AI must not be called'); },
};

describe('GET /api/answer', () => {
  it('returns the answer with names, without ?dev and without touching the AI service', async () => {
    const app = createApp(serverFixture(), { ai: throwing });
    const r = await get(app, '/api/answer?view=missed-calls&f_office=loc_b&range=all');
    expect(r.status).toBe(200);
    const body = r.json as {
      groupBy: string; totals: { calls: number; unanswered: number }; sentence: string;
      names: { offices: unknown[]; campaigns: unknown[] };
    };
    expect(body.groupBy).toBe('office');
    expect(body.totals).toMatchObject({ calls: 14, unanswered: 14 });
    expect(body.sentence).toContain('Office B');
    expect(body.names).toEqual({ offices: [{ id: 'loc_b', name: 'Office B' }], campaigns: [] });
  });

  it.each([
    ['/api/answer?f_office=nope', 'unknown_location', 'f_office'],
    ['/api/answer?f_weekday=9', 'bad_param', 'f_weekday'],
    ['/api/answer?view=nope', 'unknown_view', 'view'],
  ])('400 for %s', async (path, code, field) => {
    const r = await get(createApp(serverFixture()), path);
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: { code, message: expect.any(String), field } });
  });

  it('409 with no data', async () => {
    const r = await get(createApp(makeStore([])), '/api/answer');
    expect(r.status).toBe(409);
  });
});

describe('/api/meta aiStatus', () => {
  it('is off for the default service and on for a model-backed one', async () => {
    const off = await get(createApp(serverFixture()), '/api/meta');
    expect((off.json as { aiStatus: string }).aiStatus).toBe('off');

    const dir = tempDir();
    dirs.push(dir);
    const ai = createTakeawayService({
      model: new FakeModel(),
      known: { campaigns: ['Alpha'], offices: ['Office A'], channels: CHANNELS },
      snapshotId: 's',
      limitUsd: 5,
      cachePath: join(dir, 'cache.json'),
      logPath: join(dir, 'logs', 'ai-calls.jsonl'),
    });
    const on = await get(createApp(serverFixture(), { ai }), '/api/meta');
    expect((on.json as { aiStatus: string }).aiStatus).toBe('on');
  });
});
