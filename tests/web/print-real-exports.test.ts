// The print summary on both real exports (the shipped one and the extended one), built with the real view
// builders and the AI-off takeaways (each view's templateSentence), then drawn to static markup.
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { dataSpan } from '../../src/core/ranges';
import type { CallStore } from '../../src/core/types';
import type { TakeawayResponse } from '../../src/server/api';
import { readExportFromDir } from '../../src/node/readDataDir';
import { PrintSummary } from '../../src/web/components/PrintSummary';
import { printModel } from '../../src/web/models/printModel';
import type { PrintTakeaways } from '../../src/web/models/printModel';
import { campaignsFor, locationsFor, metaFor, missedCallsFor, overviewFor } from './fixtures';

const ROOT = join(__dirname, '..', '..');
const shipped = cleanExport(readExportFromDir(join(ROOT, 'tests', 'fixtures', 'original-export')));
const extended = cleanExport(readExportFromDir(join(ROOT, 'data', 'extended')));

// Probed visible text length (markup with tags stripped) for range=last28 with AI-off takeaways:
//   shipped export:  1780 characters (ceiling 2000)
//   extended export: 2012 characters (ceiling 2250), after the call-back action was reworded
// The ceilings below are each probe rounded up to the next 250. This is a tripwire against the page
// growing, not proof of fit: the print preview on paper is the proof.
const CEILING_SHIPPED = 2000;
const CEILING_EXTENDED = 2250;

function template(view: TakeawayResponse['view'], text: string) {
  const data: TakeawayResponse = { view, text, source: 'template', reason: 'ai_off' };
  return { status: 'ready' as const, key: view, data };
}

function build(store: CallStore, search: string) {
  const overview = overviewFor(search, store);
  const takeaways: PrintTakeaways = {
    overview: template('overview', overview.templateSentence),
    campaigns: template('campaigns', campaignsFor(search, store).templateSentence),
    locations: template('locations', locationsFor(search, store).templateSentence),
    'missed-calls': template('missed-calls', missedCallsFor(search, store).templateSentence),
  };
  const meta = metaFor(store);
  const model = printModel({ view: overview, meta, span: meta.span!, takeaways });
  const markup = renderToStaticMarkup(createElement(PrintSummary, { model }));
  return { model, markup, text: markup.replace(/<[^>]*>/g, '') };
}

const BAD = /NaN|Infinity|undefined|\{[a-z]/;

const exports = [
  { name: 'shipped', store: shipped, actions: [1, 1, 1], ceiling: CEILING_SHIPPED },
  // the Campaigns block also holds the S1 call-change alert entry
  { name: 'extended', store: extended, actions: [2, 1, 1], ceiling: CEILING_EXTENDED },
];

describe.each(exports)('print summary on the $name export', ({ store, actions, ceiling }) => {
  const last28 = build(store, 'range=last28');

  it('structure is bounded', () => {
    expect(last28.model.tiles).toHaveLength(5);
    expect(last28.model.blocks.map((b) => b.view)).toEqual(['campaigns', 'locations', 'missed-calls']);
    expect(last28.model.blocks.map((b) => b.actions.length)).toEqual(actions);
    expect(last28.model.blocks.every((b) => b.actions.length >= 1)).toBe(true);
    expect(last28.model.blocks.flatMap((b) => b.actions)).toHaveLength(actions.reduce((a, b) => a + b, 0));
    // every takeaway is the AI-off template, marked as such
    expect(last28.model.overviewTakeaway).toMatchObject({ kind: 'ready', marker: 'template' });
    expect(last28.model.blocks.every((b) => b.takeaway.kind === 'ready')).toBe(true);
  });

  it('renders clean: no NaN, Infinity, undefined or unfilled placeholder, and no links', () => {
    expect(last28.markup).not.toMatch(BAD);
    expect(last28.markup).not.toContain('<a ');
  });

  it('visible text has a ceiling', () => {
    expect(last28.text.length).toBeGreaterThan(500); // the probe is measuring a real page
    expect(last28.text.length).toBeLessThan(ceiling);
  });

  it('All data has no comparison line and no NaN', () => {
    const all = build(store, 'range=all');
    expect(all.model.comparisonLine).toBeNull();
    expect(all.model.comparisonReason).toMatch(/^No full previous period/);
    expect(all.markup).not.toMatch(BAD);
  });

  it('a one-day range says "1 day", prints the span once and has no NaN', () => {
    const end = dataSpan(store.calls)!.end;
    const one = build(store, `start=${end}&end=${end}`);
    expect(one.model.rangeLine).toMatch(/\(1 day\)$/);
    expect(one.model.rangeLine).not.toContain('–');
    expect(one.text).not.toContain('1 days');
    expect(one.markup).not.toMatch(BAD);
  });
});
