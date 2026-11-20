// The takeaway service: ties the cache, the spend guard, the model, the checker and the call log together.
// Every failure ends in the template text; takeaway() never rejects.
import type { AiStatus } from '../server/api';
import { fillPlaceholders, type FactSheet } from '../core/views/facts';
import { appendLogLine, checkLogWritable, loadLog, type CallLogLine, type LogSummary } from './callLog';
import { cacheKey, questionCacheKey, TakeawayCache } from './cache';
import { checkTakeaway, type KnownNames } from './checker';
import { costNanoUsd, MAX_OUTPUT_TOKENS, nanoToUsd, worstCaseNanoUsd } from './pricing';
import { buildPrompt, parseReply, PROMPT_VERSION } from './prompt';
import { buildQuestionPrompt, parseFilterReply, QUESTION_PROMPT_VERSION, type FilterReply, type QuestionContext } from './question';
import {
  ModelError, type ModelReply, type QuestionReason, type TakeawayModel, type TakeawayReason, type TakeawayResult, type Usage,
} from './types';

/** What the caller's validator says about a model reply: a value, or a detail the user may read. */
export type Validation<T> = { ok: true; value: T } | { ok: false; detail: string };

export type InterpretResult<T> =
  | { ok: true; reply: FilterReply; value: T; cached: boolean }
  | { ok: false; reason: QuestionReason; detail: string | null };

export interface TakeawayService {
  takeaway(sheet: FactSheet, template: string): Promise<TakeawayResult>; // never rejects
  /** Turn a question into a validated filter. Never rejects. */
  interpret<T>(question: string, context: QuestionContext, validate: (reply: FilterReply) => Validation<T>): Promise<InterpretResult<T>>;
  status(): AiStatus;
  /** A service for new data (an upload) that shares this one's spend, reservations and log state, so the cap holds across the swap. */
  withData(known: KnownNames, snapshotId: string): TakeawayService;
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

/** What an unanswerable question is cached as: fixed, so nothing from the model's reply is ever saved. */
const UNANSWERABLE_REPLY: FilterReply = {
  answerable: false, view: 'overview', offices: [], campaigns: [], includeUnattributed: false, weekdays: [], hours: [], range: null,
};

const DEFAULT_TIMEOUT_MS = 8000;
const TYPICAL_PROMPT_CHARS = 4000; // for status(): "is there room for one more call?"

function templateResult(template: string, reason: TakeawayReason): TakeawayResult {
  return { text: template, source: 'template', reason };
}

export function offService(): TakeawayService {
  const service: TakeawayService = {
    takeaway: async (_sheet, template) => templateResult(template, 'ai_off'),
    interpret: async () => ({ ok: false, reason: 'ai_off', detail: null }),
    status: () => ({ status: 'off', spendUsd: 0, cacheHits: 0, checkerFailures: 0 }),
    withData: () => service,
  };
  return service;
}

/**
 * What every service built for the same app shares, so a rebuild for new data cannot forget a call still
 * running in the old service: the spend so far, the worst case of every call in flight, and whether the log works.
 */
interface Ledger {
  summary: LogSummary;
  reservedNano: number; // worst case of every call in flight
  logUsable: boolean;
}

export function createTakeawayService(options: ServiceOptions): TakeawayService {
  const { model, logPath } = options;
  // Spend comes from the log, so a log we cannot read means unknown spend: fail closed.
  const ledger: Ledger = { summary: { spendNanoUsd: 0, cacheHits: 0, checkerFailures: 0, skippedLines: 0 }, reservedNano: 0, logUsable: true };
  // A log we can read but not write is just as bad: a paid call would go unrecorded. Check before any call.
  if (logPath !== null) {
    try {
      ledger.summary = loadLog(logPath);
    } catch {
      ledger.logUsable = false;
      console.error('AI is off for this session: the call log cannot be read.');
    }
    if (ledger.logUsable && model !== null) { // with AI off nothing is ever appended
      try {
        checkLogWritable(logPath);
      } catch {
        ledger.logUsable = false;
        console.error('AI is off for this session: the call log cannot be written.');
      }
    }
  }
  if (ledger.summary.skippedLines > 0) console.error(`AI call log: ${ledger.summary.skippedLines} unreadable lines were skipped when adding up spend.`);
  return buildService(options, ledger);
}

function buildService(options: ServiceOptions, ledger: Ledger): TakeawayService {
  const { model, known, snapshotId, logPath } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const limitNano = Math.round(options.limitUsd * 1e9);
  const cache = new TakeawayCache(options.cachePath);

  const inFlight = new Map<string, Promise<unknown>>(); // takeaway and question calls share it; their keys never collide
  const rememberedFailures = new Map<string, TakeawayReason>(); // this session only; never timeouts or API errors
  const rememberedQuestionFailures = new Map<string, { reason: QuestionReason; detail: string | null }>(); // same rule

  /** Record a log line and keep the in-memory summary in step. A log that cannot be written turns AI off. */
  function record(line: CallLogLine): void {
    ledger.summary.spendNanoUsd += Math.round(line.costUsd * 1e9);
    if (line.cached) ledger.summary.cacheHits++;
    if (line.checkPassed === false) ledger.summary.checkerFailures++;
    if (logPath === null) return;
    try {
      appendLogLine(logPath, line);
    } catch {
      // Print on the change only: calls already in flight will also fail to write.
      if (ledger.logUsable) console.error('AI is off for this session: the call log cannot be written.');
      ledger.logUsable = false;
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

  function logLine(purpose: CallLogLine['purpose'], fields: Partial<CallLogLine>): CallLogLine {
    return {
      time: now().toISOString(), model: model?.id ?? '', purpose,
      inputTokens: 0, outputTokens: 0, costUsd: 0, cached: false, checkPassed: null, failure: null,
      ...fields,
    };
  }

  type Prompt = { system: string; user: string };
  type PaidFields = Pick<CallLogLine, 'inputTokens' | 'outputTokens' | 'costUsd'>;
  type CallOutcome =
    | { kind: 'error'; reason: 'timeout' | 'api_error' } // already logged
    | { kind: 'refusal' } // already logged
    | { kind: 'text'; text: string; paid: PaidFields }; // the caller checks it and logs

  function paidFields(modelId: string, usage: Usage): PaidFields {
    return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: nanoToUsd(costNanoUsd(modelId, usage)) };
  }

  /** The model call with its timeout. Errors and refusals are logged here; a text reply is the caller's to check and log. */
  async function callWithTimeout(activeModel: TakeawayModel, purpose: CallLogLine['purpose'], prompt: Prompt): Promise<CallOutcome> {
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
      const reason = error instanceof ModelError ? error.code : 'api_error';
      record(logLine(purpose, { failure: reason }));
      return { kind: 'error', reason };
    } finally {
      clearTimeout(timer);
    }

    const paid = paidFields(activeModel.id, reply.usage);
    if (reply.kind === 'refusal') {
      record(logLine(purpose, { ...paid, failure: 'refusal' }));
      return { kind: 'refusal' };
    }
    return { kind: 'text', text: reply.text, paid };
  }

  /**
   * The guard, shared by takeaways and questions: a duplicate shares the running call; a call that would
   * pass the limit is not made; otherwise its worst case is reserved until it finishes. There is no await
   * before the reservation and the in-flight entry are made, so two requests can never both pass the guard.
   */
  function guarded<R>(key: string, prompt: Prompt, overBudget: R, crashed: R, run: () => Promise<R>): R | Promise<R> {
    const running = inFlight.get(key) as Promise<R> | undefined;
    if (running) return running;

    const worstNano = worstCaseNanoUsd(model!.id, prompt.system.length + prompt.user.length);
    if (ledger.summary.spendNanoUsd + ledger.reservedNano + worstNano > limitNano) return overBudget;

    ledger.reservedNano += worstNano;
    const call = run()
      .catch(() => crashed)
      .finally(() => {
        ledger.reservedNano -= worstNano;
        inFlight.delete(key);
      });
    inFlight.set(key, call);
    return call;
  }

  /** The model call for a takeaway and the checks on its reply. The caller has already reserved the budget. */
  async function callModel(activeModel: TakeawayModel, key: string, sheet: FactSheet, template: string, prompt: Prompt): Promise<TakeawayResult> {
    const outcome = await callWithTimeout(activeModel, sheet.view, prompt);
    if (outcome.kind === 'error') return templateResult(template, outcome.reason);
    if (outcome.kind === 'refusal') {
      rememberedFailures.set(key, 'refusal');
      return templateResult(template, 'refusal');
    }

    // The call is paid for: whatever happens below, its line must be written. A throw counts as a failed check.
    const { paid } = outcome;
    let text: string | null;
    let check: ReturnType<typeof checkTakeaway> | null = null;
    let filled = '';
    try {
      text = parseReply(outcome.text);
      if (text !== null) {
        check = checkTakeaway(text, sheet, known);
        if (check.ok) filled = fillPlaceholders(text, sheet.facts);
      }
    } catch {
      record(logLine(sheet.view, { ...paid, checkPassed: false, failure: 'check_failed' }));
      rememberedFailures.set(key, 'check_failed');
      return templateResult(template, 'check_failed');
    }

    if (text === null || check === null) {
      record(logLine(sheet.view, { ...paid, checkPassed: false, failure: 'malformed' }));
      rememberedFailures.set(key, 'malformed');
      return templateResult(template, 'malformed');
    }
    if (!check.ok) {
      record(logLine(sheet.view, { ...paid, checkPassed: false, failure: check.reason }));
      rememberedFailures.set(key, 'check_failed');
      return templateResult(template, 'check_failed');
    }

    record(logLine(sheet.view, { ...paid, checkPassed: true }));
    if (!cache.set(key, text)) warnCacheNotSaved();
    return { text: filled, source: 'ai', reason: null };
  }

  /** The model call for a question and the checks on its reply. The caller has already reserved the budget. */
  async function askModel<T>(
    activeModel: TakeawayModel, key: string, prompt: Prompt, validate: (reply: FilterReply) => Validation<T>,
  ): Promise<InterpretResult<T>> {
    const remember = (reason: QuestionReason, detail: string | null): InterpretResult<T> => {
      rememberedQuestionFailures.set(key, { reason, detail });
      return { ok: false, reason, detail };
    };

    const outcome = await callWithTimeout(activeModel, 'question', prompt);
    if (outcome.kind === 'error') return { ok: false, reason: outcome.reason, detail: null };
    if (outcome.kind === 'refusal') return remember('refusal', null);

    // The call is paid for: whatever happens below, its line must be written. A throw counts as an invalid filter.
    const { paid } = outcome;
    let reply: FilterReply | null;
    let checked: Validation<T> | null = null;
    try {
      reply = parseFilterReply(outcome.text);
      if (reply !== null && reply.answerable) checked = validate(reply);
    } catch {
      record(logLine('question', { ...paid, checkPassed: false, failure: 'invalid_filter' }));
      return remember('invalid_filter', null);
    }
    if (reply === null) {
      record(logLine('question', { ...paid, checkPassed: false, failure: 'malformed' }));
      return remember('malformed', null);
    }

    if (!reply.answerable) {
      record(logLine('question', { ...paid, checkPassed: true }));
      // Fixed text, never the model's: its lists can hold words from the question.
      if (!cache.set(key, JSON.stringify(UNANSWERABLE_REPLY))) warnCacheNotSaved();
      return { ok: false, reason: 'unanswerable', detail: null };
    }

    if (checked === null || !checked.ok) {
      // The failure code is fixed: the detail can hold names from the reply and never goes in the log.
      record(logLine('question', { ...paid, checkPassed: false, failure: 'invalid_filter' }));
      return remember('invalid_filter', checked === null ? null : checked.detail);
    }

    record(logLine('question', { ...paid, checkPassed: true }));
    if (!cache.set(key, JSON.stringify(reply))) warnCacheNotSaved();
    return { ok: true, reply, value: checked.value, cached: false };
  }

  /** Steps 1 to 6 of the takeaway flow. Everything up to the guard is synchronous. */
  function decide(sheet: FactSheet, template: string): TakeawayResult | Promise<TakeawayResult> {
    if (model === null) return templateResult(template, 'ai_off');
    if (Object.keys(sheet.facts).length === 0) return templateResult(template, 'no_facts');
    if (!ledger.logUsable) return templateResult(template, 'log_unavailable');

    const key = cacheKey({ snapshotId, sheet, promptVersion: PROMPT_VERSION, model: model.id });

    // Remembered failures come first: a rejected cache entry is already deleted, and must not be asked about twice.
    const remembered = rememberedFailures.get(key);
    if (remembered !== undefined) return templateResult(template, remembered);

    // A cached text is checked on every hit: the file can be edited, and the known names or the checker may have changed.
    const cached = cache.get(key);
    if (cached !== undefined) {
      const check = checkTakeaway(cached, sheet, known);
      if (check.ok) {
        record(logLine(sheet.view, { cached: true, checkPassed: true }));
        return { text: fillPlaceholders(cached, sheet.facts), source: 'ai', reason: null };
      }
      // Not served, so not a hit: cached false, no tokens, no cost. The failure is the check's own reason.
      if (!cache.delete(key)) warnCacheNotSaved();
      rememberedFailures.set(key, 'check_failed');
      record(logLine(sheet.view, { checkPassed: false, failure: check.reason }));
      return templateResult(template, 'check_failed');
    }

    const prompt = buildPrompt(sheet);
    return guarded(key, prompt, templateResult(template, 'budget_reached'), templateResult(template, 'api_error'),
      () => callModel(model, key, sheet, template, prompt));
  }

  /** The same flow for a question. The cache holds the model's raw reply as JSON. */
  function decideQuestion<T>(
    question: string, context: QuestionContext, validate: (reply: FilterReply) => Validation<T>,
  ): InterpretResult<T> | Promise<InterpretResult<T>> {
    if (model === null) return { ok: false, reason: 'ai_off', detail: null };
    if (!ledger.logUsable) return { ok: false, reason: 'log_unavailable', detail: null };

    const key = questionCacheKey({ snapshotId, question, promptVersion: QUESTION_PROMPT_VERSION, model: model.id });

    const remembered = rememberedQuestionFailures.get(key);
    if (remembered !== undefined) return { ok: false, ...remembered };

    // A cached reply is parsed and validated on every hit: the file can be edited and the data can change.
    const cachedText = cache.get(key);
    if (cachedText !== undefined) {
      let reply: FilterReply | null = null;
      let checked: Validation<T> | null = null;
      try {
        reply = parseFilterReply(cachedText);
        if (reply !== null && !reply.answerable) {
          record(logLine('question', { cached: true, checkPassed: true }));
          return { ok: false, reason: 'unanswerable', detail: null };
        }
        if (reply !== null) checked = validate(reply);
      } catch {
        checked = null; // a throwing parse or validator is an invalid filter
      }
      if (reply !== null && checked !== null && checked.ok) {
        record(logLine('question', { cached: true, checkPassed: true }));
        return { ok: true, reply, value: checked.value, cached: true };
      }
      if (!cache.delete(key)) warnCacheNotSaved();
      // Text that no longer parses is malformed; a reply that parses but is no longer valid is invalid_filter.
      const reason = reply === null ? 'malformed' as const : 'invalid_filter' as const;
      const failure = { reason, detail: checked !== null && !checked.ok ? checked.detail : null };
      rememberedQuestionFailures.set(key, failure);
      record(logLine('question', { checkPassed: false, failure: reason }));
      return { ok: false, ...failure };
    }

    const prompt = buildQuestionPrompt(question, context);
    return guarded<InterpretResult<T>>(
      key, prompt,
      { ok: false, reason: 'budget_reached', detail: null },
      { ok: false, reason: 'api_error', detail: null },
      () => askModel(model, key, prompt, validate),
    );
  }

  return {
    async takeaway(sheet, template) {
      try {
        return await decide(sheet, template);
      } catch {
        return templateResult(template, 'api_error');
      }
    },

    async interpret(question, context, validate) {
      try {
        return await decideQuestion(question, context, validate);
      } catch {
        return { ok: false, reason: 'api_error', detail: null };
      }
    },

    withData(newKnown, newSnapshotId) {
      return buildService({ ...options, known: newKnown, snapshotId: newSnapshotId }, ledger);
    },

    status(): AiStatus {
      const { summary } = ledger;
      const counts = { spendUsd: nanoToUsd(summary.spendNanoUsd), cacheHits: summary.cacheHits, checkerFailures: summary.checkerFailures };
      if (model === null || !ledger.logUsable) return { status: 'off', ...counts };
      const oneMore = worstCaseNanoUsd(model.id, TYPICAL_PROMPT_CHARS);
      const reached = summary.spendNanoUsd + ledger.reservedNano + oneMore > limitNano;
      return { status: reached ? 'budget_reached' : 'on', ...counts };
    },
  };
}
