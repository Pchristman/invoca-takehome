import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MotionContext, useMotion } from '../../src/web/useMotion';
import { MOTION_OFF } from '../../src/web/models/motionSettings';
import { OverviewView } from '../../src/web/components/OverviewView';
import { formatCount, formatRate, formatUsd } from '../../src/core/views/format';
import { parseUrlState } from '../../src/web/urlState';
import { overviewFor, missedCallsFor, plantedStore, metaFor } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ViewTransition } from '../../src/web/components/ViewTransition';
import { Reveal } from '../../src/web/components/Reveal';
import { Takeaway } from '../../src/web/components/Takeaway';
import { Heatmap } from '../../src/web/components/Heatmap';
import { heatmapModel } from '../../src/web/models/heatmapModel';
import { PrintSummary } from '../../src/web/components/PrintSummary';
import { printModel } from '../../src/web/models/printModel';
import type { TakeawayShow } from '../../src/web/models/takeawayModel';

function Probe() {
  return <span>{String(useMotion().enabled)}</span>;
}

describe('useMotion', () => {
  it('is off with no provider', () => {
    expect(renderToStaticMarkup(<Probe />)).toBe('<span>false</span>');
  });

  it('follows the provider', () => {
    const on = { enabled: true, fast: 0.15, base: 0.2, slow: 0.3, ease: [0.2, 0, 0, 1] as [number, number, number, number] };
    expect(renderToStaticMarkup(<MotionContext value={on}><Probe /></MotionContext>)).toBe('<span>true</span>');
  });
});

describe('AnimatedNumber and the Overview tiles', () => {
  const ON = { enabled: true, fast: 0.15, base: 0.2, slow: 0.3, ease: [0.2, 0, 0, 1] as [number, number, number, number] };
  const view = overviewFor('range=last7');
  const state = parseUrlState('?view=overview&range=last7');
  const span = { start: view.range.start, end: view.range.end };
  const text = (html: string) => html.replace(/ style="[^"]*"/g, '').replace(/<[^>]*>/g, '');

  it('the first frame is the server text, with motion on or off (server render runs no effects)', () => {
    const render = (m: typeof ON | typeof MOTION_OFF) =>
      renderToStaticMarkup(
        <MotionContext value={m}>
          <OverviewView view={view} state={state} span={span} />
        </MotionContext>,
      );
    const on = text(render(ON));
    expect(on).toBe(text(render(MOTION_OFF)));
    const raw = view.tiles;
    for (const value of [
      formatCount(raw.calls.current!),
      formatCount(raw.uniqueCallers.current!),
      formatRate(raw.answerRate.current!),
      formatCount(raw.bookings.current!),
      formatUsd(raw.revenueUsd.current!),
    ])
      expect(on).toContain(value);
  });

});

describe('views, takeaway, panels and heatmap (Task 5)', () => {
  const ON = { enabled: true, fast: 0.15, base: 0.2, slow: 0.3, ease: [0.2, 0, 0, 1] as [number, number, number, number] };
  const src = (...parts: string[]) => readFileSync(join(process.cwd(), 'src', 'web', ...parts), 'utf8');
  const withMotion = (m: typeof ON | typeof MOTION_OFF, node: React.ReactNode) =>
    renderToStaticMarkup(<MotionContext value={m}>{node}</MotionContext>);
  const shows: TakeawayShow[] = [
    { kind: 'ready', text: 'Calls rose.', marker: 'AI', note: null },
    { kind: 'ready', text: 'Calls fell.', marker: 'template', note: 'AI is off: no API key.' },
    { kind: 'loading', label: 'Loading takeaway...' },
    { kind: 'hidden' },
  ];
  const hiddenStyle = /opacity\s*:\s*0(?![.\d])/;

  it('off means plain markup', () => {
    const nodes = [
      <ViewTransition id="overview"><p>Hello view</p></ViewTransition>,
      <Reveal kind="panel" id="p"><p>Hello panel</p></Reveal>,
      <Takeaway show={shows[0]!} />,
      <Takeaway show={shows[2]!} />,
    ];
    for (const node of nodes) {
      const out = withMotion(MOTION_OFF, node);
      expect(out).not.toMatch(hiddenStyle);
      expect(out).not.toContain('transform');
    }
    expect(withMotion(MOTION_OFF, nodes[0]!)).toContain('Hello view');
  });

  it('on, the first render is not hidden', () => {
    const view = withMotion(ON, <ViewTransition id="overview"><p>Hello view</p></ViewTransition>);
    expect(view).toContain('Hello view');
    expect(view).not.toMatch(hiddenStyle);
    expect(withMotion(ON, <Takeaway show={shows[0]!} />)).toContain('Calls rose.');
  });

  it('the takeaway keeps its text and marker, on and off', () => {
    for (const m of [ON, MOTION_OFF]) {
      const [ai, template, loading, hidden] = shows.map((s) => withMotion(m, <Takeaway show={s} />));
      expect(ai).toContain('Calls rose.');
      expect(ai).toContain('AI');
      expect(template).toContain('template');
      expect(template).toContain('AI is off: no API key.');
      expect(loading).toContain('Loading takeaway...');
      expect(loading).not.toContain('Calls rose.');
      expect(hidden).toBe('');
    }
  });

  it('the heatmap keeps both mode labels, cell counts and titles', () => {
    const view = missedCallsFor('range=all', plantedStore('answer-worse'));
    for (const m of [ON, MOTION_OFF]) {
      for (const mode of ['office', 'weekday'] as const) {
        const model = heatmapModel(view.heatmap, mode);
        const out = withMotion(m, <Heatmap model={model} mode={mode} onModeChange={() => {}} />);
        expect(out).toContain('By office');
        expect(out).toContain('By weekday');
        for (const cell of model.rows.flatMap((r) => r.cells)) expect(out).toContain(`title="${cell.label}"`);
        expect(out).not.toMatch(hiddenStyle);
      }
    }
  });

  it('no motion in the print path', () => {
    for (const file of [['components', 'PrintSummary.tsx'], ['models', 'printModel.ts'], ['models', 'motionVariants.ts']]) {
      expect(src(...file)).not.toMatch(/from\s+['"](framer-motion|motion\/react|motion)['"]/);
    }
    const store = plantedStore('none');
    const view = overviewFor('range=last7', store);
    const meta = metaFor(store);
    const model = printModel({ view, meta, span: meta.span!, takeaways: { overview: null, campaigns: null, locations: null, 'missed-calls': null } });
    const out = withMotion(ON, <PrintSummary model={model} />);
    expect(out).not.toContain('style=');
    expect(out).not.toContain('data-motion');
  });

  it('the content key comes from contentKey (view, range, comparison) and never from campaign or location', () => {
    const app = src('App.tsx');
    expect(app).toMatch(/<ViewTransition id=\{contentKey\(state\)\}>/);
    expect(app).not.toMatch(/<ViewTransition[^>]*(campaign|location)/);
  });
});
