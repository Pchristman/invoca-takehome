import { readFileSync } from 'node:fs';
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
