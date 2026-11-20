import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const styles = join(process.cwd(), 'src', 'web', 'styles');
const print = readFileSync(join(styles, 'print.css'), 'utf8');
const tokens = readFileSync(join(styles, 'tokens.css'), 'utf8');

/** The text inside the block that opens at the first brace after `start`. */
function block(text: string, start: number): string {
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

describe('print stylesheet', () => {
  it('sets @page margins without a size, so A4 and Letter both fit', () => {
    const at = print.indexOf('@page');
    expect(at).toBeGreaterThan(-1);
    expect(block(print, at)).not.toMatch(/size\s*:/);
  });

  it('keeps blocks and tiles whole', () => {
    const media = block(print, print.indexOf('@media print'));
    const rule = /([^{}]*)\{[^}]*break-inside:\s*avoid/.exec(media);
    expect(rule).not.toBeNull();
    for (const selector of ['.print-block', '.print-tile']) expect(rule![1]).toContain(selector);
  });

  it('draws the tile divider as a border, with no shadow', () => {
    expect(print).toMatch(/\.print-tile \+ \.print-tile\s*\{[^}]*border-left:\s*1px solid var\(--color-rule\)/);
    expect(print).not.toContain('box-shadow');
  });

  it('has no redundant loading selector', () => {
    expect(print).not.toContain('[role="status"].loading');
  });

  it('the print text scale never shrinks from sm to 2xl', () => {
    const body = block(tokens, tokens.indexOf('@media print'));
    const sizes = ['sm', 'md', 'lg', 'xl', '2xl'].map((n) => Number(new RegExp(`--text-${n}\\s*:\\s*([\\d.]+)pt`).exec(body)?.[1]));
    expect(sizes.every((n) => Number.isFinite(n))).toBe(true);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeGreaterThanOrEqual(sizes[i - 1]!);
  });

  it('wraps long names inside the page', () => {
    const rule = /\.print-page\s*\{([^}]*)\}/.exec(print);
    expect(rule?.[1]).toContain('overflow-wrap: anywhere');
  });

  it('shows the final state of anything animated, whatever the animation was doing', () => {
    const media = block(print, print.indexOf('@media print'));
    const rule = /\[data-motion\][^{]*\{([^}]*)\}/.exec(media);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/opacity:\s*1\s*!important/);
    expect(rule![1]).toMatch(/transform:\s*none\s*!important/);
  });

  it('hides no-print parts in @media print', () => {
    const media = block(print, print.indexOf('@media print'));
    expect(media).toMatch(/\.no-print[^{]*\{[^}]*display:\s*none/);
  });

  it('tokens.css overrides type and space for print, no colour, before reduced motion', () => {
    const at = tokens.indexOf('@media print');
    expect(at).toBeGreaterThan(-1);
    const body = block(tokens, at);
    expect(body).toMatch(/--text-md\s*:/);
    expect(body).toMatch(/--space-3\s*:/);
    expect(body).not.toContain('--color-');
    expect(at).toBeLessThan(tokens.indexOf('prefers-reduced-motion'));
  });
});
