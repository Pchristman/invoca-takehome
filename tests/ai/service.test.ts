import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPrompt } from '../../src/ai/prompt';
import { worstCaseNanoUsd, MODEL_ID } from '../../src/ai/pricing';
import { createTakeawayService, offService, type ServiceOptions } from '../../src/ai/service';
import { ModelError } from '../../src/ai/types';
import { CHANNELS } from '../../src/core/types';
import { formatFact, makeFactSheet, type FactSheet } from '../../src/core/views/facts';
import { tempDir } from '../server/helpers';
import { FakeModel, textReply, type Step } from './fakeModel';

const TEMPLATE = 'Template sentence.';
const GOOD = 'Move budget from {shift.worst.name} (earning {shift.worst.value}).';

function sheet(value = 12): FactSheet {
  return makeFactSheet('campaigns', {
    'shift.worst.name': { kind: 'name', value: 'Alpha' },
    'shift.worst.value': { kind: 'usd', value },
  });
}

function filled(s: FactSheet): string {
  return `Move budget from Alpha (earning ${formatFact(s.facts['shift.worst.value']!)}).`;
}

function worst(s: FactSheet): number {
  const prompt = buildPrompt(s);
  return worstCaseNanoUsd(MODEL_ID, prompt.system.length + prompt.user.length);
}

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
    known: { campaigns: ['Alpha', 'Beta', 'Gamma'], offices: ['Office A'], channels: CHANNELS },
    snapshotId: 'snap1',
    limitUsd: 5,
    ...paths(),
    ...overrides,
  });
}

function logLines(): Array<Record<string, unknown>> {
  return readFileSync(paths().logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('takeaway service', () => {
  it('no model gives the template with ai_off and writes no log', async () => {
    const service = make(null);
    expect(await service.takeaway(sheet(), TEMPLATE)).toEqual({ text: TEMPLATE, source: 'template', reason: 'ai_off' });
    expect(() => readFileSync(paths().logPath)).toThrow();
  });

  it('a good reply is filled and logged', async () => {
    const model = new FakeModel(textReply(GOOD));
    const result = await make(model).takeaway(sheet(), TEMPLATE);
    expect(result).toEqual({ text: filled(sheet()), source: 'ai', reason: null });
    const lines = logLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      model: MODEL_ID, purpose: 'campaigns', inputTokens: 1500, outputTokens: 300,
      costUsd: 0.0003, cached: false, checkPassed: true, failure: null,
    });
    expect(typeof lines[0]!.time).toBe('string');
  });

  it('a repeat is a cache hit with zero cost', async () => {
    const model = new FakeModel(textReply(GOOD));
    const service = make(model);
    await service.takeaway(sheet(), TEMPLATE);
    const spendBefore = service.status().spendUsd;
    const again = await service.takeaway(sheet(), TEMPLATE);
    expect(again.source).toBe('ai');
    expect(model.calls).toBe(1);
    const lines = logLines();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ cached: true, costUsd: 0, checkPassed: true });
    expect(service.status().cacheHits).toBe(1);
    expect(service.status().spendUsd).toBe(spendBefore);
  });

  it('the cache survives a restart', async () => {
    await make(new FakeModel(textReply(GOOD))).takeaway(sheet(), TEMPLATE);
    const second = new FakeModel(textReply(GOOD));
    const result = await make(second).takeaway(sheet(), TEMPLATE);
    expect(result).toEqual({ text: filled(sheet()), source: 'ai', reason: null });
    expect(second.calls).toBe(0);
  });

  describe('every failure falls back to the template', () => {
    const rawText = (text: string): Step => ({ kind: 'text', text, usage: { inputTokens: 1500, outputTokens: 300 } });
    const cases: Array<[string, Step, string, string, boolean | null]> = [
      ['unknown placeholder', textReply('Move from {nope.value}.'), 'check_failed', 'unknown_placeholder', false],
      ['stray digit', textReply('Move 5 now.'), 'check_failed', 'digit', false],
      ['number word', textReply('Move one budget.'), 'check_failed', 'number_word', false],
      ['off-sheet entity name', textReply('Move from Gamma.'), 'check_failed', 'off_sheet_name', false],
      ['too long', textReply('Move '.repeat(100)), 'check_failed', 'too_long', false],
      ['malformed JSON', rawText('not json'), 'malformed', 'malformed', false],
      ['cut-off JSON', rawText('{"takeaway":"Move bud'), 'malformed', 'malformed', false],
      ['wrong JSON shape', rawText('{"text":"x"}'), 'malformed', 'malformed', false],
      ['refusal', { kind: 'refusal', usage: { inputTokens: 1500, outputTokens: 300 } }, 'refusal', 'refusal', null],
    ];
    for (const [name, step, reason, failure, checkPassed] of cases) {
      it(name, async () => {
        const result = await make(new FakeModel(step)).takeaway(sheet(), TEMPLATE);
        expect(result).toEqual({ text: TEMPLATE, source: 'template', reason });
        const lines = logLines();
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ failure, checkPassed, cached: false, inputTokens: 1500, outputTokens: 300, costUsd: 0.0003 });
      });
    }

    it('timeout (the call is aborted)', async () => {
      const model = new FakeModel('hang');
      const result = await make(model, { timeoutMs: 20 }).takeaway(sheet(), TEMPLATE);
      expect(result).toEqual({ text: TEMPLATE, source: 'template', reason: 'timeout' });
      expect(model.sawAbort).toBe(true);
      expect(logLines()[0]).toMatchObject({ failure: 'timeout', checkPassed: null, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    });

    it('API error', async () => {
      const result = await make(new FakeModel(new ModelError('api_error', 'x'))).takeaway(sheet(), TEMPLATE);
      expect(result).toEqual({ text: TEMPLATE, source: 'template', reason: 'api_error' });
      expect(logLines()[0]).toMatchObject({ failure: 'api_error', checkPassed: null, costUsd: 0 });
    });

    it('an unknown kind of error is an api_error', async () => {
      const result = await make(new FakeModel(new TypeError('boom'))).takeaway(sheet(), TEMPLATE);
      expect(result.reason).toBe('api_error');
    });
  });

  describe('the spend guard', () => {
    it('a limit of 0 never calls the model and writes no log', async () => {
      const model = new FakeModel(textReply(GOOD));
      const result = await make(model, { limitUsd: 0 }).takeaway(sheet(), TEMPLATE);
      expect(result).toEqual({ text: TEMPLATE, source: 'template', reason: 'budget_reached' });
      expect(model.calls).toBe(0);
      expect(() => readFileSync(paths().logPath)).toThrow();
    });

    it('a limit equal to spend plus the worst case allows the call, one nano-dollar less blocks it', async () => {
      await make(new FakeModel(textReply(GOOD))).takeaway(sheet(1), TEMPLATE); // spends 300000 nano
      const next = sheet(2);
      const exact = (300000 + worst(next)) / 1e9;

      const blocked = new FakeModel(textReply(GOOD));
      const less = await make(blocked, { limitUsd: exact - 1 / 1e9 }).takeaway(next, TEMPLATE);
      expect(less.reason).toBe('budget_reached');
      expect(blocked.calls).toBe(0);

      const allowed = new FakeModel(textReply(GOOD));
      const equal = await make(allowed, { limitUsd: exact }).takeaway(next, TEMPLATE);
      expect(equal.source).toBe('ai');
      expect(allowed.calls).toBe(1);
    });

    it('concurrent different requests share the guard', async () => {
      const a = sheet(1);
      const b = sheet(2);
      const model = new FakeModel(textReply(GOOD));
      let open!: () => void;
      model.gate = new Promise<void>((resolve) => { open = resolve; });
      const service = make(model, { limitUsd: worst(a) / 1e9 });
      const first = service.takeaway(a, TEMPLATE);
      const second = service.takeaway(b, TEMPLATE);
      open();
      const results = await Promise.all([first, second]);
      expect(results.map((r) => r.reason).sort()).toEqual(['budget_reached', null]);
      expect(model.calls).toBe(1);
    });

    it('the reservation is released after the call', async () => {
      const a = sheet(1);
      const model = new FakeModel(textReply(GOOD));
      // Room for one worst-case call, and then only the real (much smaller) spend is counted.
      const service = make(model, { limitUsd: (worst(a) + worst(a) - 1) / 1e9 });
      await service.takeaway(a, TEMPLATE);
      expect((await service.takeaway(sheet(2), TEMPLATE)).source).toBe('ai');
    });
  });

  it('concurrent identical requests make one call', async () => {
    const model = new FakeModel(textReply(GOOD));
    let open!: () => void;
    model.gate = new Promise<void>((resolve) => { open = resolve; });
    const service = make(model);
    const first = service.takeaway(sheet(), TEMPLATE);
    const second = service.takeaway(sheet(), TEMPLATE);
    open();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a.source).toBe('ai');
    expect(model.calls).toBe(1);
    expect(logLines()).toHaveLength(1);
  });

  it('a failed check is remembered for the session only', async () => {
    const bad = textReply('Move 5 now.');
    const model = new FakeModel(bad);
    const service = make(model);
    await service.takeaway(sheet(), TEMPLATE);
    const again = await service.takeaway(sheet(), TEMPLATE);
    expect(again.reason).toBe('check_failed');
    expect(model.calls).toBe(1);
    expect(logLines()).toHaveLength(1);

    const fresh = new FakeModel(bad);
    await make(fresh).takeaway(sheet(), TEMPLATE);
    expect(fresh.calls).toBe(1);
  });

  it('a timeout is not remembered', async () => {
    const model = new FakeModel(new ModelError('timeout', 'x'));
    const service = make(model);
    await service.takeaway(sheet(), TEMPLATE);
    await service.takeaway(sheet(), TEMPLATE);
    expect(model.calls).toBe(2);
  });

  it('no facts gives no_facts with no call', async () => {
    const model = new FakeModel(textReply(GOOD));
    const result = await make(model).takeaway(makeFactSheet('campaigns', {}), TEMPLATE);
    expect(result).toEqual({ text: TEMPLATE, source: 'template', reason: 'no_facts' });
    expect(model.calls).toBe(0);
    expect(() => readFileSync(paths().logPath)).toThrow();
  });

  it('the key never leaks', async () => {
    const key = 'sk-ant-FAKEKEY-1234567890';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const model = new FakeModel(new Error(`401 invalid x-api-key ${key}`));
    const result = await make(model).takeaway(sheet(), TEMPLATE);
    expect(JSON.stringify(result)).not.toContain(key);
    expect(readFileSync(paths().logPath, 'utf8')).not.toContain(key);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(key);
  });

  describe('a log that is not usable', () => {
    it('an unreadable log turns AI off', async () => {
      mkdirSync(join(dir, 'logdir'));
      const model = new FakeModel(textReply(GOOD));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const service = make(model, { logPath: join(dir, 'logdir') });
      const result = await service.takeaway(sheet(), TEMPLATE);
      expect(result).toEqual({ text: TEMPLATE, source: 'template', reason: 'log_unavailable' });
      expect(service.status().status).toBe('off');
      expect(model.calls).toBe(0);
    });

    it('a log that fails to write after a paid call still returns that call, then AI is off', async () => {
      writeFileSync(join(dir, 'afile'), 'x');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const model = new FakeModel(textReply(GOOD));
      const service = make(model, { logPath: join(dir, 'afile', 'ai.jsonl') });
      expect((await service.takeaway(sheet(1), TEMPLATE)).source).toBe('ai');
      expect(service.status().status).toBe('off');
      expect((await service.takeaway(sheet(2), TEMPLATE)).reason).toBe('log_unavailable');
      expect(model.calls).toBe(1);
    });
  });

  it('a damaged cache file does not stop the service', async () => {
    writeFileSync(paths().cachePath, '{{{ garbage');
    const model = new FakeModel(textReply(GOOD));
    const result = await make(model).takeaway(sheet(), TEMPLATE);
    expect(result.source).toBe('ai');
    expect(model.calls).toBe(1);
  });

  describe('status', () => {
    it('is off with no model', () => {
      expect(make(null).status()).toEqual({ status: 'off', spendUsd: 0, cacheHits: 0, checkerFailures: 0 });
    });

    it('is on with room under the limit', () => {
      expect(make(new FakeModel(textReply(GOOD))).status().status).toBe('on');
    });

    it('is budget_reached when one more call could pass the limit', () => {
      expect(make(new FakeModel(textReply(GOOD)), { limitUsd: 0 }).status().status).toBe('budget_reached');
    });

    it('reads the counts back after a restart', async () => {
      const first = make(new FakeModel(textReply(GOOD)));
      await first.takeaway(sheet(), TEMPLATE);
      await first.takeaway(sheet(), TEMPLATE); // cache hit
      await first.takeaway(sheet(3), TEMPLATE); // spends again, same reply passes
      const bad = make(new FakeModel(textReply('Move 5.')));
      await bad.takeaway(sheet(4), TEMPLATE); // checker failure
      const restarted = make(new FakeModel(textReply(GOOD))).status();
      expect(restarted).toEqual({ status: 'on', spendUsd: 0.0009, cacheHits: 1, checkerFailures: 1 });
    });
  });

  it('offService answers with the template and an off status', async () => {
    const service = offService();
    expect(await service.takeaway(sheet(), TEMPLATE)).toEqual({ text: TEMPLATE, source: 'template', reason: 'ai_off' });
    expect(service.status()).toEqual({ status: 'off', spendUsd: 0, cacheHits: 0, checkerFailures: 0 });
  });
});
