import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TakeawayReason } from '../../src/ai/types';
import type { TakeawayResponse } from '../../src/server/api';
import type { RequestState } from '../../src/web/requestState';
import { formatDateSpan } from '../../src/web/format';
import { caveatsFor } from '../../src/web/models/caveats';
import { estimateFormulas, printEstimateNotes } from '../../src/web/models/estimates';
import { canPrint, printModel } from '../../src/web/models/printModel';
import type { PrintTakeaways } from '../../src/web/models/printModel';
import { serverFixture } from '../server/helpers';
import { emptyRangeStore, metaFor, overviewFor } from './fixtures';

type State = RequestState<TakeawayResponse>;

const store = serverFixture();
const SPAN = { start: '2026-09-01', end: '2026-09-14' };

function ready(
  view: TakeawayResponse['view'],
  text: string,
  source: 'ai' | 'template' = 'template',
  reason: TakeawayReason = 'ai_off',
): State {
  const data: TakeawayResponse =
    source === 'ai' ? { view, text, source: 'ai', reason: null } : { view, text, source: 'template', reason };
  return { status: 'ready', key: view, data };
}
const loading: State = { status: 'loading', key: 'k' };
const failed: State = { status: 'failed', key: 'k', error: { code: 'network', message: 'x' } as never };

function allTakeaways(make: (view: TakeawayResponse['view']) => State | null): PrintTakeaways {
  return {
    overview: make('overview'),
    campaigns: make('campaigns'),
    locations: make('locations'),
    'missed-calls': make('missed-calls'),
  };
}
const templates = allTakeaways((v) => ready(v, `Text for ${v}.`));

function build(search: string, takeaways: PrintTakeaways = templates, s = store) {
  const view = overviewFor(search, s);
  const span = metaFor(s).span ?? SPAN;
  return { view, model: printModel({ view, meta: metaFor(s), span, takeaways }) };
}

afterEach(() => vi.useRealTimers());

describe('printModel', () => {
  it('range, as-of and skipped lines', () => {
    const { model } = build('range=last7');
    expect(model.rangeLine).toBe(`${formatDateSpan('2026-09-08', '2026-09-14')} (7 days)`);
    expect(model.asOf).toMatch(/^Data as of /);

    const one = build('start=2026-09-10&end=2026-09-10').model;
    expect(one.rangeLine).toBe(`${formatDateSpan('2026-09-10', '2026-09-10')} (1 day)`);

    const view = overviewFor('range=last7');
    const withSkips = (n: number) =>
      printModel({ view, meta: { ...metaFor(store), skippedRows: n }, span: SPAN, takeaways: templates });
    expect(withSkips(12).skipped).toBe('12 rows skipped');
    expect(withSkips(0).skipped).toBeNull();
  });

  it('blocks follow the Overview top actions', () => {
    const { view, model } = build('range=last7');
    expect(model.blocks.map((b) => b.view)).toEqual(['campaigns', 'locations', 'missed-calls']);
    for (const block of model.blocks) {
      const expected = view.topActions
        .filter((t) => t.view === block.view)
        .map((t) => ({ text: t.action.text, actionable: t.action.actionable }));
      expect(block.actions).toEqual(expected);
    }
    const total = model.blocks.reduce((n, b) => n + b.actions.length, 0);
    expect(total).toBe(view.topActions.length);
    expect(model.blocks[0]?.label).toBe('Campaigns');
  });

  it('keeps a non-actionable action with actionable: false', () => {
    const view = overviewFor('range=last7');
    const first = view.topActions[0]!;
    view.topActions[0] = { ...first, action: { ...first.action, actionable: false } };
    const model = printModel({ view, meta: metaFor(store), span: SPAN, takeaways: templates });
    expect(model.blocks[0]?.actions[0]?.actionable).toBe(false);
  });

  it('an alert entry is grouped under Campaigns', () => {
    // Hand-edited: a second Campaigns entry, as S1's alert would add, placed right after the first.
    const view = overviewFor('range=last7');
    const first = view.topActions[0]!;
    const extra = { view: 'campaigns' as const, action: { ...first.action, text: 'Alert entry.' } };
    view.topActions = [first, extra, ...view.topActions.slice(1)];
    const model = printModel({ view, meta: metaFor(store), span: SPAN, takeaways: templates });
    expect(model.blocks[0]?.actions.map((a) => a.text)).toEqual([first.action.text, 'Alert entry.']);
    expect(model.blocks[1]?.actions).toHaveLength(1);
    expect(model.blocks[2]?.actions).toHaveLength(1);
  });

  it('takeaway markers: AI', () => {
    const { model } = build('range=last7', allTakeaways((v) => ready(v, 'AI said this.', 'ai')));
    expect(model.overviewTakeaway).toEqual({ kind: 'ready', text: 'AI said this.', marker: 'AI', note: null });
  });

  const REASONS: TakeawayReason[] = [
    'ai_off', 'budget_reached', 'no_facts', 'timeout', 'api_error', 'refusal', 'malformed', 'check_failed', 'log_unavailable',
  ];
  it.each(REASONS)('a template takeaway (%s) is marked template with no note', (reason) => {
    const { model } = build('range=last7', allTakeaways((v) => ready(v, 'Template text.', 'template', reason)));
    const expected = { kind: 'ready', text: 'Template text.', marker: 'template', note: null };
    expect(model.overviewTakeaway).toEqual(expected);
    for (const block of model.blocks) expect(block.takeaway).toEqual(expected);
  });

  it('a failed or missing takeaway is hidden; a loading one says loading', () => {
    for (const state of [failed, null]) {
      const { model } = build('range=last7', allTakeaways(() => state));
      expect(model.overviewTakeaway).toEqual({ kind: 'hidden' });
      expect(model.blocks[0]?.takeaway).toEqual({ kind: 'hidden' });
    }
    const { model } = build('range=last7', allTakeaways(() => loading));
    expect(model.overviewTakeaway.kind).toBe('loading');
    expect(model.blocks[0]?.takeaway.kind).toBe('loading');
  });

  it('caveats are the screen caveats', () => {
    const { view, model } = build('range=last7');
    expect(model.caveats).toEqual(
      caveatsFor(view.notes, metaFor(store).span ?? SPAN, { comparing: true, range: view.range, view: 'overview' }),
    );

    const perDay = build('start=2026-09-08&end=2026-09-14&compareStart=2026-09-01&compareEnd=2026-09-03').model;
    expect(perDay.caveats.filter((c) => c.id === 'per_day')).toHaveLength(1);

    const clamped = build('start=2026-08-25&end=2026-09-14').model;
    expect(clamped.caveats.map((c) => c.id)).toContain('clamped');
  });

  it('All data has no comparison', () => {
    const { model } = build('range=all');
    expect(model.comparisonLine).toBeNull();
    expect(model.comparisonReason).toMatch(/^No full previous period/);
    for (const tile of model.tiles) expect(tile.unavailable).toBe(model.comparisonReason!.split(':')[0]);
  });

  it('an empty range has no NaN, Infinity or undefined', () => {
    const { model } = build('start=2026-09-10&end=2026-09-12', templates, emptyRangeStore());
    expect(model.empty).toBe(true);
    expect(JSON.stringify(model)).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('estimate notes', () => {
    const notes = printEstimateNotes(28);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toBe(estimateFormulas(28)[0]!.formula);
    expect(notes[1]).toBe(
      "Est. missed-call value = the campaign's booking rate × its average booking value, using rates from the whole export. Missed calls shows the full formula.",
    );
    const { view, model } = build('range=last7');
    expect(model.estimateNotes).toEqual(printEstimateNotes(view.range.days));
    expect(printEstimateNotes(1)[0]).toContain('1 day');
  });

  it('uses no clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2031-05-05T12:00:00Z');
    const { model } = build('range=last7');
    expect(JSON.stringify(model)).not.toContain('2031');
  });
});

describe('canPrint', () => {
  const overviewReady: RequestState<unknown> = { status: 'ready', key: 'k', data: {} };
  const readyAll = allTakeaways((v) => ready(v, 't'));

  it.each([
    ['null', null],
    ['loading', { status: 'loading', key: 'k' } as RequestState<unknown>],
    ['failed', { status: 'failed', key: 'k', error: {} } as unknown as RequestState<unknown>],
  ])('is false when the overview is %s', (_name, overview) => {
    expect(canPrint(overview, readyAll)).toBe(false);
  });

  it('is false when any takeaway is loading', () => {
    expect(canPrint(overviewReady, { ...readyAll, locations: loading })).toBe(false);
  });

  it('is true when all are ready, or a mix of ready, failed and null', () => {
    expect(canPrint(overviewReady, readyAll)).toBe(true);
    expect(canPrint(overviewReady, { ...readyAll, campaigns: failed, 'missed-calls': null })).toBe(true);
  });
});
