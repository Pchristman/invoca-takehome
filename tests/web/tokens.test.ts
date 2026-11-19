import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WEB = join(process.cwd(), 'src', 'web');
const TOKENS = join(WEB, 'styles', 'tokens.css');

const TOKEN_NAMES = [
  '--color-text', '--color-text-muted', '--color-bg', '--color-surface', '--color-border',
  '--color-accent', '--color-accent-text', '--color-up', '--color-down',
  '--color-notice-bg', '--color-notice-text', '--color-chart-bar', '--color-chart-bar-partial',
  '--font-body', '--font-heading', '--font-mono',
  '--text-sm', '--text-md', '--text-lg', '--text-xl',
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--radius',
  '--motion-fast', '--motion-base', '--motion-slow', '--ease-standard',
];

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

// Every css, ts and tsx file under src/web except tokens.css itself.
function scannedFiles(): string[] {
  return filesUnder(WEB).filter((f) => f !== TOKENS && /\.(css|tsx?)$/.test(f));
}

function lines(file: string): string[] {
  return readFileSync(file, 'utf8').split(/\r?\n/);
}

describe('design tokens', () => {
  const tokens = readFileSync(TOKENS, 'utf8');

  it('tokens.css defines every token the plan names', () => {
    const missing = TOKEN_NAMES.filter((name) => !new RegExp(`${name}\\s*:`).test(tokens));
    expect(missing).toEqual([]);
  });

  it('reduced motion zeroes the durations', () => {
    const start = tokens.indexOf('prefers-reduced-motion: reduce');
    expect(start).toBeGreaterThan(-1);
    const block = tokens.slice(start);
    expect(block).toMatch(/--motion-fast:\s*0ms/);
    expect(block).toMatch(/--motion-base:\s*0ms/);
    expect(block).toMatch(/--motion-slow:\s*0ms/);
  });

  it('no raw colors or durations outside tokens.css', () => {
    const color = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
    const duration = /\b\d+(\.\d+)?m?s\b/;
    const found: string[] = [];
    for (const file of scannedFiles()) {
      lines(file).forEach((line, i) => {
        const motionLine = /transition|animation/.test(line);
        if (color.test(line) || (motionLine && duration.test(line))) {
          found.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(found).toEqual([]);
  });

  it('every var() used is defined', () => {
    const undefinedNames: string[] = [];
    for (const file of scannedFiles().filter((f) => /\.(css|tsx)$/.test(f))) {
      lines(file).forEach((line, i) => {
        for (const match of line.matchAll(/var\(\s*(--[\w-]+)/g)) {
          if (!new RegExp(`${match[1]}\\s*:`).test(tokens)) {
            undefinedNames.push(`${file}:${i + 1}: ${match[1]}`);
          }
        }
      });
    }
    expect(undefinedNames).toEqual([]);
  });
});
