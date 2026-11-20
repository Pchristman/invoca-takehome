import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Meta } from '../../src/server/api';
import { RangeControl } from '../../src/web/components/RangeControl';
import { parseUrlState } from '../../src/web/urlState';

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
  it('does not double-fade content that already has its own motion wrapper', () => {
    expect(css).toContain(':not(.loading):not([data-motion])');
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
