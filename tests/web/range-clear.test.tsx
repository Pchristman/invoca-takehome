import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Meta } from '../../src/server/api';
import { RangeControl } from '../../src/web/components/RangeControl';
import { parseUrlState } from '../../src/web/urlState';
import { MOTION_OFF } from '../../src/web/models/motionSettings';
import { settleAnimation } from '../../src/web/models/motionVariants';

const noop = () => undefined;
const meta: Meta = {
  hasData: true,
  callCount: 10,
  span: { start: '2026-09-01', end: '2026-10-29' },
  campaigns: [],
  locations: [],
  presets: ['last7', 'last28', 'all'],
  defaultPreset: 'last28',
  skippedRows: 0,
  notes: [],
  aiStatus: 'off',
};
const render = (search: string) =>
  renderToStaticMarkup(<RangeControl state={parseUrlState(search)} meta={meta} error={null} onChange={noop} onCompare={noop} />);

describe('clearing dates', () => {
  it('has no Clear dates button when no dates are set', () => {
    expect(render('')).not.toContain('Clear dates');
    expect(render('?range=last7')).not.toContain('Clear dates');
  });

  it('has a Clear dates button when a custom range is applied', () => {
    expect(render('?start=2026-09-08&end=2026-09-14')).toMatch(/<button[^>]*>Clear dates</);
  });

  it('keeps Use previous period when a comparison is set', () => {
    const html = render('?start=2026-09-08&end=2026-09-14&compareStart=2026-09-01&compareEnd=2026-09-07');
    expect(html).toMatch(/<button[^>]*>Use previous period</);
  });
});

describe('loading label', () => {
  const css = readFileSync('src/web/styles/base.css', 'utf8');
  it('is delayed, so a quick reply does not flash Loading...', () => {
    const rule = /\n\.loading \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/animation: loading-in[^;]*var\(--motion-slow\)/);
  });
  it('fades in only content that replaces the loading label', () => {
    expect(css).toContain('.view-body > :not(.loading)');
  });
});

describe('range control layout', () => {
  const css = readFileSync('src/web/styles/base.css', 'utf8');
  it('lines the Compare group up on the bottom of the inputs, not on the middle of the labels', () => {
    expect(css).toMatch(/\.range-control > \.row\s*\{[^}]*align-items:\s*end/);
  });
  it('lets the page use more than 76rem', () => {
    const width = /\.page\s*\{[^}]*max-width:\s*(\d+)rem/.exec(css)?.[1];
    expect(Number(width)).toBeGreaterThan(76);
  });
});

describe('settling new content in', () => {
  const on = { enabled: true, fast: 0.2, base: 0.3, slow: 0.3, ease: [0.2, 0, 0, 1] as [number, number, number, number] };
  it('is nothing when motion is off', () => {
    expect(settleAnimation(MOTION_OFF)).toBeNull();
  });
  it('starts from the dimmed look and rises into place over the base time', () => {
    const animation = settleAnimation(on)!;
    expect(animation.keyframes[0]).toEqual({ opacity: 0.55, transform: 'translateY(8px)' });
    expect(animation.keyframes[1]).toEqual({ opacity: 1, transform: 'translateY(0)' });
    expect(animation.options).toEqual({ duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  });
});
