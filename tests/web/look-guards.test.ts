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

interface Hsl { h: number; s: number; l: number }

function rgbToHsl(r255: number, g255: number, b255: number): Hsl {
  const r = r255 / 255, g = g255 / 255, b = b255 / 255;
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

// Reads #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() and hsl()/hsla() (comma or space separated).
function colorToHsl(value: string): Hsl | null {
  const v = value.trim();
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(v);
  if (hex) {
    let d = hex[1] ?? '';
    if (d.length === 3 || d.length === 4) d = [...d].map((c) => c + c).join('');
    if (d.length !== 6 && d.length !== 8) return null;
    const n = parseInt(d.slice(0, 6), 16);
    return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/i.exec(v);
  if (!fn) return null;
  const parts = (fn[2] ?? '').split(/[\s,/]+/).filter(Boolean);
  const num = (p: string | undefined, scale = 1): number => {
    const t = p ?? '0';
    return t.endsWith('%') ? (parseFloat(t) / 100) * scale : parseFloat(t);
  };
  if (/^rgb/i.test(fn[1] ?? '')) return rgbToHsl(num(parts[0], 255), num(parts[1], 255), num(parts[2], 255));
  return { h: ((parseFloat(parts[0] ?? '0') % 360) + 360) % 360, s: num(parts[1]), l: num(parts[2]) };
}

function isPurple(value: string): boolean {
  const c = colorToHsl(value);
  if (!c) return false;
  return c.s >= 0.25 && c.l >= 0.15 && c.l <= 0.85 && c.h >= 250 && c.h <= 330;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function tokenValue(name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(TOKENS);
  if (!m) throw new Error(`${name} not found in tokens.css`);
  return m[1] ?? '';
}

// Any use of an accent token, with or without a fallback value: var(--color-accent, x).
const ACCENT_USE = /var\(\s*--color-(?:accent|accent-soft|accent-text|chrome-accent)\s*[,)]/;

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

  it('no purple colour token (hex of any length, rgb() and hsl())', () => {
    expect(isPurple('#8a4fff')).toBe(true);
    expect(isPurple('#84f')).toBe(true);
    expect(isPurple('rgb(138, 79, 255)')).toBe(true);
    expect(isPurple('rgba(138 79 255 / 0.5)')).toBe(true);
    expect(isPurple('hsl(270, 60%, 50%)')).toBe(true);
    expect(isPurple('hsl(270 60% 50%)')).toBe(true);
    expect(isPurple('#5e74e3')).toBe(false);
    expect(isPurple('#0f8')).toBe(false);
    expect(isPurple('hsl(160, 50%, 40%)')).toBe(false);
    expect(isPurple('rgb(0, 104, 79)')).toBe(false);
    const offenders: string[] = [];
    const color = /(--color-[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/g;
    let count = 0;
    for (const m of TOKENS.matchAll(color)) {
      count++;
      if (isPurple(m[2] ?? '')) offenders.push(`${m[1]} ${m[2]}`);
    }
    expect(count).toBeGreaterThan(20);
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

  it('one accent, used for actions only (every css file, every accent token)', () => {
    expect(ACCENT_USE.test('color: var(--color-accent);')).toBe(true);
    expect(ACCENT_USE.test('background: var( --color-accent-soft );')).toBe(true);
    expect(ACCENT_USE.test('color: var(--color-accent-text)')).toBe(true);
    expect(ACCENT_USE.test('color: var(--color-chrome-accent, #0b8)')).toBe(true);
    expect(ACCENT_USE.test('color: var(--color-accent, red)')).toBe(true);
    expect(ACCENT_USE.test('color: var(--color-chrome-text)')).toBe(false);
    expect(ACCENT_USE.test('color: var(--color-up)')).toBe(false);
    expect(CSS.map((s) => s.file)).toContain('src/web/styles/print.css');
    const offenders: string[] = [];
    for (const s of CSS) {
      for (const rule of rulesOf(s.text)) {
        if (!ACCENT_USE.test(rule.body)) continue;
        for (const sel of rule.selectors) if (!ACTION_SELECTORS.includes(sel)) offenders.push(`${s.file}: ${sel}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('data and status colours look different from the accent (hue at least 40 degrees away)', () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(166, 213)).toBe(47);
    expect(hueDistance(0, 180)).toBe(180);
    const accents = ['--color-accent', '--color-chrome-accent'].map((t) => colorToHsl(tokenValue(t))!.h);
    const marks = [
      '--color-up', '--color-down', '--color-chart-bar', '--color-chart-bar-partial',
      '--color-heat-1', '--color-heat-2', '--color-heat-3', '--color-heat-4',
    ];
    const tooClose = marks.flatMap((t) => {
      const h = colorToHsl(tokenValue(t))!.h;
      return accents.filter((a) => hueDistance(h, a) < 40).map((a) => `${t} hue ${Math.round(h)} is within 40 of accent hue ${Math.round(a)}`);
    });
    expect(tooClose).toEqual([]);
  });

  it('no card on the tile strip: tile has no radius, the grid has one', () => {
    const rules = rulesOf(BASE);
    const body = (sel: string) => rules.filter((r) => r.selectors.includes(sel)).map((r) => r.body).join(';');
    expect(body('.tile')).not.toBe('');
    expect(body('.tile')).not.toMatch(/border-radius/);
    expect(body('.tile-grid')).toMatch(/border-radius/);
  });

  describe('motion is tokenised', () => {
    // Splits "a b, c d" at top-level commas (not inside parentheses).
    const topLevelParts = (value: string): string[] => {
      const parts: string[] = [];
      let depth = 0, cur = '';
      for (const ch of value) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
      }
      parts.push(cur);
      return parts.map((p) => p.trim()).filter(Boolean);
    };
    const MOTION_DECL = /(?:^|[;{\s])((?:transition|animation)(?:-(?:duration|delay|timing-function))?)\s*:([^;}]*)/g;
    // Allowed: names a --motion- token (or --ease- for timing functions), or is none / 0.
    const tokenised = (prop: string, value: string): boolean =>
      topLevelParts(value).every((part) => {
        if (/^(?:none|0|0s|0ms)$/.test(part)) return true;
        if (/timing-function$/.test(prop)) return /var\(--(?:motion|ease)-/.test(part);
        return part.includes('var(--motion-');
      });
    const offendersIn = (css: string, file = 'x.css'): string[] =>
      [...stripComments(css).matchAll(MOTION_DECL)]
        .filter((m) => !tokenised(m[1] ?? '', m[2] ?? ''))
        .map((m) => `${file}: ${m[1]}:${(m[2] ?? '').trim()}`);

    it('the motion regex catches delays, durations and timing functions (self-check)', () => {
      for (const bad of [
        'a { transition-delay: 100ms; }',
        'a { animation-delay: 1s; }',
        'a { transition-timing-function: ease-in; }',
        'a { animation-timing-function: linear; }',
        'a { animation-duration: 2s; }',
        'a { transition-duration: 0.3s; }',
        'a { transition: color 150ms ease, border var(--motion-fast); }',
      ]) expect(offendersIn(bad), bad).toHaveLength(1);
      for (const good of [
        'a { transition-delay: var(--motion-fast); }',
        'a { transition-delay: 0s; }',
        'a { animation: none; }',
        'a { transition-timing-function: var(--ease-standard); }',
        'a { transition: color var(--motion-fast) var(--ease-standard), border var(--motion-fast) var(--ease-standard); }',
        'a { transition-property: color; }',
        '/* transition: 1s */ a { color: red; }',
      ]) expect(offendersIn(good), good).toEqual([]);
    });

    it('every css transition or animation names a --motion- token', () => {
      expect(CSS.length).toBeGreaterThanOrEqual(3);
      const offenders = CSS.flatMap((s) => offendersIn(s.text, s.file));
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
      const allowed = ['useMotion.ts', 'AnimatedNumber.tsx', 'Reveal.tsx', 'ViewTransition.tsx'];
      const lib = /(?:from|import|require)\s*\(?\s*['"](?:motion(?:\/react(?:-client|-m)?)?|framer-motion)['"]/;
      for (const hit of [
        "import { motion } from 'motion'",
        'import { m } from "motion/react-m"',
        "import * as motion from 'motion/react-client'",
        "import { animate } from 'motion/react'",
        "import { motion } from 'framer-motion'",
        "import 'motion'",
        "const x = await import('motion/react')",
        "const x = require('motion')",
      ]) expect(lib.test(hit), hit).toBe(true);
      for (const miss of ["import { x } from './motionSettings'", "import { x } from '../models/motionVariants'", "from 'motionless'"]) {
        expect(lib.test(miss), miss).toBe(false);
      }
      const offenders = CODE.filter((s) => lib.test(s.text))
        .map((s) => s.file)
        .filter((f) => !allowed.includes(f.split('/').pop()!));
      expect(offenders).toEqual([]);
    });
  });
});
