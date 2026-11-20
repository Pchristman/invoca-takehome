import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Pins the look rules that can be tested. Reads css, ts, tsx and index.html as text.
const ROOT = process.cwd();
const WEB = join(ROOT, 'src', 'web');
const TOKENS = readFileSync(join(WEB, 'styles', 'tokens.css'), 'utf8');
const BASE = readFileSync(join(WEB, 'styles', 'base.css'), 'utf8');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

const SOURCES = [...filesUnder(WEB).filter((f) => /\.(css|tsx?)$/.test(f)), join(ROOT, 'index.html')]
  .filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  })
  .map((f) => ({ file: relative(ROOT, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }));
const CSS = SOURCES.filter((s) => s.file.endsWith('.css'));
const CODE = SOURCES.filter((s) => /\.tsx?$/.test(s.file));

// ---- helpers ----
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface Rule { selectors: string[]; body: string }
function rulesOf(css: string): Rule[] {
  const rules: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const text = stripComments(css);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    rules.push({ selectors, body: m[2] ?? '' });
  }
  return rules;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function isPurple(hex: string): boolean {
  const { h, s, l } = hexToHsl(hex);
  return s >= 0.25 && l >= 0.15 && l <= 0.85 && h >= 250 && h <= 330;
}

const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u;

function firstFamily(token: string): string {
  const m = new RegExp(`${token}:\\s*([^;]+);`).exec(TOKENS);
  if (!m) throw new Error(`${token} not found in tokens.css`);
  return ((m[1] ?? '').split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
}

// Selectors allowed to use the accent: things you can act on
// (links, buttons, the current tab, focus rings, the summary you open).
const ACTION_SELECTORS = [
  'a',
  ':focus-visible',
  '.app-header .button[aria-pressed="true"]',
  '.app-header :focus-visible',
  '.nav :focus-visible',
  '.nav a[aria-current="page"]',
  '.button[aria-pressed="true"]',
  '.button.is-active',
  'button.button:not([aria-pressed]):not(:disabled)',
  'th .sort-button:hover',
  '.estimate-note summary',
];

describe('look guards', () => {
  it('no gradients, except the partial-week hatch', () => {
    const offenders = SOURCES.filter((s) => /\.(css|tsx)$/.test(s.file))
      .filter((s) => /gradient\(/.test(s.text.replace(/repeating-linear-gradient\(/g, '')))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('no glass', () => {
    const offenders = SOURCES.filter((s) => /backdrop-filter|filter:\s*[^;]*blur/.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('no emoji', () => {
    expect(EMOJI.test('✅')).toBe(true);
    expect(EMOJI.test('⚡️')).toBe(true);
    for (const ok of ['–', '…', '×', '↑']) expect(EMOJI.test(ok)).toBe(false);
    const offenders = SOURCES.filter((s) => EMOJI.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('no purple colour token', () => {
    expect(isPurple('#8a4fff')).toBe(true);
    expect(isPurple('#5e74e3')).toBe(false);
    const offenders: string[] = [];
    for (const m of TOKENS.matchAll(/(--color-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
      if (isPurple(m[2] ?? '')) offenders.push(`${m[1]} ${m[2]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('type pairing: Plex Sans with a different mono family, both loaded', () => {
    const body = firstFamily('--font-body');
    expect(['Inter', 'system-ui', '-apple-system', 'Segoe UI']).not.toContain(body);
    const mono = firstFamily('--font-mono');
    expect(mono).not.toBe(body);
    expect(mono).toBe('IBM Plex Mono');
    const main = readFileSync(join(WEB, 'main.tsx'), 'utf8');
    expect(main).toMatch(/import\s+'@fontsource\/ibm-plex-mono\/latin-400\.css'/);
    expect(main).toMatch(/import\s+'@fontsource\/ibm-plex-mono\/latin-500\.css'/);
  });

  it('one accent, used for actions only', () => {
    const offenders: string[] = [];
    for (const rule of rulesOf(BASE)) {
      if (!/var\(--color-(accent|accent-soft|chrome-accent)\)/.test(rule.body)) continue;
      for (const sel of rule.selectors) if (!ACTION_SELECTORS.includes(sel)) offenders.push(sel);
    }
    expect(offenders).toEqual([]);
  });

  it('no card on the tile strip: tile has no radius, the grid has one', () => {
    const rules = rulesOf(BASE);
    const body = (sel: string) => rules.filter((r) => r.selectors.includes(sel)).map((r) => r.body).join(';');
    expect(body('.tile')).not.toBe('');
    expect(body('.tile')).not.toMatch(/border-radius/);
    expect(body('.tile-grid')).toMatch(/border-radius/);
  });

  describe('motion is tokenised', () => {
    it('every css transition or animation names a --motion- token', () => {
      const offenders: string[] = [];
      for (const s of CSS) {
        for (const m of stripComments(s.text).matchAll(/(?:^|[;{\s])((?:transition|animation)(?:-duration)?)\s*:([^;}]*)/g)) {
          if (!(m[2] ?? '').includes('var(--motion-')) offenders.push(`${s.file}: ${m[1]}:${(m[2] ?? '').trim()}`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it('no literal duration or ease array outside the motion models', () => {
      const allowed = ['src/web/models/motionSettings.ts', 'src/web/models/motionVariants.ts'];
      const offenders = CODE.filter((s) => !allowed.includes(s.file))
        .filter((s) => /duration:\s*\d|ease:\s*\[/.test(s.text))
        .map((s) => s.file);
      expect(offenders).toEqual([]);
    });

    it('only the motion files import the motion library', () => {
      const allowed = ['useMotion.ts', 'AnimatedNumber.tsx', 'Reveal.tsx', 'ViewTransition.tsx', 'main.tsx'];
      const lib = /(?:from|import)\s+['"](?:motion\/react|framer-motion)['"]/;
      const offenders = CODE.filter((s) => lib.test(s.text))
        .map((s) => s.file)
        .filter((f) => !allowed.includes(f.split('/').pop()!));
      expect(offenders).toEqual([]);
    });
  });
});
