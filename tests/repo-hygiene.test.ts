import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

test('.gitignore covers secrets, caches, logs, build output', () => {
  const lines = readFileSync('.gitignore', 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim());
  for (const entry of ['.env', '.cache/', 'logs/', 'dist/', 'node_modules/']) {
    expect(lines).toContain(entry);
  }
});

test('.gitattributes stops git rewriting line endings in CSVs (they are fixtures)', () => {
  const lines = readFileSync('.gitattributes', 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim());
  expect(lines).toContain('*.csv -text');
});

test('.env.example documents every variable with no real secret', () => {
  const text = readFileSync('.env.example', 'utf8');
  for (const name of ['ANTHROPIC_API_KEY', 'AI_SPEND_LIMIT_USD', 'DATA_DIR', 'PORT', 'HOST']) {
    expect(text).toMatch(new RegExp(`^${name}=`, 'm'));
  }
  expect(text).toMatch(/^HOST=127\.0\.0\.1\s*$/m);
  expect(text).not.toMatch(/sk-ant-/);
  expect(text).toMatch(/^ANTHROPIC_API_KEY=\s*$/m);
});

test('.gitignore keeps the database file and its journal out of git', () => {
  const lines = readFileSync('.gitignore', 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim());
  expect(lines).toContain('data/*.db');
  expect(lines).toContain('data/*.db-journal');
  // a DB_PATH anywhere else is covered too
  expect(lines).toContain('*.db');
  expect(lines).toContain('*.db-journal');
});

test('.env.example documents DB_PATH', () => {
  const text = readFileSync('.env.example', 'utf8');
  expect(text).toMatch(/^DB_PATH=/m);
  expect(text).toMatch(/data\/calls\.db/);
});

test('no test names the real database file', () => {
  const files = readdirSync('tests', { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && /\.tsx?$/.test(e.name));
  const offenders = files
    .filter((e) => e.name !== 'repo-hygiene.test.ts')
    .filter((e) => readFileSync(join(e.parentPath, e.name), 'utf8').includes('data/calls.db'))
    .map((e) => join(e.parentPath, e.name));
  expect(offenders).toEqual([]);
});
