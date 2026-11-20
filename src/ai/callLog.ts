// The call log: one JSON line per model call. Spend, cache hits and checker failures are read back from it.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ViewName } from '../core/views/facts';

export interface CallLogLine {
  time: string; // ISO 8601 UTC
  model: string;
  purpose: ViewName;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cached: boolean;
  checkPassed: boolean | null; // null when no output was produced (timeout, API error)
  failure: string | null; // a CheckFailure, a TakeawayReason, or null; never an SDK message
}

export interface LogSummary {
  spendNanoUsd: number;
  cacheHits: number;
  checkerFailures: number;
  skippedLines: number;
}

/** The log can't be read or written. Callers must not treat this as zero spend. */
export class LogUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LogUnavailableError';
  }
}

export function appendLogLine(path: string, line: CallLogLine): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(line) + '\n');
  } catch {
    throw new LogUnavailableError('The AI call log cannot be written.');
  }
}

/**
 * Check at start that a line can be appended: open for append and close, adding nothing.
 * Creates the folder and, if missing, the empty file the first append would create anyway.
 */
export function checkLogWritable(path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    closeSync(openSync(path, 'a'));
  } catch {
    throw new LogUnavailableError('The AI call log cannot be written.');
  }
}

export function loadLog(path: string): LogSummary {
  const summary: LogSummary = { spendNanoUsd: 0, cacheHits: 0, checkerFailures: 0, skippedLines: 0 };
  let text: string;
  try {
    if (!existsSync(path)) return summary; // a first run is not an error
    text = readFileSync(path, 'utf8');
  } catch {
    throw new LogUnavailableError('The AI call log cannot be read.');
  }

  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    const parsed = parseLine(raw);
    if (parsed === null) {
      summary.skippedLines++;
      continue;
    }
    summary.spendNanoUsd += Math.round(parsed.costUsd * 1e9);
    if (parsed.cached === true) summary.cacheHits++;
    if (parsed.checkPassed === false) summary.checkerFailures++;
  }
  return summary;
}

/** The line as an object with a usable cost, or null if it is corrupt. */
function parseLine(raw: string): { costUsd: number; cached?: unknown; checkPassed?: unknown } | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const costUsd = (value as { costUsd?: unknown }).costUsd;
  if (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd < 0) return null;
  return value as { costUsd: number; cached?: unknown; checkPassed?: unknown };
}
