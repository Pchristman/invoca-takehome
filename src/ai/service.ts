// The takeaway service: ties the cache, the spend guard, the model, the checker and the call log together.
// Every failure ends in the template text; takeaway() never rejects.
import type { AiStatus } from '../server/api';
import { fillPlaceholders, type FactSheet } from '../core/views/facts';
import { appendLogLine, checkLogWritable, loadLog, type CallLogLine, type LogSummary } from './callLog';
import { cacheKey, TakeawayCache } from './cache';
import { checkTakeaway, type KnownNames } from './checker';
import { costNanoUsd, MAX_OUTPUT_TOKENS, nanoToUsd, worstCaseNanoUsd } from './pricing';
import { buildPrompt, parseReply, PROMPT_VERSION } from './prompt';
import { ModelError, type ModelReply, type TakeawayModel, type TakeawayReason, type TakeawayResult } from './types';

export interface TakeawayService {
  takeaway(sheet: FactSheet, template: string): Promise<TakeawayResult>; // never rejects
  status(): AiStatus;
}

export interface ServiceOptions {
  model: TakeawayModel | null; // null: AI off
  known: KnownNames;
  snapshotId: string;
  limitUsd: number;
  cachePath: string | null;
  logPath: string | null;
  timeoutMs?: number; // default 8000
  now?: () => Date;
}

const DEFAULT_TIMEOUT_MS = 8000;
const TYPICAL_PROMPT_CHARS = 4000; // for status(): "is there room for one more call?"

function templateResult(template: string, reason: TakeawayReason): TakeawayResult {
  return { text: template, source: 'template', reason };
}

export function offService(): TakeawayService {
  return {
    takeaway: async (_sheet, template) => templateResult(template, 'ai_off'),
    status: () => ({ status: 'off', spendUsd: 0, cacheHits: 0, checkerFailures: 0 }),
  };
}

export function createTakeawayService(options: ServiceOptions): TakeawayService {
  const { model, known, snapshotId, logPath } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const limitNano = Math.round(options.limitUsd * 1e9);
  const cache = new TakeawayCache(options.cachePath);

  // Spend comes from the log, so a log we cannot read means unknown spend: fail closed.
  let summary: LogSummary = { spendNanoUsd: 0, cacheHits: 0, checkerFailures: 0, skippedLines: 0 };
  let logUsable = true;
  // A log we can read but not write is just as bad: a paid call would go unrecorded. Check before any call.
  if (logPath !== null) {
    try {
      summary = loadLog(logPath);
    } catch {
      logUsable = false;
      console.error('AI is off for this session: the call log cannot be read.');
    }
    if (logUsable && model !== null) { // with AI off nothing is ever appended
      try {
        checkLogWritable(logPath);
      } catch {
        logUsable = false;
        console.error('AI is off for this session: the call log cannot be written.');
      }
    }
  }

  let reservedNano = 0; // worst case of every call in flight
  const inFlight = new Map<string, Promise<TakeawayResult>>();
  const rememberedFailures = new Map<string, TakeawayReason>(); // this session only; never timeouts or API errors

  /** Record a log line and keep the in-memory summary in step. A log that cannot be written turns AI off. */
  function record(line: CallLogLine): void {
    summary.spendNanoUsd += Math.round(line.costUsd * 1e9);
    if (line.cached) summary.cacheHits++;
    if (line.checkPassed === false) summary.checkerFailures++;
    if (logPath === null) return;
    try {
      appendLogLine(logPath, line);
    } catch {
      // Print on the change only: calls already in flight will also fail to write.
      if (logUsable) console.error('AI is off for this session: the call log cannot be written.');
      logUsable = false;
    }
  }

  let cacheWriteWarned = false;
  function warnCacheNotSaved(): void {
    if (cacheWriteWarned) return;
    cacheWriteWarned = true;
    console.error('AI takeaways could not be saved to the cache file; they are kept in memory for this session only.');
  }

  // Damage found at start-up: one line per kind, fixed text (counts only), never file contents.
  if (cache.loadProblem !== null) console.error(`AI cache problem: ${cache.loadProblem}`);
  if (summary.skippedLines > 0) console.error(`AI call log: ${summary.skippedLines} unreadable lines were skipped when adding up spend.`);

  function logLine(sheet: FactSheet, fields: Partial<CallLogLine>): CallLogLine {
    return {
      time: now().toISOString(), model: model?.id ?? '', purpose: sheet.view,
      inputTokens: 0, outputTokens: 0, costUsd: 0, cached: false, checkPassed: null, failure: null,
      ...fields,
    };
  }

  /** The model call and everything after it. The caller has already reserved the budget. */
  async function callModel(
    activeModel: TakeawayModel, key: string, sheet: FactSheet, template: string, prompt: { system: string; user: string },
  ): Promise<TakeawayResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ModelError('timeout', 'The model call timed out.'));
      }, timeoutMs);
    });

    let reply: ModelReply;
    try {
      reply = await Promise.race([
        activeModel.generate({ ...prompt, maxOutputTokens: MAX_OUTPUT_TOKENS, signal: controller.signal }),
        timedOut,
      ]);
    } catch (error) {
      // Only the code is kept: an SDK message can hold request details.
      const reason: TakeawayReason = error instanceof ModelError ? error.code : 'api_error';
      record(logLine(sheet, { failure: reason }));
      return templateResult(template, reason);
    } finally {
      clearTimeout(timer);
    }

    const costNano = costNanoUsd(activeModel.id, reply.usage);
    const paid = { inputTokens: reply.usage.inputTokens, outputTokens: reply.usage.outputTokens, costUsd: nanoToUsd(costNano) };

    if (reply.kind === 'refusal') {
      record(logLine(sheet, { ...paid, failure: 'refusal' }));
      rememberedFailures.set(key, 'refusal');
      return templateResult(template, 'refusal');
    }

    const text = parseReply(reply.text);
    if (text === null) {
      record(logLine(sheet, { ...paid, checkPassed: false, failure: 'malformed' }));
      rememberedFailures.set(key, 'malformed');
      return templateResult(template, 'malformed');
    }

    const check = checkTakeaway(text, sheet, known);
    if (!check.ok) {
      record(logLine(sheet, { ...paid, checkPassed: false, failure: check.reason }));
      rememberedFailures.set(key, 'check_failed');
      return templateResult(template, 'check_failed');
    }

    record(logLine(sheet, { ...paid, checkPassed: true }));
    if (!cache.set(key, text)) warnCacheNotSaved();
    return { text: fillPlaceholders(text, sheet.facts), source: 'ai', reason: null };
  }

  /**
   * Steps 1 to 6 of the flow. There is no await in here, so the reservation and the in-flight
   * entry are made before any other request can run: two requests can never both pass the guard.
   */
  function decide(sheet: FactSheet, template: string): TakeawayResult | Promise<TakeawayResult> {
    if (model === null) return templateResult(template, 'ai_off');
    if (Object.keys(sheet.facts).length === 0) return templateResult(template, 'no_facts');
    if (!logUsable) return templateResult(template, 'log_unavailable');

    const key = cacheKey({ snapshotId, sheet, promptVersion: PROMPT_VERSION, model: model.id });

    // Remembered failures come first: a rejected cache entry is already deleted, and must not be asked about twice.
    const remembered = rememberedFailures.get(key);
    if (remembered !== undefined) return templateResult(template, remembered);

    // A cached text is checked on every hit: the file can be edited, and the known names or the checker may have changed.
    const cached = cache.get(key);
    if (cached !== undefined) {
      const check = checkTakeaway(cached, sheet, known);
      if (check.ok) {
        record(logLine(sheet, { cached: true, checkPassed: true }));
        return { text: fillPlaceholders(cached, sheet.facts), source: 'ai', reason: null };
      }
      // Not served, so not a hit: cached false, no tokens, no cost. The failure is the check's own reason.
      if (!cache.delete(key)) warnCacheNotSaved();
      rememberedFailures.set(key, 'check_failed');
      record(logLine(sheet, { checkPassed: false, failure: check.reason }));
      return templateResult(template, 'check_failed');
    }

    const running = inFlight.get(key);
    if (running) return running;

    const prompt = buildPrompt(sheet);
    const worstNano = worstCaseNanoUsd(model.id, prompt.system.length + prompt.user.length);
    if (summary.spendNanoUsd + reservedNano + worstNano > limitNano) return templateResult(template, 'budget_reached');

    reservedNano += worstNano;
    const call = callModel(model, key, sheet, template, prompt)
      .catch(() => templateResult(template, 'api_error'))
      .finally(() => {
        reservedNano -= worstNano;
        inFlight.delete(key);
      });
    inFlight.set(key, call);
    return call;
  }

  return {
    async takeaway(sheet, template) {
      try {
        return await decide(sheet, template);
      } catch {
        return templateResult(template, 'api_error');
      }
    },

    status(): AiStatus {
      const counts = { spendUsd: nanoToUsd(summary.spendNanoUsd), cacheHits: summary.cacheHits, checkerFailures: summary.checkerFailures };
      if (model === null || !logUsable) return { status: 'off', ...counts };
      const oneMore = worstCaseNanoUsd(model.id, TYPICAL_PROMPT_CHARS);
      const reached = summary.spendNanoUsd + reservedNano + oneMore > limitNano;
      return { status: reached ? 'budget_reached' : 'on', ...counts };
    },
  };
}
