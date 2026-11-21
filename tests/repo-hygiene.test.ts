import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// Guards for the rule "never commit or ship secrets", plus the CSV line endings other tests rely on.

function lines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim());
}

test('.gitignore keeps .env out of git', () => {
  expect(lines('.gitignore')).toContain('.env');
});

test('.env.example holds no real key', () => {
  const text = readFileSync('.env.example', 'utf8');
  expect(text).toMatch(/^ANTHROPIC_API_KEY=\s*$/m);
  expect(text).not.toMatch(/sk-ant-/);
});

test('.dockerignore keeps every .env out of the image', () => {
  const ignore = lines('.dockerignore');
  for (const entry of ['.env', '.env.*', '**/.env', '**/.env.*']) expect(ignore).toContain(entry);
});

test('the Dockerfile copies no key, secret or .env into the image', () => {
  const dockerfile = readFileSync('Dockerfile', 'utf8');
  expect(dockerfile).not.toMatch(/ANTHROPIC|API_KEY|SECRET/i);
  expect(dockerfile).not.toMatch(/^COPY (\.|\*) /m);
  expect(dockerfile).not.toMatch(/\.env\b/);
});

test('docker-compose.yml holds no literal key and reads no env_file', () => {
  const compose = readFileSync('docker-compose.yml', 'utf8');
  expect(compose).not.toMatch(/sk-ant-/);
  expect(compose).not.toMatch(/env_file/);
});

test('no tracked file holds a real-looking Anthropic key', () => {
  // Real keys look like sk-ant-api03-<long tail>; the fakes in tests (sk-ant-test-key, ...) do not.
  const realKey = /sk-ant-(?:api|admin|oat)\d{2}-[A-Za-z0-9_-]{20,}/;
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const offenders = tracked.filter((file) => {
    try {
      return realKey.test(readFileSync(file, 'utf8'));
    } catch {
      return false; // deleted in the working tree
    }
  });
  expect(offenders).toEqual([]);
});

test('.gitattributes stops git rewriting line endings in CSVs (the CRLF fixtures other tests read)', () => {
  expect(lines('.gitattributes')).toContain('*.csv -text');
});
