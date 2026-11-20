import { describe, expect, it, test } from 'vitest';
import { formatTryResult, parseTryArgs, TRY_USAGE } from '../../scripts/tryArgs';

describe('parseTryArgs', () => {
  test('one view, default range all', () => {
    expect(parseTryArgs(['overview'])).toEqual({ views: ['overview'], range: 'all' });
  });
  test('all gives the four views in order', () => {
    expect(parseTryArgs(['all', 'last7'])).toEqual({
      views: ['overview', 'campaigns', 'locations', 'missed-calls'],
      range: 'last7',
    });
  });
  test('an unknown view lists the valid ones', () => {
    expect(() => parseTryArgs(['nope'])).toThrow(/overview, campaigns, locations, missed-calls, all/);
  });
  test('no argument gives the usage line', () => {
    expect(() => parseTryArgs([])).toThrow(TRY_USAGE);
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
