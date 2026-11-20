import { describe, expect, it } from 'vitest';
import { MAX_TAKEAWAY_CHARS, NUMBER_WORDS, checkTakeaway, type KnownNames } from '../../src/ai/checker';
import { makeFactSheet, type FactSheet } from '../../src/core/views/facts';

function sheetWith(names: string[], extraKeys: string[] = []): FactSheet {
  const facts: Record<string, any> = {
    'shift.worst.name': { kind: 'name', value: names[0] },
    'shift.worst.value': { kind: 'usd_per_dollar', value: 1.5 },
    'slot.office': { kind: 'name', value: names[1] ?? names[0] },
  };
  for (const key of extraKeys) facts[key] = { kind: 'count', value: 1 };
  return makeFactSheet('campaigns', facts);
}

const sheet = sheetWith(['Alpha', 'Beta Office']);
const known: KnownNames = {
  campaigns: ['Alpha', 'Gamma'],
  offices: ['Beta Office', 'Delta Office'],
  channels: ['paid_search', 'social', 'direct'],
};

function reasonOf(text: string, s = sheet, k = known): string {
  const result = checkTakeaway(text, s, k);
  return result.ok ? 'ok' : result.reason;
}

describe('checkTakeaway', () => {
  it('accepts a good takeaway', () => {
    const text = 'Move budget away from {shift.worst.name}, which earns {shift.worst.value} per budget dollar.';
    expect(checkTakeaway(text, sheet, known)).toEqual({ ok: true });
  });

  it('rejects empty text, and text over the length limit', () => {
    expect(checkTakeaway('', sheet, known)).toMatchObject({ ok: false, reason: 'empty' });
    expect(checkTakeaway('   \n', sheet, known)).toMatchObject({ ok: false, reason: 'empty' });
    expect(MAX_TAKEAWAY_CHARS).toBe(400);
    expect(reasonOf('a'.repeat(400))).toBe('ok');
    expect(checkTakeaway('a'.repeat(401), sheet, known)).toMatchObject({ ok: false, reason: 'too_long' });
  });

  it('rejects bad placeholders', () => {
    for (const text of ['x {Bad Key} y', 'x {} y', 'x { y', 'x } y', '{{shift.worst.name}}']) {
      expect(reasonOf(text), text).toBe('bad_placeholder');
    }
  });

  it('rejects an unknown placeholder and names it', () => {
    const result = checkTakeaway('Look at {nope.value}.', sheet, known);
    expect(result).toMatchObject({ ok: false, reason: 'unknown_placeholder' });
    expect(!result.ok && result.detail).toContain('nope.value');
  });

  it('rejects digits, including Unicode digits, but not digits inside a placeholder key', () => {
    for (const text of ['3 calls', 'q3', '٣', '３', '½', '²']) {
      expect(reasonOf(text), text).toBe('digit');
    }
    const withDigitKey = sheetWith(['Alpha'], ['x1.value']);
    expect(reasonOf('See {x1.value}.', withDigitKey)).toBe('ok');
  });

  it('rejects a % or $ with no digit', () => {
    expect(checkTakeaway('Up by a lot %', sheet, known)).toMatchObject({ ok: false, reason: 'symbol' });
    expect(checkTakeaway('It costs $ here', sheet, known)).toMatchObject({ ok: false, reason: 'symbol' });
  });

  it('rejects number words as whole words only', () => {
    const words = ['one', 'Twenty', 'HUNDRED', 'percent', 'half', 'twice', 'double', 'triple', 'dozen',
      'thousand', 'million', 'first', 'second', 'no one'];
    for (const word of words) {
      expect(reasonOf(`Seen ${word} here`), word).toBe('number_word');
    }
    for (const word of ['phone', 'someone', 'money', 'onerous']) {
      expect(reasonOf(`Seen ${word} here`), word).toBe('ok');
    }
    expect(NUMBER_WORDS).toEqual(expect.arrayContaining(['zero', 'twenty', 'ninety', 'billion', 'once', 'tenth']));
  });

  it('rejects names that are not on the sheet, whole word and case-insensitive', () => {
    for (const text of ['Try Gamma now', 'Call Delta Office back', 'Look at direct traffic', 'Try paid search',
      'Try Social', 'try gamma']) {
      expect(reasonOf(text), text).toBe('off_sheet_name');
    }
    expect(reasonOf('Gammas are fine')).toBe('ok');
  });

  it('accepts on-sheet names written out, even with a digit in them', () => {
    expect(reasonOf('Alpha is doing well.')).toBe('ok');
    const spring = sheetWith(['Spring 2026']);
    const k = { ...known, campaigns: [...known.campaigns, 'Spring 2026'] };
    expect(reasonOf('Keep Spring 2026 going.', spring, k)).toBe('ok');
  });

  it('lets the longer on-sheet name pass but rejects the shorter name alone', () => {
    const overlap = sheetWith(['Display - Retargeting']);
    const k: KnownNames = { campaigns: ['Display - Retargeting', 'Display'], offices: [], channels: [] };
    expect(reasonOf('Shift budget to Display - Retargeting.', overlap, k)).toBe('ok');
    expect(reasonOf('Shift budget to Display.', overlap, k)).toBe('off_sheet_name');
  });

  it('handles names full of regex characters', () => {
    const odd = 'C++ (Brand) [A]';
    const k: KnownNames = { campaigns: [odd], offices: [], channels: [] };
    expect(reasonOf(`Look at ${odd}.`, sheet, k)).toBe('off_sheet_name');
    expect(reasonOf(`Look at ${odd}.`, sheetWith([odd]), k)).toBe('ok');
  });

  it('rejects an off-sheet name that contains an on-sheet name', () => {
    const s = sheetWith(['Display', 'North']);
    const k: KnownNames = { campaigns: ['Display', 'Display - Retargeting'], offices: ['North', 'North Austin'], channels: [] };
    expect(reasonOf('Move budget to Display - Retargeting.', s, k)).toBe('off_sheet_name');
    expect(reasonOf('Call North Austin back.', s, k)).toBe('off_sheet_name');
    expect(reasonOf('Move budget to Display and call North.', s, k)).toBe('ok');
  });

  it('rejects text that becomes an off-sheet name once placeholders are filled', () => {
    const s = sheetWith(['Display']);
    const k: KnownNames = { campaigns: ['Display', 'Display - Retargeting'], offices: [], channels: [] };
    expect(reasonOf('{shift.worst.name} - Retargeting', s, k)).toBe('off_sheet_name');
    expect(reasonOf('{shift.worst.name} is weak', s, k)).toBe('ok');
  });

  it('rejects quantity words that are not plain numbers', () => {
    const texts = ['Calls doubled and revenue halved; hundreds of callers', 'Calls tripled', 'A quarter of calls',
      'dozens more calls', 'up by a per cent', 'a tenfold jump'];
    for (const text of texts) expect(reasonOf(text), text).toBe('number_word');
    for (const text of ['Up a lot ％', 'Costs €', 'Costs £', 'Costs ¥']) expect(reasonOf(text), text).toBe('symbol');
  });

  it('accepts the alert campaign by placeholder, and rejects another loaded campaign not on the sheet', () => {
    const alertSheet = makeFactSheet('campaigns', {
      'alert.count': { kind: 'count', value: 1, noun: ['alert', 'alerts'] },
      'alert.top.name': { kind: 'name', value: 'Alpha' },
    });
    expect(reasonOf('{alert.top.name} calls moved most, so find out what changed.', alertSheet)).toBe('ok');
    expect(reasonOf('Gamma calls moved most, so find out what changed.', alertSheet)).toBe('off_sheet_name');
  });

  it('reports the first failing check: digit before number word', () => {
    expect(reasonOf('3 calls, one office')).toBe('digit');
  });
});
