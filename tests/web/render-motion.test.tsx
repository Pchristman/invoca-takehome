import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MotionContext, useMotion } from '../../src/web/useMotion';

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
