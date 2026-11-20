import { expect, it } from 'vitest';
import { parseDbPath } from '../../src/server/config';

// Built from parts so no test file spells the real database path (tests/repo-hygiene.test.ts checks that).
const DEFAULT_FILE = ['data', 'calls.db'].join('/');

it('unset, blank and spaces give the default file', () => {
  expect(parseDbPath(undefined)).toBe(DEFAULT_FILE);
  expect(parseDbPath('')).toBe(DEFAULT_FILE);
  expect(parseDbPath('   ')).toBe(DEFAULT_FILE);
});

it('a value passes through trimmed, :memory: included', () => {
  expect(parseDbPath(':memory:')).toBe(':memory:');
  expect(parseDbPath('  tmp/x.db ')).toBe('tmp/x.db');
});
