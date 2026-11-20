import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MotionContext, useMotion } from '../../src/web/useMotion';
import { MOTION_OFF } from '../../src/web/models/motionSettings';
import { AnimatedNumber } from '../../src/web/components/AnimatedNumber';
import { OverviewView } from '../../src/web/components/OverviewView';
import { overviewModel } from '../../src/web/models/overviewModel';
import { parseUrlState } from '../../src/web/urlState';
import { overviewFor } from './fixtures';

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

  it('rests on the server text, with motion on or off', () => {
    const render = (m: typeof ON | typeof MOTION_OFF) =>
      renderToStaticMarkup(
        <MotionContext value={m}>
          <OverviewView view={view} state={state} span={span} />
        </MotionContext>,
      );
    const on = text(render(ON));
    expect(on).toBe(text(render(MOTION_OFF)));
    for (const tile of overviewModel(view).tiles) expect(on).toContain(tile.value);
  });

  it('renders no tween bookkeeping when motion is off', () => {
    const html = renderToStaticMarkup(
      <MotionContext value={MOTION_OFF}>
        <AnimatedNumber id="calls" text="1,204" figure={{ value: 1204, kind: 'count' }} />
      </MotionContext>,
    );
    expect(html).toBe('<span class="figure">1,204</span>');
  });
});
