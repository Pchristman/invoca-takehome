// The checker: decides whether the model's text is safe to show. It runs on the text with the
// {placeholders} still in it, so any digit, number word or name left over was written by the model.
// The text is normalised first (NFKC, hidden characters removed, spaces collapsed), so fullwidth letters,
// hidden characters and odd spacing cannot hide a word from the lists below.
import { fillPlaceholders, PLACEHOLDER, PLACEHOLDER_KEY, type FactSheet } from '../core/views/facts';

export interface KnownNames { campaigns: string[]; offices: string[]; channels: readonly string[] }

export type CheckFailure =
  | 'empty' | 'too_long' | 'bad_placeholder' | 'unknown_placeholder'
  | 'digit' | 'symbol' | 'number_word' | 'off_sheet_name';

export type CheckResult = { ok: true } | { ok: false; reason: CheckFailure; detail: string };

export const MAX_TAKEAWAY_CHARS = 400;

export const NUMBER_WORDS: readonly string[] = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
  'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
  'hundred', 'thousand', 'million', 'billion', 'trillion', 'percent',
  'half', 'twice', 'once', 'double', 'triple', 'dozen', 'couple', 'pair', 'tens',
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth',
];

// Quantity words that come in many forms (doubled, halving, hundreds, fivefold). Matched as stems, not whole words,
// so the list above can stay whole-word only (that is what keeps "phone", "someone" and "money" legal).
const QUANTITY_STEMS = /(?<![\p{L}\p{N}])(?:doubl\w*|tripl\w*|quadrupl\w*|quintupl\w*|halv\w*|hundreds?|thousands?|millions?|billions?|trillions?|dozens?|quarters?|\w+fold|per\s+cent)(?![\p{L}\p{N}])/iu;

const HIDDEN_CHARACTERS = /[­᠎​-‏⁠-⁤﻿]/g;

/** Hidden characters removed, compatibility forms folded (fullwidth, ligatures, decomposed accents), spaces collapsed. */
export function normaliseText(text: string): string {
  return text.replace(HIDDEN_CHARACTERS, '').normalize('NFKC').replace(/\s+/g, ' ');
}

function fail(reason: CheckFailure, detail: string): CheckResult {
  return { ok: false, reason, detail };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A regex that matches `phrase` only as a whole word (letters and digits on either side break it). */
function wholeWord(phrase: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(phrase)}(?![\\p{L}\\p{N}])`, 'iu');
}

/**
 * A name as a whole-word, global regex over normalised text. The gaps between its words match any spacing,
 * none included, so "Summer Blast", "Summer  Blast" and "SummerBlast" all match.
 */
function namePattern(name: string): RegExp {
  const parts = normaliseText(name).trim().split(' ').map(escapeRegex);
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('\\s*')}(?![\\p{L}\\p{N}])`, 'giu');
}

const nameKey = (name: string): string => normaliseText(name).trim().toLowerCase();

/** Start and end positions of every match of `name` in `text`. */
function ranges(text: string, name: string): [number, number][] {
  return [...text.matchAll(namePattern(name))].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
}

function textsToScan(text: string, withoutPlaceholders: string, sheet: FactSheet): string[] {
  try {
    return [withoutPlaceholders, normaliseText(fillPlaceholders(text, sheet.facts))];
  } catch {
    return [withoutPlaceholders]; // a fact that cannot be formatted: never throw from the checker
  }
}

export function checkTakeaway(text: string, sheet: FactSheet, known: KnownNames): CheckResult {
  if (text.trim() === '') return fail('empty', 'The text is empty');
  if (text.length > MAX_TAKEAWAY_CHARS) return fail('too_long', `The text is over ${MAX_TAKEAWAY_CHARS} characters`);

  // Placeholders: every one must be well formed and name a fact on the sheet.
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (!PLACEHOLDER_KEY.test(match[1] ?? '')) return fail('bad_placeholder', `Malformed placeholder: ${match[0]}`);
  }
  // Placeholders are removed, then the rest is normalised: a fullwidth brace becomes a plain one here and fails.
  const withoutPlaceholders = normaliseText(text.replace(PLACEHOLDER, ' '));
  if (/[{}]/.test(withoutPlaceholders)) return fail('bad_placeholder', 'A brace is not part of a placeholder');
  for (const match of text.matchAll(PLACEHOLDER)) {
    const key = match[1] ?? '';
    if (!Object.prototype.hasOwnProperty.call(sheet.facts, key)) return fail('unknown_placeholder', `Unknown placeholder: ${key}`);
  }

  // Digits, symbols and number words are checked with on-sheet names removed (a name may hold a digit).
  const onSheet = [...sheet.entities].filter((name) => name.trim() !== '').sort((a, b) => b.length - a.length);
  let rest = withoutPlaceholders;
  for (const name of onSheet) rest = rest.replace(namePattern(name), ' ');

  if (/\p{N}/u.test(rest)) return fail('digit', 'The text contains a digit');
  if (/[%\p{Sc}]/u.test(rest)) return fail('symbol', 'The text contains a percent or currency sign');

  for (const word of NUMBER_WORDS) {
    if (wholeWord(word).test(rest)) return fail('number_word', `The text contains the number word "${word}"`);
  }
  const stem = QUANTITY_STEMS.exec(rest);
  if (stem) return fail('number_word', `The text contains the quantity word "${stem[0]}"`);

  // Off-sheet names are looked for in the text as the reader will see it (placeholders filled), and in the text
  // as written. A match passes only if it lies wholly inside a match of an on-sheet name. Channel words
  // ("direct", "social") are never on a sheet and are ordinary words, so only a channel's data code
  // ("paid_search") counts as a name.
  const channelCodes = known.channels.filter((channel) => channel.includes('_'));
  const onSheetKeys = new Set(onSheet.map(nameKey));
  const offSheet = [...known.campaigns, ...known.offices, ...channelCodes]
    .filter((name) => name.trim() !== '' && !onSheetKeys.has(nameKey(name)));
  for (const candidate of textsToScan(text, withoutPlaceholders, sheet)) {
    const covered = onSheet.flatMap((name) => ranges(candidate, name));
    for (const name of offSheet) {
      for (const [start, end] of ranges(candidate, name)) {
        if (!covered.some(([from, to]) => from <= start && end <= to)) {
          return fail('off_sheet_name', `The text names "${name}", which is not on the fact sheet`);
        }
      }
    }
  }

  return { ok: true };
}
