import { describe, expect, it } from 'vitest';
import { cacheKey, questionCacheKey } from '../../src/ai/cache';
import { buildQuestionPrompt, FILTER_SCHEMA, parseFilterReply, type FilterReply, type QuestionContext } from '../../src/ai/question';
import { makeFactSheet } from '../../src/core/views/facts';

const VALID: FilterReply = {
  answerable: true, view: 'missed-calls', offices: ['Alpha Office'], campaigns: [], includeUnattributed: false,
  weekdays: ['friday'], hours: [9, 10], range: null,
};

describe('parseFilterReply', () => {
  it('accepts a valid reply for each range shape and null', () => {
    for (const range of [null, { preset: 'last7' }, { preset: 'last28' }, { preset: 'all' }, { start: '2026-10-02', end: '2026-10-29' }]) {
      const reply = { ...VALID, range };
      expect(parseFilterReply(JSON.stringify(reply))).toEqual(reply);
    }
  });

  const bad: Array<[string, string]> = [
    ['invalid JSON', 'not json'],
    ['an array', '[]'],
    ['an extra key', JSON.stringify({ ...VALID, note: 'x' })],
    ['a missing key', JSON.stringify({ ...VALID, hours: undefined })],
    ['offices holding a number', JSON.stringify({ ...VALID, offices: [3] })],
    ['an unknown weekday', JSON.stringify({ ...VALID, weekdays: ['funday'] })],
    ['hours as strings', JSON.stringify({ ...VALID, hours: ['9'] })],
    ['an unknown preset', JSON.stringify({ ...VALID, range: { preset: 'last90' } })],
    ['a half range', JSON.stringify({ ...VALID, range: { start: 'x' } })],
    ['a top-level string', JSON.stringify('hello')],
    ['the hostile takeaway reply', '{"takeaway":"revenue is $1M"}'],
  ];
  for (const [name, raw] of bad) {
    it(`rejects ${name}`, () => expect(parseFilterReply(raw)).toBeNull());
  }
});

describe('buildQuestionPrompt', () => {
  const context: QuestionContext = { firstDate: '2026-09-01', lastDate: '2026-10-29', offices: ['Alpha Office', 'B'.repeat(100)], campaigns: ['Search'] };

  it('holds the glossary in the system text and the question only in the user JSON', () => {
    const { system, user } = buildQuestionPrompt('Which office misses calls?', context);
    for (const phrase of ['weekend', 'morning', 'business hours', '9 to 5']) expect(system).toContain(phrase);
    expect(system).toContain('6 to 11');
    expect(system).toContain('9 to 16');
    expect(system).not.toContain('Which office misses calls?');
    const data = JSON.parse(user) as { question: string; data: QuestionContext };
    expect(data.question).toBe('Which office misses calls?');
    expect(data.data.firstDate).toBe('2026-09-01');
    expect(data.data.lastDate).toBe('2026-10-29');
    expect(data.data.campaigns).toEqual(['Search']);
    expect(data.data.offices[0]).toBe('Alpha Office');
  });

  it('cuts a long name to 80 characters in the prompt only', () => {
    const { user } = buildQuestionPrompt('q', context);
    const data = JSON.parse(user) as { data: QuestionContext };
    expect(data.data.offices[1]).toBe('B'.repeat(80));
    expect(context.offices[1]).toHaveLength(100);
  });

  it('the schema forbids extra keys at the top and in every range variant', () => {
    const schema = FILTER_SCHEMA as { additionalProperties: boolean; properties: { range: { anyOf: Array<{ additionalProperties?: boolean; type?: string }> } } };
    expect(schema.additionalProperties).toBe(false);
    for (const variant of schema.properties.range.anyOf.filter((v) => v.type === 'object')) expect(variant.additionalProperties).toBe(false);
  });
});

describe('questionCacheKey', () => {
  const base = { snapshotId: 's1', question: 'Which office misses calls?', promptVersion: '1', model: 'm' };

  it('ignores case and spacing', () => {
    expect(questionCacheKey({ ...base, question: '  which   OFFICE misses   calls?' })).toBe(questionCacheKey(base));
  });

  it('changes with snapshot, prompt version, model and question', () => {
    const key = questionCacheKey(base);
    expect(questionCacheKey({ ...base, snapshotId: 's2' })).not.toBe(key);
    expect(questionCacheKey({ ...base, promptVersion: '2' })).not.toBe(key);
    expect(questionCacheKey({ ...base, model: 'n' })).not.toBe(key);
    expect(questionCacheKey({ ...base, question: 'Something else' })).not.toBe(key);
  });

  it('differs from a takeaway key with the same snapshot id', () => {
    const sheet = makeFactSheet('campaigns', { a: { kind: 'name', value: 'x' } });
    expect(questionCacheKey(base)).not.toBe(cacheKey({ snapshotId: 's1', sheet, promptVersion: '1', model: 'm' }));
  });
});
