import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODEL_ID, worstCaseNanoUsd } from '../../src/ai/pricing';
import { buildQuestionPrompt, type FilterReply, type QuestionContext } from '../../src/ai/question';
import { createTakeawayService, offService, type ServiceOptions } from '../../src/ai/service';
import { ModelError } from '../../src/ai/types';
import { CHANNELS } from '../../src/core/types';
import { makeFactSheet } from '../../src/core/views/facts';
import { tempDir } from '../server/helpers';
import { FakeModel, jsonReply, textReply, USAGE, type Step } from './fakeModel';

const QUESTION = 'Which office misses the most calls on Fridays?';
const CONTEXT: QuestionContext = { firstDate: '2026-09-01', lastDate: '2026-10-29', offices: ['Alpha Office'], campaigns: ['Search'] };
const REPLY: FilterReply = {
  answerable: true, view: 'missed-calls', offices: ['Alpha Office'], campaigns: [], includeUnattributed: false,
  weekdays: ['friday'], hours: [], range: null,
};
const UNANSWERABLE: FilterReply = { ...REPLY, answerable: false, offices: [], weekdays: [] };

const accept = (reply: FilterReply) => ({ ok: true as const, value: reply.view });
const reject = () => ({ ok: false as const, detail: 'No office is called "Secret Name".' });

let dir: string;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function paths() {
  return { cachePath: join(dir, 'cache.json'), logPath: join(dir, 'logs', 'ai-calls.jsonl') };
}

function make(model: FakeModel | null, overrides: Partial<ServiceOptions> = {}) {
  return createTakeawayService({
    model,
    known: { campaigns: ['Alpha'], offices: ['Office A'], channels: CHANNELS },
    snapshotId: 'snap1',
    limitUsd: 5,
    ...paths(),
    ...overrides,
  });
}

function logLines(): Array<Record<string, unknown>> {
  return readFileSync(paths().logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

function worstQuestion(question: string): number {
  const prompt = buildQuestionPrompt(question, CONTEXT);
  return worstCaseNanoUsd(MODEL_ID, prompt.system.length + prompt.user.length);
}

describe('interpret', () => {
  it('a valid reply is returned and logged without the question or names', async () => {
    const model = new FakeModel(jsonReply(REPLY));
    const result = await make(model).interpret(QUESTION, CONTEXT, accept);
    expect(result).toEqual({ ok: true, reply: REPLY, value: 'missed-calls', cached: false });
    const lines = logLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      model: MODEL_ID, purpose: 'question', inputTokens: 1500, outputTokens: 300, costUsd: 0.0003,
      cached: false, checkPassed: true, failure: null,
    });
    const raw = readFileSync(paths().logPath, 'utf8');
    expect(raw).not.toContain('Fridays');
    expect(raw).not.toContain('Alpha Office');
  });

  it('a repeat, also in other case and spacing, is a cache hit that is validated again', async () => {
    const model = new FakeModel(jsonReply(REPLY));
    const service = make(model);
    const validate = vi.fn(accept);
    await service.interpret(QUESTION, CONTEXT, validate);
    const again = await service.interpret(QUESTION, CONTEXT, validate);
    const third = await service.interpret(`  ${QUESTION.toUpperCase()}  `, CONTEXT, validate);
    expect(again).toMatchObject({ ok: true, cached: true });
    expect(third).toMatchObject({ ok: true, cached: true });
    expect(model.calls).toBe(1);
    expect(validate).toHaveBeenCalledTimes(3);
    const lines = logLines();
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatchObject({ purpose: 'question', cached: true, costUsd: 0, checkPassed: true });
    expect(service.status().cacheHits).toBe(2);
  });

  it('the cache survives a restart', async () => {
    await make(new FakeModel(jsonReply(REPLY))).interpret(QUESTION, CONTEXT, accept);
    const second = new FakeModel(jsonReply(REPLY));
    const result = await make(second).interpret(QUESTION, CONTEXT, accept);
    expect(result).toMatchObject({ ok: true, cached: true });
    expect(second.calls).toBe(0);
  });

  it('a cached reply that no longer validates is dropped and remembered as invalid', async () => {
    const model = new FakeModel(jsonReply(REPLY));
    const service = make(model);
    await service.interpret(QUESTION, CONTEXT, accept);
    const result = await service.interpret(QUESTION, CONTEXT, reject);
    expect(result).toMatchObject({ ok: false, reason: 'invalid_filter' });
    expect(logLines()[1]).toMatchObject({ cached: false, costUsd: 0, checkPassed: false, failure: 'invalid_filter' });
    await service.interpret(QUESTION, CONTEXT, accept);
    expect(model.calls).toBe(1); // remembered, not asked again
  });

  it('unanswerable is a valid reply: cached, not remembered as a failure', async () => {
    const model = new FakeModel(jsonReply(UNANSWERABLE));
    const service = make(model);
    const first = await service.interpret(QUESTION, CONTEXT, accept);
    expect(first).toMatchObject({ ok: false, reason: 'unanswerable' });
    expect(logLines()[0]).toMatchObject({ checkPassed: true, failure: null });
    const again = await service.interpret(QUESTION, CONTEXT, accept);
    expect(again).toMatchObject({ ok: false, reason: 'unanswerable' });
    expect(model.calls).toBe(1);
    expect(logLines()[1]).toMatchObject({ cached: true, costUsd: 0 });
    // A restart still has it in the cache.
    const fresh = new FakeModel(jsonReply(REPLY));
    expect(await make(fresh).interpret(QUESTION, CONTEXT, accept)).toMatchObject({ reason: 'unanswerable' });
    expect(fresh.calls).toBe(0);
  });

  it('invalid values: invalid_filter, a fixed failure code, remembered; another question still calls', async () => {
    const model = new FakeModel(jsonReply(REPLY));
    const service = make(model);
    const result = await service.interpret(QUESTION, CONTEXT, reject);
    expect(result).toEqual({ ok: false, reason: 'invalid_filter', detail: 'No office is called "Secret Name".' });
    expect(logLines()[0]).toMatchObject({ checkPassed: false, failure: 'invalid_filter' });
    expect(readFileSync(paths().logPath, 'utf8')).not.toContain('Secret Name');
    const again = await service.interpret(QUESTION, CONTEXT, reject);
    expect(again).toMatchObject({ ok: false, reason: 'invalid_filter' });
    expect(model.calls).toBe(1);
    await service.interpret('A different question', CONTEXT, reject);
    expect(model.calls).toBe(2);
  });

  describe('failures', () => {
    const paid = { inputTokens: 1500, outputTokens: 300 };
    const cases: Array<[string, Step, string]> = [
      ['malformed JSON', { kind: 'text', text: 'nope', usage: paid }, 'malformed'],
      ['an extra key', jsonReply({ ...REPLY, extra: 1 }), 'malformed'],
      ['a refusal', { kind: 'refusal', usage: paid }, 'refusal'],
    ];
    for (const [name, step, reason] of cases) {
      it(`${name} is ${reason}, remembered and not cached`, async () => {
        const model = new FakeModel(step);
        const service = make(model);
        expect(await service.interpret(QUESTION, CONTEXT, accept)).toMatchObject({ ok: false, reason });
        expect(await service.interpret(QUESTION, CONTEXT, accept)).toMatchObject({ ok: false, reason });
        expect(model.calls).toBe(1);
        expect(logLines()).toHaveLength(1);
        expect(logLines()[0]).toMatchObject({ purpose: 'question', failure: reason, costUsd: 0.0003 });
        // Not cached: a restart asks again.
        const fresh = new FakeModel(step);
        await make(fresh).interpret(QUESTION, CONTEXT, accept);
        expect(fresh.calls).toBe(1);
      });
    }

    it('a timeout and an API error are not remembered', async () => {
      const timeout = new FakeModel(new ModelError('timeout', 'x'));
      const a = make(timeout);
      expect(await a.interpret(QUESTION, CONTEXT, accept)).toMatchObject({ reason: 'timeout' });
      await a.interpret(QUESTION, CONTEXT, accept);
      expect(timeout.calls).toBe(2);
      const failing = new FakeModel(new ModelError('api_error', 'x'));
      const b = make(failing);
      expect(await b.interpret(QUESTION, CONTEXT, accept)).toMatchObject({ reason: 'api_error' });
      await b.interpret(QUESTION, CONTEXT, accept);
      expect(failing.calls).toBe(2);
    });
  });

  describe('the guard, the log and the shared limit', () => {
    it('at the limit: budget_reached and no call', async () => {
      const model = new FakeModel(jsonReply(REPLY));
      expect(await make(model, { limitUsd: 0 }).interpret(QUESTION, CONTEXT, accept)).toMatchObject({ ok: false, reason: 'budget_reached' });
      expect(model.calls).toBe(0);
    });

    it('an unwritable log gives log_unavailable and no call', async () => {
      mkdirSync(paths().logPath, { recursive: true });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const model = new FakeModel(jsonReply(REPLY));
      expect(await make(model).interpret(QUESTION, CONTEXT, accept)).toMatchObject({ ok: false, reason: 'log_unavailable' });
      expect(model.calls).toBe(0);
    });

    it('a takeaway call counts against a question, and question spend is in status', async () => {
      const sheet = makeFactSheet('campaigns', { 'shift.worst.name': { kind: 'name', value: 'Alpha' } });
      const model = new FakeModel(textReply('Move from {shift.worst.name}.'), jsonReply(REPLY));
      // Room for the takeaway's real spend plus exactly one worst-case question call, minus a nano-dollar.
      const takeawaySpend = 300000;
      const service = make(model, { limitUsd: (takeawaySpend + worstQuestion(QUESTION) - 1) / 1e9 });
      await service.takeaway(sheet, 'T');
      expect(await service.interpret(QUESTION, CONTEXT, accept)).toMatchObject({ ok: false, reason: 'budget_reached' });
      expect(model.calls).toBe(1);

      const roomy = make(new FakeModel(jsonReply(REPLY)), { limitUsd: 5 });
      const before = roomy.status().spendUsd;
      await roomy.interpret('Another question', CONTEXT, accept);
      expect(roomy.status().spendUsd).toBeGreaterThan(before);
    });

    it('two identical questions at once make one call', async () => {
      const model = new FakeModel(jsonReply(REPLY));
      let open!: () => void;
      model.gate = new Promise<void>((resolve) => { open = resolve; });
      const service = make(model);
      const first = service.interpret(QUESTION, CONTEXT, accept);
      const second = service.interpret(QUESTION, CONTEXT, accept);
      open();
      const [a, b] = await Promise.all([first, second]);
      expect(a).toEqual(b);
      expect(a.ok).toBe(true);
      expect(model.calls).toBe(1);
      expect(logLines()).toHaveLength(1);
    });

    it('two different questions at once near the limit cannot both pass', async () => {
      const model = new FakeModel(jsonReply(REPLY));
      let open!: () => void;
      model.gate = new Promise<void>((resolve) => { open = resolve; });
      const service = make(model, { limitUsd: worstQuestion('First question') / 1e9 });
      const first = service.interpret('First question', CONTEXT, accept);
      const second = service.interpret('Second question', CONTEXT, accept);
      open();
      const results = await Promise.all([first, second]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toMatchObject({ reason: 'budget_reached' });
      expect(model.calls).toBe(1);
    });
  });
});

describe('offService().interpret', () => {
  it('is ai_off and never validates', async () => {
    const validate = vi.fn(accept);
    expect(await offService().interpret(QUESTION, CONTEXT, validate)).toEqual({ ok: false, reason: 'ai_off', detail: null });
    expect(validate).not.toHaveBeenCalled();
    expect(await make(null).interpret(QUESTION, CONTEXT, validate)).toMatchObject({ reason: 'ai_off' });
    expect(USAGE.inputTokens).toBe(1500);
  });
});
