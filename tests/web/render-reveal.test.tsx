import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MotionContext } from '../../src/web/useMotion';
import { MOTION_OFF, type MotionSettings } from '../../src/web/models/motionSettings';
import { Reveal, RevealPresence, inertWhenLeaving } from '../../src/web/components/Reveal';

const ON: MotionSettings = { enabled: true, fast: 0.15, base: 0.25, slow: 0.3, ease: [0.2, 0, 0, 1] };

describe('inertWhenLeaving', () => {
  it('is inert only once the view has stopped being present', () => {
    expect(inertWhenLeaving(true)).toBeUndefined();
    expect(inertWhenLeaving(false)).toBe(true);
  });
});

describe('Reveal markup', () => {
  it('a present view is not inert', () => {
    const html = renderToStaticMarkup(
      <MotionContext value={ON}>
        <RevealPresence>
          <Reveal key="a" kind="view" id="a">hello</Reveal>
        </RevealPresence>
      </MotionContext>,
    );
    expect(html).toContain('data-motion="view"');
    expect(html).not.toContain('inert');
  });
});

describe('RevealPresence with motion off', () => {
  const show = (key: string) =>
    renderToStaticMarkup(
      <MotionContext value={MOTION_OFF}>
        <RevealPresence wait>
          <Reveal key={key} kind="view" id={key}>content-{key}</Reveal>
        </RevealPresence>
      </MotionContext>,
    );

  it('renders the children with no data-motion', () => {
    const html = show('a');
    expect(html).toContain('content-a');
    expect(html).not.toContain('data-motion');
  });

  it('still marks a view for the height hold, so a range change does not blank and jump the page', () => {
    expect(show('a')).toContain('data-reveal-kind="view"');
  });

  it('after a key switch only the current child is in the markup', () => {
    const html = show('b');
    expect(html).toContain('content-b');
    expect(html).not.toContain('content-a');
  });
});
