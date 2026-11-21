import { useEffect, useLayoutEffect, useRef } from 'react';
import { animate } from 'motion/react';
import { createTileTicker } from '../models/tween';
import type { FigureKind, TileTicker } from '../models/tween';
import { useMotion } from '../useMotion';

// One tile figure. It renders the server's text; in the browser it may count up from the last value shown.
// The decisions live in the tile ticker (models/tween.ts); this only hands it the DOM node and the animation library.
export function AnimatedNumber({ id, text, figure }: { id: string; text: string; figure: { value: number; kind: FigureKind } | null }) {
  const { enabled, base, ease } = useMotion();
  const span = useRef<HTMLSpanElement>(null);
  const ticker = useRef<TileTicker | null>(null);
  if (ticker.current === null) {
    ticker.current = createTileTicker({
      id,
      write: (value) => {
        if (span.current !== null) span.current.textContent = value;
      },
    });
  }

  // Before first paint, so the final value never flashes before the count starts.
  useLayoutEffect(() => {
    ticker.current!.show({
      enabled,
      text,
      figure,
      animate: (from, to, handlers) => animate(from, to, { duration: base, ease, ...handlers }),
    });
  }, [id, text, figure?.value, figure?.kind, enabled, base, ease]);

  // Printing mid-count must print the exact text, not a frame.
  useEffect(() => {
    const finish = () => ticker.current?.finish();
    window.addEventListener('beforeprint', finish);
    return () => window.removeEventListener('beforeprint', finish);
  }, []);

  // Leaving the screen cancels whatever is running.
  useLayoutEffect(() => () => ticker.current?.stop(), []);

  return <span ref={span}>{text}</span>;
}
