import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TakeawayReason } from '../../src/ai/types';
import type { TakeawayResponse } from '../../src/server/api';
import { PrintControls, PrintSummary } from '../../src/web/components/PrintSummary';
import { printModel } from '../../src/web/models/printModel';
import type { PrintTakeaways } from '../../src/web/models/printModel';
import type { RequestState } from '../../src/web/requestState';
import { serverFixture } from '../server/helpers';
import { emptyRangeStore, metaFor, overviewFor } from './fixtures';

type State = RequestState<TakeawayResponse>;
const store = serverFixture();
const VIEWS = ['overview', 'campaigns', 'locations', 'missed-calls'] as const;

function ready(view: TakeawayResponse['view'], source: 'ai' | 'template', reason: TakeawayReason = 'ai_off'): State {
  const text = `Takeaway text for ${view}.`;
  const data: TakeawayResponse =
    source === 'ai' ? { view, text, source: 'ai', reason: null } : { view, text, source: 'template', reason };
  return { status: 'ready', key: view, data };
}
function all(make: (view: TakeawayResponse['view']) => State | null): PrintTakeaways {
  return { overview: make('overview'), campaigns: make('campaigns'), locations: make('locations'), 'missed-calls': make('missed-calls') };
}
const templates = all((v) => ready(v, 'template'));

function html(search = 'range=last7', takeaways = templates, s = store, edit?: (v: ReturnType<typeof overviewFor>) => void) {
  const view = overviewFor(search, s);
  edit?.(view);
  const model = printModel({ view, meta: metaFor(s), span: metaFor(s).span!, takeaways });
  return { model, markup: renderToStaticMarkup(<PrintSummary model={model} />) };
}
const count = (text: string, part: string) => text.split(part).length - 1;
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;');

describe('PrintSummary', () => {
  it('prints the page', () => {
    const { model, markup } = html();
    expect(markup).toContain('Inbound call performance summary');
    expect(markup).toContain(escape(model.rangeLine));
    expect(markup).toContain(model.asOf);
    for (const tile of model.tiles) {
      expect(markup).toContain(tile.label);
      expect(markup).toContain(escape(tile.value));
    }
    for (const block of model.blocks) {
      expect(markup).toContain(`>${block.label}<`);
      for (const action of block.actions) expect(markup).toContain(escape(action.text));
    }
    for (const note of model.estimateNotes) expect(count(markup, escape(note))).toBe(1);
    expect(model.comparisonLine).not.toBeNull();
    expect(count(markup, escape(model.comparisonLine!))).toBe(1);
  });

  it('caveats print once each, skipped rows only when set', () => {
    const clamped = html('start=2026-08-25&end=2026-09-14');
    expect(clamped.model.caveats.length).toBeGreaterThan(0);
    for (const c of clamped.model.caveats) expect(count(clamped.markup, escape(c.text))).toBe(1);
    const view = overviewFor('range=last7');
    const meta = { ...metaFor(store), skippedRows: 12 };
    const withSkips = renderToStaticMarkup(<PrintSummary model={printModel({ view, meta, span: meta.span!, takeaways: templates })} />);
    expect(withSkips).toContain('12 rows skipped');
    expect(html().markup).not.toMatch(/skipped/i);
  });

  it('AI off shows template text and marker, no reason text', () => {
    const reasons: TakeawayReason[] = ['ai_off', 'budget_reached', 'api_error', 'check_failed'];
    const { markup } = html('range=last7', all((v) => ready(v, 'template', reasons[VIEWS.indexOf(v)])));
    for (const v of VIEWS) expect(markup).toContain(`Takeaway text for ${v}.`);
    expect(count(markup, '>template<')).toBe(4);
    expect(markup).not.toContain('>AI<');
    expect(markup).not.toMatch(/AI is off|AI budget reached|API error/i);
  });

  it('AI on shows the AI marker and text', () => {
    const { markup } = html('range=last7', all((v) => ready(v, 'ai')));
    expect(count(markup, '>AI<')).toBe(4);
    expect(markup).toContain('Takeaway text for campaigns.');
  });

  it('no loading text and no empty section for loading or hidden takeaways', () => {
    const loading = html('range=last7', all(() => ({ status: 'loading', key: 'k' })));
    expect(loading.markup).not.toContain('Loading');
    expect(loading.markup).not.toContain('takeaway');
    const failed: State = { status: 'failed', key: 'k', error: { code: 'network', message: 'x' } as never };
    const hidden = html('range=last7', all((v) => (v === 'campaigns' ? null : failed)));
    expect(hidden.markup).not.toContain('takeaway');
    for (const block of hidden.model.blocks) for (const a of block.actions) expect(hidden.markup).toContain(escape(a.text));
  });

  it('has no dev content and no links', () => {
    const { markup } = html();
    expect(markup).not.toContain('<a ');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('Data notes');
    expect(markup).not.toContain('dev');
  });

  it('long names wrap: shown in full inside a print-page root', () => {
    const long = 'x'.repeat(200);
    // Hand-edited real overview JSON: the first action names a 200-letter campaign.
    const { markup } = html('range=last7', templates, store, (v) => {
      v.topActions[0]!.action.text = `Look at ${long} first.`;
    });
    expect(markup).toContain(long);
    expect(markup.startsWith('<article class="print-page"')).toBe(true);
  });

  it('names stay text', () => {
    // Hand-edited real overview JSON: the first action names a campaign with markup in it.
    const { markup } = html('range=last7', templates, store, (v) => {
      v.topActions[0]!.action.text = 'Look at <b>x</b> first.';
    });
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(markup).not.toContain('<b>');
  });

  it('an empty range prints the empty line once; All data prints the reason once', () => {
    const empty = html('start=2026-09-10&end=2026-09-12', templates, emptyRangeStore());
    expect(count(empty.markup, 'No calls in this range.')).toBe(1);
    const allData = html('range=all');
    expect(allData.model.comparisonReason).not.toBeNull();
    expect(count(allData.markup, escape(allData.model.comparisonReason!))).toBe(1);
  });
});

describe('PrintSummary head', () => {
  it('separates the range, as-of and skipped lines', () => {
    const view = overviewFor('range=last7');
    const meta = { ...metaFor(store), skippedRows: 12 };
    const model = printModel({ view, meta, span: meta.span!, takeaways: templates });
    const markup = renderToStaticMarkup(<PrintSummary model={model} />);
    expect(markup).toContain(escape(`${model.rangeLine} · ${model.asOf} · ${model.skipped}`));
    const plain = html().model;
    expect(html().markup).toContain(escape(`${plain.rangeLine} · ${plain.asOf}`));
  });
});

describe('PrintControls', () => {
  const render = (canPrint: boolean) => renderToStaticMarkup(<PrintControls canPrint={canPrint} backHref="/?range=last7" />);

  it('disables Print until it can print', () => {
    expect(render(false)).toMatch(/<button[^>]*disabled/);
    expect(render(true)).not.toMatch(/<button[^>]*disabled/);
  });

  it('has a typed Print button, the back link, and a no-print wrapper', () => {
    const markup = render(true);
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*>Print<\/button>/);
    expect(markup).toContain('href="/?range=last7"');
    expect(markup).toContain('Open the app');
    expect(markup).toMatch(/^<div class="[^"]*no-print/);
  });
});
