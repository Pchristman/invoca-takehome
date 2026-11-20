import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTakeawayService, type TakeawayService } from '../../src/ai/service';
import type { TakeawayResult } from '../../src/ai/types';
import { CHANNELS } from '../../src/core/types';
import type { FactSheet } from '../../src/core/views/facts';
import type { AiStatus } from '../../src/server/api';
import { createApp } from '../../src/server/app';
import { FakeModel, textReply } from '../ai/fakeModel';
import { get, serverFixture, tempDir } from './helpers';

const VIEWS = ['overview', 'campaigns', 'locations', 'missed-calls'] as const;

const STATUS: AiStatus = { status: 'on', spendUsd: 1.5, cacheHits: 2, checkerFailures: 3 };

interface Call { sheet: FactSheet; template: string }

/** A service that records what it is called with and returns (or throws) what it is told. */
function stub(result: TakeawayResult | Error) {
  const calls: Call[] = [];
  const service: TakeawayService = {
    async takeaway(sheet, template) {
      calls.push({ sheet, template });
      if (result instanceof Error) throw result;
      return result;
    },
    status: () => STATUS,
  };
  return { service, calls };
}

const AI_RESULT: TakeawayResult = { text: 'AI says hi.', source: 'ai', reason: null };

describe('GET /api/takeaway/:view', () => {
  afterEach(() => vi.restoreAllMocks());

  it('an AI result is returned as source ai, reason null', async () => {
    const app = createApp(serverFixture(), { ai: stub(AI_RESULT).service });
    const r = await get(app, '/api/takeaway/overview');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ view: 'overview', text: 'AI says hi.', source: 'ai', reason: null });
  });

  it.each(VIEWS)('with no service given, the %s body is the Phase 6 body', async (name) => {
    const store = serverFixture();
    const { service, calls } = stub(AI_RESULT);
    await get(createApp(store, { ai: service }), `/api/takeaway/${name}`);
    const r = await get(createApp(store), `/api/takeaway/${name}`);
    expect(r.status).toBe(200);
    // Same key order and exact text as Phase 6: the view's own template sentence.
    expect(r.text).toBe(JSON.stringify({ view: name, text: calls[0]!.template, source: 'template', reason: 'ai_off' }));
  });

  it('bad params still 400 and the service is not called', async () => {
    const { service, calls } = stub(AI_RESULT);
    const app = createApp(serverFixture(), { ai: service });
    for (const path of [
      '/api/takeaway/overview?range=nonsense',
      '/api/takeaway/campaigns?campaign=cmp_nope',
      '/api/takeaway/nope',
    ]) {
      expect((await get(app, path)).status, path).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it("the service is called with the view's own fact sheet and template sentence", async () => {
    const { service, calls } = stub(AI_RESULT);
    const app = createApp(serverFixture(), { ai: service });
    for (const name of VIEWS) await get(app, `/api/takeaway/${name}`);
    expect(calls.map((c) => c.sheet.view)).toEqual([...VIEWS]);
    // The same view, built directly over the same default range, gives the same sheet and sentence.
    const direct = await get(createApp(serverFixture()), '/api/overview');
    const overview = direct.json as { factSheet: FactSheet; templateSentence: string };
    expect(calls[0]!.sheet).toEqual(overview.factSheet);
    expect(calls[0]!.template).toBe(overview.templateSentence);
    expect(calls.some((c) => Object.keys(c.sheet.facts).length > 0)).toBe(true);
  });

  it('a throwing service gives the template with api_error, not a 500, and logs a fixed string', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = serverFixture();
    const { service, calls } = stub(new Error('secret sk-ant-123 detail'));
    const r = await get(createApp(store, { ai: service }), '/api/takeaway/campaigns');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ view: 'campaigns', text: calls[0]!.template, source: 'template', reason: 'api_error' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret');
  });

  it("data-notes returns the service's status", async () => {
    const app = createApp(serverFixture(), { ai: stub(AI_RESULT).service });
    const r = await get(app, '/api/data-notes');
    expect((r.json as { ai: AiStatus }).ai).toEqual(STATUS);
  });

  describe('end to end with a fake model', () => {
    let dir: string;
    beforeEach(() => {
      dir = tempDir();
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('two identical requests make one model call; the second is still source ai; data-notes shows the cache hit', async () => {
      const store = serverFixture();
      // Learn one real fact key from the overview's own sheet, so the reply uses only placeholders.
      const probe = stub(AI_RESULT);
      await get(createApp(store, { ai: probe.service }), '/api/takeaway/overview');
      const key = Object.keys(probe.calls[0]!.sheet.facts)[0]!;

      const model = new FakeModel(textReply(`Look at {${key}}.`));
      const service = createTakeawayService({
        model,
        known: { campaigns: ['Alpha', 'Beta'], offices: ['Office A', 'Office B'], channels: CHANNELS },
        snapshotId: 'snap',
        limitUsd: 5,
        cachePath: join(dir, 'cache.json'),
        logPath: join(dir, 'ai-calls.jsonl'),
      });
      const app = createApp(store, { ai: service });

      const first = await get(app, '/api/takeaway/overview');
      const second = await get(app, '/api/takeaway/overview');
      expect(first.json).toMatchObject({ source: 'ai', reason: null });
      expect(second.json).toMatchObject({ source: 'ai', reason: null });
      expect(model.calls).toBe(1);

      const notes = (await get(app, '/api/data-notes')).json as { ai: AiStatus };
      expect(notes.ai.cacheHits).toBe(1);
      expect(notes.ai.spendUsd).toBeGreaterThan(0);
    });
  });
});
