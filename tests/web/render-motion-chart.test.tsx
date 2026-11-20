// WeeklyChart with motion on and off: the same words, the same hidden table, the same legend.
// Animation only changes how bars are drawn, never what the page says. Source check: no hard-coded animation props.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WeeklyChart } from '../../src/web/components/WeeklyChart';
import { MOTION_OFF, type MotionSettings } from '../../src/web/models/motionSettings';
import { weeklyChartModel } from '../../src/web/models/weeklyChart';
import { MotionContext } from '../../src/web/useMotion';
import { campaignsFor } from './fixtures';

const MOTION_ON: MotionSettings = { enabled: true, fast: 0.15, base: 0.2, slow: 0.3, ease: [0.2, 0, 0, 1] };
const model = weeklyChartModel(campaignsFor('range=all').weekly)!;

function html(settings: MotionSettings, m = model): string {
  return renderToStaticMarkup(
    <MotionContext value={settings}>
      <WeeklyChart model={m} />
    </MotionContext>,
  );
}

describe('WeeklyChart with motion on and off', () => {
  it('prints the same page either way', () => {
    expect(html(MOTION_ON)).toBe(html(MOTION_OFF));
  });

  it('keeps the hidden table rows and the partial-week legend', () => {
    const on = html(MOTION_ON);
    expect(model.hasPartial).toBe(true);
    expect(on).toContain('Hatched bars are partial weeks.');
    for (const bar of model.bars) expect(on).toContain(bar.range);
    expect(on.match(/<tr>/g)).toHaveLength(model.bars.length + 1);
  });

  it('says "No calls in these weeks." for an all-zero model, either way', () => {
    const zero = { ...model, allZero: true };
    expect(html(MOTION_ON, zero)).toContain('No calls in these weeks.');
    expect(html(MOTION_OFF, zero)).toContain('No calls in these weeks.');
  });
});

describe('WeeklyChart source', () => {
  it('takes its animation from chartAnimation, not hard-coded props', () => {
    const src = readFileSync('src/web/components/WeeklyChart.tsx', 'utf8');
    expect(src).not.toContain('isAnimationActive={false}');
    expect(src).not.toMatch(/animationDuration=\{?\s*\d/);
    expect(src).toContain('chartAnimation(');
  });
});
