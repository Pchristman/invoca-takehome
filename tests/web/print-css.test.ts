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
    expect(print).toContain('break-inside: avoid');
  });

  it('wraps long names inside the page', () => {
    const rule = /\.print-page\s*\{([^}]*)\}/.exec(print);
    expect(rule?.[1]).toContain('overflow-wrap: anywhere');
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
