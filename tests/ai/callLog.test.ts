import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendLogLine, loadLog, LogUnavailableError, type CallLogLine } from '../../src/ai/callLog';
import { tempDir } from '../server/helpers';

function line(overrides: Partial<CallLogLine> = {}): CallLogLine {
  return {
    time: '2026-09-01T12:00:00.000Z',
    model: 'test-model',
    purpose: 'overview',
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.0003,
    cached: false,
    checkPassed: true,
    failure: null,
    ...overrides,
  };
}

describe('call log', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = tempDir();
    path = join(dir, 'logs', 'ai-calls.jsonl');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('append writes one valid JSON line with every field', () => {
    const first = line();
    appendLogLine(path, first);
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual(first);

    appendLogLine(path, line({ cached: true }));
    expect(readFileSync(path, 'utf8').trimEnd().split('\n')).toHaveLength(2);
  });

  it('loadLog on a missing file is all zeros', () => {
    expect(loadLog(path)).toEqual({ spendNanoUsd: 0, cacheHits: 0, checkerFailures: 0, skippedLines: 0 });
  });

  it('loadLog sums cost exactly', () => {
    for (let i = 0; i < 3; i++) appendLogLine(path, line({ costUsd: 0.0003 }));
    expect(loadLog(path).spendNanoUsd).toBe(900000);
  });

  it('counts cache hits and checker failures', () => {
    appendLogLine(path, line({ cached: true, costUsd: 0 }));
    appendLogLine(path, line({ checkPassed: false, failure: 'off_sheet_number' }));
    appendLogLine(path, line({ checkPassed: null, failure: 'timeout' }));
    appendLogLine(path, line());
    const summary = loadLog(path);
    expect(summary.cacheHits).toBe(1);
    expect(summary.checkerFailures).toBe(1);
    expect(summary.skippedLines).toBe(0);
  });

  it('a corrupt line is skipped and counted', () => {
    appendLogLine(path, line());
    const { costUsd: _omitted, ...noCost } = line();
    const bad = [
      JSON.stringify(line()).slice(0, 30), // cut off
      'this is not json',
      JSON.stringify(noCost), // missing costUsd
      JSON.stringify(line({ costUsd: -0.5 })), // negative
      '{"costUsd":null}', // what JSON.stringify makes of NaN
      '', // blank: ignored, not counted
    ];
    appendFileSync(path, bad.join('\n') + '\n');
    appendLogLine(path, line());
    const summary = loadLog(path);
    expect(summary.spendNanoUsd).toBe(600000);
    expect(summary.skippedLines).toBe(5);
  });

  it('an unreadable log is not zero spend', () => {
    mkdirSync(path, { recursive: true }); // the log path is a directory
    expect(() => loadLog(path)).toThrow(LogUnavailableError);
    expect(() => appendLogLine(path, line())).toThrow(LogUnavailableError);
    expect(existsSync(path)).toBe(true);
  });
});
