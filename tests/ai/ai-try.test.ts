import { describe, expect, it, test } from 'vitest';
import { formatQuestionResult, formatTryResult, parseTryArgs, TRY_USAGE } from '../../scripts/tryArgs';

describe('parseTryArgs', () => {
  test('one view, default range all', () => {
    expect(parseTryArgs(['overview'])).toEqual({ views: ['overview'], range: 'all', questions: [] });
  });
  test('all gives the four views in order', () => {
    expect(parseTryArgs(['all', 'last7'])).toEqual({
      views: ['overview', 'campaigns', 'locations', 'missed-calls'],
      range: 'last7',
      questions: [],
    });
  });
  test('an unknown view lists the valid ones', () => {
    expect(() => parseTryArgs(['nope'])).toThrow(/overview, campaigns, locations, missed-calls, all/);
  });
  test('no argument gives the usage line', () => {
    expect(() => parseTryArgs([])).toThrow(TRY_USAGE);
  });
});

describe('parseTryArgs --question', () => {
  test('one question, no views', () => {
    expect(parseTryArgs(['--question', 'Which office misses the most calls?'])).toEqual({
      views: [],
      range: 'all',
      questions: ['Which office misses the most calls?'],
    });
  });
  test('the option may repeat, in order', () => {
    expect(parseTryArgs(['--question', 'a', '--question', 'b']).questions).toEqual(['a', 'b']);
  });
  test('a missing value, an empty one and a blank one are rejected', () => {
    expect(() => parseTryArgs(['--question'])).toThrow(/--question/);
    expect(() => parseTryArgs(['--question', ''])).toThrow(/--question/);
    expect(() => parseTryArgs(['--question', '   '])).toThrow(/--question/);
  });
  test('a question over 300 characters is rejected without echoing it', () => {
    const long = 'x'.repeat(301);
    expect(() => parseTryArgs(['--question', long])).toThrow(/300/);
    expect(() => parseTryArgs(['--question', long])).not.toThrow(/xxxxx/);
  });
  test('views and questions do not mix', () => {
    expect(() => parseTryArgs(['overview', '--question', 'a'])).toThrow(/--question/);
    expect(() => parseTryArgs(['--question', 'a', 'overview'])).toThrow(/--question/);
  });
  test('without the option there are no questions', () => {
    expect(parseTryArgs(['overview']).questions).toEqual([]);
  });
});

describe('formatQuestionResult', () => {
  it('prints the validated query and the cost, never the question', () => {
    const text = formatQuestionResult(2, { ok: true, cached: false, value: 'view=missed-calls&f_weekday=4' }, 0.000214);
    expect(text).toBe('\nquestion 2: ok cached=no cost=$0.000214\n  query: view=missed-calls&f_weekday=4');
  });
  it('a cache hit costs nothing', () => {
    expect(formatQuestionResult(1, { ok: true, cached: true, value: 'view=overview' }, 0)).toContain('cached=yes cost=$0.000000');
  });
  it('prints the failure reason and, when there is one, the detail', () => {
    expect(formatQuestionResult(3, { ok: false, reason: 'unanswerable', detail: null }, 0.0002)).toBe(
      '\nquestion 3: failed reason=unanswerable cost=$0.000200',
    );
    expect(formatQuestionResult(3, { ok: false, reason: 'invalid_filter', detail: 'No office is called "X".' }, 0)).toContain(
      '  detail: No office is called "X".',
    );
  });
});

describe('formatTryResult', () => {
  it('prints an AI takeaway', () => {
    const r = formatTryResult('overview', 200, { view: 'overview', text: 'Hello.', source: 'ai', reason: null });
    expect(r).toEqual({ ok: true, text: '\noverview: source=ai reason=-\nHello.' });
  });
  it('prints a template takeaway with its reason', () => {
    const r = formatTryResult('overview', 200, { view: 'overview', text: 'Tmpl.', source: 'template', reason: 'ai_off' });
    expect(r).toEqual({ ok: true, text: '\noverview: source=template reason=ai_off\nTmpl.' });
  });
  it('prints the error message for a 400, not source=undefined', () => {
    const r = formatTryResult('campaigns', 400, { error: { code: 'bad_param', message: 'Bad range.' } });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('campaigns: HTTP 400');
    expect(r.text).toContain('Bad range.');
    expect(r.text).not.toContain('undefined');
  });
});
