import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cacheKey, TakeawayCache } from '../../src/ai/cache';
import { makeFactSheet, type FactSheet } from '../../src/core/views/facts';
import { tempDir } from '../server/helpers';

function sheet(): FactSheet {
  return makeFactSheet('campaigns', {
    'shift.worst.name': { kind: 'name', value: 'Alpha' },
    'shift.worst.value': { kind: 'usd', value: 12 },
  });
}

function parts(overrides: Partial<Parameters<typeof cacheKey>[0]> = {}) {
  return { snapshotId: 'snap1', sheet: sheet(), promptVersion: 'v1', model: 'm1', ...overrides };
}

describe('cacheKey', () => {
  it('is stable for equal input', () => {
    expect(cacheKey(parts())).toBe(cacheKey(parts()));
    expect(cacheKey(parts())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on the key order in sheet.facts', () => {
    const a = sheet();
    const b: FactSheet = {
      ...a,
      facts: { 'shift.worst.value': { kind: 'usd', value: 12 }, 'shift.worst.name': { kind: 'name', value: 'Alpha' } },
    };
    expect(cacheKey(parts({ sheet: b }))).toBe(cacheKey(parts({ sheet: a })));
  });

  it('changes when snapshot, a fact value, an entity name, prompt version or model changes', () => {
    const base = cacheKey(parts());
    const changedValue = makeFactSheet('campaigns', {
      'shift.worst.name': { kind: 'name', value: 'Alpha' },
      'shift.worst.value': { kind: 'usd', value: 13 },
    });
    const changedName = makeFactSheet('campaigns', {
      'shift.worst.name': { kind: 'name', value: 'Beta' },
      'shift.worst.value': { kind: 'usd', value: 12 },
    });
    const keys = [
      cacheKey(parts({ snapshotId: 'snap2' })),
      cacheKey(parts({ sheet: changedValue })),
      cacheKey(parts({ sheet: changedName })),
      cacheKey(parts({ promptVersion: 'v2' })),
      cacheKey(parts({ model: 'm2' })),
    ];
    for (const key of keys) expect(key).not.toBe(base);
    expect(new Set([base, ...keys]).size).toBe(6);
  });
});

describe('TakeawayCache', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = tempDir();
    path = join(dir, 'ai-takeaways.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns what was set, and undefined for an unknown key', () => {
    const cache = new TakeawayCache(path);
    expect(cache.set('k', 'text {x}')).toBe(true);
    expect(cache.get('k')).toBe('text {x}');
    expect(cache.get('other')).toBeUndefined();
  });

  it('survives a restart', () => {
    new TakeawayCache(path).set('k', 'hello');
    const again = new TakeawayCache(path);
    expect(again.get('k')).toBe('hello');
    expect(again.loadProblem).toBeNull();
  });

  it('treats a missing file as empty with no problem', () => {
    const cache = new TakeawayCache(path);
    expect(cache.get('k')).toBeUndefined();
    expect(cache.loadProblem).toBeNull();
  });

  it('survives a damaged file without throwing', () => {
    for (const content of ['{not json', '[1,2]', '{"k":{"text":5,"createdAt":"x"}}']) {
      writeFileSync(path, content);
      const cache = new TakeawayCache(path);
      expect(cache.get('k')).toBeUndefined();
      expect(cache.loadProblem).toEqual(expect.any(String));
    }
  });

  it('keeps valid entries beside a bad one', () => {
    writeFileSync(path, JSON.stringify({
      good: { text: 'fine', createdAt: '2026-01-01T00:00:00Z' },
      bad: { text: 5, createdAt: 'x' },
    }));
    const cache = new TakeawayCache(path);
    expect(cache.get('good')).toBe('fine');
    expect(cache.get('bad')).toBeUndefined();
    expect(cache.loadProblem).toEqual(expect.any(String));
  });

  it('writes whole files: the cache file and no leftover temp file', () => {
    new TakeawayCache(path).set('k', 'v');
    expect(readdirSync(dir)).toEqual(['ai-takeaways.json']);
    expect(JSON.parse(readFileSync(path, 'utf8')).k.text).toBe('v');
  });

  it('returns false for an unwritable path and still answers from memory', () => {
    mkdirSync(path); // a folder where the file should go
    const cache = new TakeawayCache(path);
    expect(cache.set('k', 'v')).toBe(false);
    expect(cache.get('k')).toBe('v');
  });

  it('never touches the disk with a null path', () => {
    const cache = new TakeawayCache(null);
    expect(cache.set('k', 'v')).toBe(true);
    expect(cache.get('k')).toBe('v');
    expect(cache.loadProblem).toBeNull();
    expect(existsSync(path)).toBe(false);
  });
});
