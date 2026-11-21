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
