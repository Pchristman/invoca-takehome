import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPrompt, REPLY_SCHEMA } from '../../src/ai/prompt';
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

  it('asks the model for the takeaway shape', async () => {
    const model = new FakeModel(textReply(GOOD));
    await make(model).takeaway(sheet(), TEMPLATE);
    expect(model.requests[0]!.schema).toBe(REPLY_SCHEMA);
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
      ['cut off at max_tokens', { kind: 'truncated', usage: { inputTokens: 1500, outputTokens: 300 } }, 'malformed', 'truncated', false],
      ['refusal', { kind: 'refusal', usage: { inputTokens: 1500, outputTokens: 300 } }, 'refusal', 'refusal', null],
    ];
    for (const [name, step, reason, failure, checkPassed] of cases) {
      it(name, async () => {
        const result = await make(new FakeModel(step)).takeaway(sheet(), TEMPLATE);
        expect(result).toEqual({ text: TEMPLATE, source: 'template', reason });
        const lines = logLines();
        // A checker rejection is retried once (the fake repeats its reply); every other failure is not.
        expect(lines).toHaveLength(reason === 'check_failed' ? 2 : 1);
        for (const line of lines) {
          expect(line).toMatchObject({ failure, checkPassed, cached: false, inputTokens: 1500, outputTokens: 300, costUsd: 0.0003 });
        }
      });
    }

    it('timeout (the call is aborted)', async () => {
      const model = new FakeModel('hang');
      const result = await make(model, { timeoutMs: 20 }).takeaway(sheet(), TEMPLATE);
      expect(result).toEqual({ text: TEMPLATE, source: 'template', reason: 'timeout' });
      expect(model.sawAbort).toBe(true);
      // An aborted request may still be billed, so a timeout is logged at the worst case that was reserved for it.
      expect(logLines()[0]).toMatchObject({ failure: 'timeout', checkPassed: null, inputTokens: 0, outputTokens: 0, costUsd: worst(sheet()) / 1e9 });
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
      expect(readFileSync(paths().logPath, 'utf8')).toBe(''); // only the empty file made at start
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
    expect(model.calls).toBe(2); // the first call and its one retry
    expect(logLines()).toHaveLength(2);

    const fresh = new FakeModel(bad);
    await make(fresh).takeaway(sheet(), TEMPLATE);
    expect(fresh.calls).toBe(2);
  });

  describe('a takeaway the checker rejects is retried once with the reason', () => {
    const FIRST = textReply('Call those callers back first.');
    const DETAIL = 'The text contains the number word "first"';

    it('reject then pass: the retry is shown, both calls are logged', async () => {
      const model = new FakeModel(FIRST, textReply(GOOD));
      const result = await make(model).takeaway(sheet(), TEMPLATE);
      expect(result).toEqual({ text: filled(sheet()), source: 'ai', reason: null });
      expect(model.calls).toBe(2);
      const lines = logLines();
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({ checkPassed: false, failure: 'number_word', costUsd: 0.0003 });
      expect(lines[1]).toMatchObject({ checkPassed: true, failure: null, costUsd: 0.0003 });
    });

    it('the retry prompt carries the checker detail; the first does not; nothing else changes', async () => {
      const model = new FakeModel(FIRST, textReply(GOOD));
      await make(model).takeaway(sheet(), TEMPLATE);
      const [first, retry] = model.requests;
      expect(first!.system).not.toContain(DETAIL);
      expect(retry!.system).toBe(`${first!.system}\nYour last answer was rejected: ${DETAIL}. Write the takeaway again without that.`);
      expect(retry!.user).toBe(first!.user);
      expect(retry!.schema).toBe(REPLY_SCHEMA);
    });

    it('reject then reject: template check_failed, remembered, no third call', async () => {
      const model = new FakeModel(FIRST, textReply('Move 5 now.'), textReply(GOOD));
      const service = make(model);
      expect(await service.takeaway(sheet(), TEMPLATE)).toEqual({ text: TEMPLATE, source: 'template', reason: 'check_failed' });
      expect(model.calls).toBe(2);
      expect(await service.takeaway(sheet(), TEMPLATE)).toMatchObject({ reason: 'check_failed' });
      expect(model.calls).toBe(2);
      expect(logLines().map((l) => l.checkPassed)).toEqual([false, false]);
    });

    it('no retry when it could pass the spend limit', async () => {
      const model = new FakeModel(FIRST, textReply(GOOD));
      // Room for the first call's worst case only: the retry's check counts that reservation and the retry's own worst case.
      const result = await make(model, { limitUsd: worst(sheet()) / 1e9 }).takeaway(sheet(), TEMPLATE);
      expect(result).toEqual({ text: TEMPLATE, source: 'template', reason: 'check_failed' });
      expect(model.calls).toBe(1);
      expect(logLines()).toHaveLength(1);
    });

    it.each([
      ['malformed', { kind: 'text', text: 'not json', usage: { inputTokens: 1500, outputTokens: 300 } } as Step, {}, 'malformed'],
      ['timeout', 'hang' as Step, { timeoutMs: 20 }, 'timeout'],
    ])('no retry after %s', async (_name, step, extra, reason) => {
      const model = new FakeModel(step, textReply(GOOD));
      const result = await make(model, extra).takeaway(sheet(), TEMPLATE);
      expect(result.reason).toBe(reason);
      expect(model.calls).toBe(1);
    });

    it('two simultaneous requests share the one flow, retry included', async () => {
      const model = new FakeModel(FIRST, textReply(GOOD));
      let open!: () => void;
      model.gate = new Promise<void>((resolve) => { open = resolve; });
      const service = make(model);
      const a = service.takeaway(sheet(), TEMPLATE);
      const b = service.takeaway(sheet(), TEMPLATE);
      open();
      const results = await Promise.all([a, b]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]!.source).toBe('ai');
      expect(model.calls).toBe(2);
    });
  });

  it('a timeout is remembered: the same takeaway is not sent again this session, another one still is', async () => {
    const model = new FakeModel(new ModelError('timeout', 'x'));
    const service = make(model);
    await service.takeaway(sheet(), TEMPLATE);
    expect(await service.takeaway(sheet(), TEMPLATE)).toEqual({ text: TEMPLATE, source: 'template', reason: 'timeout' });
    expect(model.calls).toBe(1);
    expect(logLines()).toHaveLength(1);
    await service.takeaway(sheet(2), TEMPLATE);
    expect(model.calls).toBe(2);
  });

  it('an API error is not remembered', async () => {
    const model = new FakeModel(new ModelError('api_error', 'x'));
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
    expect(readFileSync(paths().logPath, 'utf8')).toBe(''); // only the empty file made at start
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

    it('a log that cannot be appended to at start turns AI off before any paid call', async () => {
      mkdirSync(join(dir, 'logs'));
      const readOnly = paths().logPath;
      writeFileSync(readOnly, '');
      chmodSync(readOnly, 0o444); // readable, not writable
      // A directory in place of the file is unwritable on every platform (and as root): the same case.
      const dirAsLog = join(dir, 'logs', 'dir-as-log.jsonl');
      mkdirSync(dirAsLog);
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      for (const path of [readOnly, dirAsLog]) {
        const model = new FakeModel(textReply(GOOD));
        const service = make(model, { logPath: path });
        expect(service.status().status).toBe('off');
        expect(await service.takeaway(sheet(), TEMPLATE)).toEqual({ text: TEMPLATE, source: 'template', reason: 'log_unavailable' });
        expect(model.calls).toBe(0);
      }
      expect(JSON.stringify(spy.mock.calls)).toContain('cannot be written');
      chmodSync(readOnly, 0o644);
    });

    it('a log that is writable at start leaves only the empty file and prints nothing', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(make(new FakeModel(textReply(GOOD))).status().status).toBe('on');
      expect(readFileSync(paths().logPath, 'utf8')).toBe('');
      expect(spy).not.toHaveBeenCalled();
    });

    it('no model means no probe and no log file', () => {
      make(null);
      expect(existsSync(paths().logPath)).toBe(false);
    });

    it('a log that fails to write after a paid call still returns that call, then AI is off', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const model = new FakeModel(textReply(GOOD));
      const service = make(model);
      rmSync(paths().logPath); // after start: a directory takes the file's place
      mkdirSync(paths().logPath);
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

  describe('the reservation is released after every kind of failure', () => {
    const oneMoreCall = (spentNano: number) => (spentNano + worst(sheet(1))) / 1e9;
    const cases: Array<[string, Step, number, Partial<ServiceOptions>]> = [
      ['a timeout', 'hang', worst(sheet(1)), { timeoutMs: 20 }],
      ['an API error', new ModelError('api_error', 'x'), 0, {}],
      ['a refusal', { kind: 'refusal', usage: { inputTokens: 1500, outputTokens: 300 } }, 300000, {}],
      ['a failed check', textReply('Move 5 now.'), 300000, {}],
    ];
    for (const [name, step, spent, extra] of cases) {
      it(`a second different sheet still fits after ${name}`, async () => {
        const model = new FakeModel(step);
        const service = make(model, { limitUsd: oneMoreCall(spent), ...extra });
        await service.takeaway(sheet(1), TEMPLATE);
        const second = await service.takeaway(sheet(2), TEMPLATE);
        expect(second.reason).not.toBe('budget_reached');
        expect(model.calls).toBe(2);
      });
    }
  });

  describe('damage is reported once', () => {
    function errors(spy: ReturnType<typeof vi.spyOn>): string[] {
      return spy.mock.calls.map((c: unknown[]) => String(c[0]));
    }

    it('a damaged cache file prints one line at creation', () => {
      writeFileSync(paths().cachePath, '{{{ garbage');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      make(new FakeModel(textReply(GOOD)));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(errors(spy)[0]).toContain('cache');
      expect(errors(spy)[0]).not.toContain('garbage');
    });

    it('skipped log lines print one line with the count', async () => {
      await make(new FakeModel(textReply(GOOD))).takeaway(sheet(), TEMPLATE);
      writeFileSync(paths().logPath, readFileSync(paths().logPath, 'utf8') + 'not json\n{"costUsd":"x"}\n');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      make(new FakeModel(textReply(GOOD)));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(errors(spy)[0]).toContain('2');
      expect(errors(spy)[0]).not.toContain('not json');
    });

    it('a clean start prints nothing', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      make(new FakeModel(textReply(GOOD)));
      expect(spy).not.toHaveBeenCalled();
    });

    it('a cache that cannot be written prints once, the first time only', async () => {
      mkdirSync(paths().cachePath); // a folder where the file should go: unreadable at load, unwritable on save
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const service = make(new FakeModel(textReply(GOOD)));
      const atCreation = spy.mock.calls.length; // the load problem
      await service.takeaway(sheet(1), TEMPLATE);
      await service.takeaway(sheet(2), TEMPLATE);
      expect(spy.mock.calls.length - atCreation).toBe(1);
      expect(errors(spy).at(-1)).toContain('saved');
    });
  });

  describe('a log that breaks while calls are in flight', () => {
    it('prints exactly one line', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const model = new FakeModel(textReply(GOOD));
      let open!: () => void;
      model.gate = new Promise<void>((resolve) => { open = resolve; });
      const service = make(model);
      rmSync(paths().logPath); // breaks after a clean start
      mkdirSync(paths().logPath);
      const first = service.takeaway(sheet(1), TEMPLATE);
      const second = service.takeaway(sheet(2), TEMPLATE);
      open();
      await Promise.all([first, second]);
      expect(model.calls).toBe(2);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('status', () => {
    const typicalWorst = worstCaseNanoUsd(MODEL_ID, 4000);

    it('is budget_reached only because logged spend leaves no room for one more call', async () => {
      await make(new FakeModel(textReply(GOOD))).takeaway(sheet(), TEMPLATE); // logs 300000 nano
      const limitUsd = (300000 + typicalWorst - 1) / 1e9;
      expect(make(new FakeModel(textReply(GOOD)), { limitUsd }).status().status).toBe('budget_reached');
    });

    it('is on when logged spend leaves room for exactly one more call', async () => {
      await make(new FakeModel(textReply(GOOD))).takeaway(sheet(), TEMPLATE);
      const limitUsd = (300000 + typicalWorst) / 1e9;
      expect(make(new FakeModel(textReply(GOOD)), { limitUsd }).status().status).toBe('on');
    });

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
      await bad.takeaway(sheet(4), TEMPLATE); // checker failure, then its retry fails too
      const restarted = make(new FakeModel(textReply(GOOD))).status();
      expect(restarted).toEqual({ status: 'on', spendUsd: 0.0012, cacheHits: 1, checkerFailures: 2 });
    });
  });

  describe('a cached entry is checked on every hit', () => {
    async function tamperedService(model: FakeModel) {
      await make(new FakeModel(textReply(GOOD))).takeaway(sheet(), TEMPLATE); // fills the cache file
      const file = JSON.parse(readFileSync(paths().cachePath, 'utf8')) as Record<string, { text: string }>;
      for (const entry of Object.values(file)) entry.text = 'Gamma made 999 more bookings than {shift.worst.name}.';
      writeFileSync(paths().cachePath, JSON.stringify(file));
      return make(model);
    }

    it('a tampered entry is not served: template, no model call, logged as a check failure', async () => {
      const model = new FakeModel(textReply(GOOD));
      const service = await tamperedService(model);
      const result = await service.takeaway(sheet(), TEMPLATE);
      expect(result).toEqual({ text: TEMPLATE, source: 'template', reason: 'check_failed' });
      expect(model.calls).toBe(0);
      const last = logLines().at(-1)!;
      expect(last).toMatchObject({ checkPassed: false, cached: false, costUsd: 0, inputTokens: 0, outputTokens: 0 });
      expect(typeof last.failure).toBe('string');
      expect(last.failure).not.toBe('check_failed');
      expect(service.status().cacheHits).toBe(0);
      expect(service.status().checkerFailures).toBe(2 - 1); // only the rejected entry (the first call passed)
    });

    it('the bad entry is dropped from the cache file and remembered for the session', async () => {
      const model = new FakeModel(textReply(GOOD));
      const service = await tamperedService(model);
      await service.takeaway(sheet(), TEMPLATE);
      expect(JSON.parse(readFileSync(paths().cachePath, 'utf8'))).toEqual({});
      const again = await service.takeaway(sheet(), TEMPLATE);
      expect(again.reason).toBe('check_failed');
      expect(model.calls).toBe(0);
    });
  });

  it('a check or fill that throws after the paid call: template, check_failed, paid line logged, remembered', async () => {
    // The facts read fine until the model has answered, then every read throws.
    let armed = false;
    const base = sheet();
    const exploding: FactSheet = {
      ...base,
      facts: new Proxy(base.facts, {
        get(target, prop, receiver) {
          if (armed) throw new Error('facts blew up');
          return Reflect.get(target, prop, receiver) as unknown;
        },
      }),
    };
    const inner = new FakeModel(textReply(GOOD));
    const model = Object.assign(Object.create(inner) as FakeModel, {
      generate: async (request: Parameters<FakeModel['generate']>[0]) => {
        const reply = await inner.generate(request);
        armed = true;
        return reply;
      },
    });
    const service = make(model);
    expect(await service.takeaway(exploding, TEMPLATE)).toEqual({ text: TEMPLATE, source: 'template', reason: 'check_failed' });
    const lines = logLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ inputTokens: 1500, outputTokens: 300, costUsd: 0.0003, checkPassed: false, failure: 'check_failed' });
    expect(service.status().spendUsd).toBe(0.0003);
    armed = false;
    expect(await service.takeaway(exploding, TEMPLATE)).toMatchObject({ reason: 'check_failed' });
    expect(inner.calls).toBe(1);
  });

  it('offService answers with the template and an off status', async () => {
    const service = offService();
    expect(await service.takeaway(sheet(), TEMPLATE)).toEqual({ text: TEMPLATE, source: 'template', reason: 'ai_off' });
    expect(service.status()).toEqual({ status: 'off', spendUsd: 0, cacheHits: 0, checkerFailures: 0 });
  });
});

describe('a service rebuilt for new data shares the spend ledger', () => {
  const known = { campaigns: ['Alpha'], offices: ['Office A'], channels: CHANNELS };

  it('counts the old service\'s in-flight reservation, then its logged cost', async () => {
    const a = sheet(1);
    const model = new FakeModel(textReply(GOOD));
    let open!: () => void;
    model.gate = new Promise<void>((resolve) => { open = resolve; });
    const old = make(model, { limitUsd: worst(a) / 1e9 }); // room for exactly one worst-case call
    const running = old.takeaway(a, TEMPLATE);
    const rebuilt = old.withData(known, 'snap2');

    expect((await rebuilt.takeaway(sheet(2), TEMPLATE)).reason).toBe('budget_reached');
    expect(model.calls).toBe(1);

    open();
    await running;
    expect(old.status().spendUsd).toBeGreaterThan(0);
    expect(rebuilt.status().spendUsd).toBe(old.status().spendUsd);
  });

  it('the off service rebuilds to itself', () => {
    expect(offService().withData(known, 'x').status().status).toBe('off');
  });
});

describe('the cache across a rebuild for new data', () => {
  it('is one cache: a call still running in the old service does not overwrite what the new one saved', async () => {
    const model = new FakeModel(textReply(GOOD));
    let open!: () => void;
    model.gate = new Promise<void>((resolve) => { open = resolve; });
    const old = make(model);
    const running = old.takeaway(sheet(1), TEMPLATE);
    const rebuilt = old.withData({ campaigns: ['Alpha'], offices: ['Office A'], channels: CHANNELS }, 'snap2');
    const second = rebuilt.takeaway(sheet(2), TEMPLATE);
    open();
    await Promise.all([running, second]);
    expect(Object.keys(JSON.parse(readFileSync(paths().cachePath, 'utf8')))).toHaveLength(2);
    expect((await rebuilt.takeaway(sheet(2), TEMPLATE)).source).toBe('ai');
    expect(model.calls).toBe(2);
  });
});
