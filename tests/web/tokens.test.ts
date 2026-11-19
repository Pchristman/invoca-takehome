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

// CSS named colors (not transparent or currentColor, which are not a fixed color).
const NAMED_COLORS = (
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
  'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray ' +
  'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
  'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue ' +
  'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew ' +
  'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
  'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
  'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue ' +
  'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred ' +
  'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
  'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
  'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
  'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white ' +
  'whitesmoke yellow yellowgreen'
).split(' ');
const NAMED_COLOR = new RegExp(`(?<![\\w-])(${NAMED_COLORS.join('|')})(?![\\w-])`, 'i');
const COLOR_PROPERTY =
  /(?:^|[\s{,])(?:color|background|backgroundColor|background-color|fill|stroke|border|borderColor|border-color|outline|outlineColor|outline-color|boxShadow|box-shadow|textDecorationColor|caretColor|accentColor)\s*[:=]/;

/**
 * Does this line use a named color as a value? In CSS only the value after a
 * property's colon counts; in TSX only color-ish properties and attributes do.
 * That keeps 'white-space', class names, comments and plain words out of it.
 */
function usesNamedColor(line: string, isCss: boolean): boolean {
  const text = line.replace(/\/\*.*?\*\//g, '').replace(/^\s*\/\/.*$/, '');
  if (isCss) {
    const declaration = /^\s*[\w-]+\s*:\s*(.+)$/.exec(text);
    if (!declaration) return false;
    // Drop var(...) and url(...) contents, which may hold names that are not colors.
    return NAMED_COLOR.test((declaration[1] ?? '').replace(/(?:var|url)\([^)]*\)/g, ''));
  }
  const property = COLOR_PROPERTY.exec(text);
  if (!property) return false;
  const value = text.slice(property.index + property[0].length).replace(/var\([^)]*\)/g, '');
  return NAMED_COLOR.test(value);
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
        const named = usesNamedColor(line, file.endsWith('.css'));
        if (color.test(line) || named || (motionLine && duration.test(line))) {
          found.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(found).toEqual([]);
  });

  it('the named-color guard flags real uses and skips look-alikes', () => {
    expect(usesNamedColor('  color: red;', true)).toBe(true);
    expect(usesNamedColor('  border: 1px solid white;', true)).toBe(true);
    expect(usesNamedColor("  style={{ color: 'red' }}", false)).toBe(true);
    expect(usesNamedColor('  <rect fill="steelblue" />', false)).toBe(true);
    expect(usesNamedColor('  white-space: nowrap;', true)).toBe(false);
    expect(usesNamedColor('  color: var(--color-text);', true)).toBe(false);
    expect(usesNamedColor('  /* color: red */', true)).toBe(false);
    expect(usesNamedColor('  className="white-card"', false)).toBe(false);
    expect(usesNamedColor('  // the color: red here', false)).toBe(false);
    expect(usesNamedColor("  label: 'Red flag'", false)).toBe(false);
  });

  it('contrast claims in tokens.css are true', () => {
    const value = (name: string): string => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)?.[1] ?? "";
    const luminance = (hex: string): number => {
      const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string): number => {
      const [hi = 0, lo = 0] = [luminance(value(a)), luminance(value(b))].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const text: [string, string][] = [
      ['--color-text', '--color-bg'], ['--color-text', '--color-surface'],
      ['--color-text-muted', '--color-bg'], ['--color-text-muted', '--color-surface'],
      ['--color-accent-text', '--color-accent'], ['--color-accent', '--color-bg'],
      ['--color-up', '--color-bg'], ['--color-up', '--color-surface'],
      ['--color-down', '--color-bg'], ['--color-down', '--color-surface'],
      ['--color-notice-text', '--color-notice-bg'],
    ];
    const nonText: [string, string][] = ['--color-border', '--color-chart-bar', '--color-chart-bar-partial'].flatMap(
      (part) => [[part, '--color-bg'], [part, '--color-surface']] as [string, string][],
    );
    const weak = [
      ...text.filter(([a, b]) => ratio(a, b) < 4.5).map(([a, b]) => `${a} on ${b}: ${ratio(a, b).toFixed(2)} (needs 4.5)`),
      ...nonText.filter(([a, b]) => ratio(a, b) < 3).map(([a, b]) => `${a} on ${b}: ${ratio(a, b).toFixed(2)} (needs 3)`),
    ];
    expect(weak).toEqual([]);
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
