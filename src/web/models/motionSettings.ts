// Motion timing, read from the CSS tokens. tokens.css is the one place a duration or
// the ease is written; this module turns those strings into numbers (seconds).
// Anything unreadable, zero, or reduced motion means "off": no motion at all.

export type Ease = [number, number, number, number]; // a cubic-bezier

export interface MotionSettings {
  enabled: boolean;
  fast: number;
  base: number;
  slow: number;
  ease: Ease;
}

export const MOTION_OFF: MotionSettings = { enabled: false, fast: 0, base: 0, slow: 0, ease: [0, 0, 1, 1] };

// '200ms' -> 0.2, '0.3s' -> 0.3. Anything else is null.
export function parseDuration(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/.exec(text.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === 'ms' ? amount / 1000 : amount;
}

// 'cubic-bezier(0.2, 0, 0, 1)' -> [0.2, 0, 0, 1]. Anything else is null.
export function parseEase(text: string): Ease | null {
  const match = /^cubic-bezier\(([^)]*)\)$/.exec(text.trim());
  if (!match) return null;
  const parts = (match[1] ?? '').split(',').map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => part === '')) return null;
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  return numbers as Ease;
}

export function resolveMotion(input: {
  reduced: boolean;
  fast: string;
  base: string;
  slow: string;
  ease: string;
}): MotionSettings {
  if (input.reduced) return MOTION_OFF;
  const fast = parseDuration(input.fast);
  const base = parseDuration(input.base);
  const slow = parseDuration(input.slow);
  const ease = parseEase(input.ease);
  if (fast === null || base === null || slow === null || ease === null) return MOTION_OFF;
  if (fast === 0 || base === 0 || slow === 0) return MOTION_OFF;
  return { enabled: true, fast, base, slow, ease };
}

export function readMotionCss(style: { getPropertyValue(name: string): string }): {
  fast: string;
  base: string;
  slow: string;
  ease: string;
} {
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    fast: read('--motion-fast'),
    base: read('--motion-base'),
    slow: read('--motion-slow'),
    ease: read('--ease-standard'),
  };
}
