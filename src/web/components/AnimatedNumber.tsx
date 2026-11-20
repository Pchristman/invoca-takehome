import { useLayoutEffect, useRef } from 'react';
import { animate } from 'motion/react';
import { formatFigure, recallFigure, rememberFigure, tweenPlan } from '../models/tween';
import type { FigureKind } from '../models/tween';
import { useMotion } from '../useMotion';

// One tile figure. It renders the server's text; in the browser it may count up from the last value shown.
// The text at rest is always `text`, written again when the animation ends.
export function AnimatedNumber({ id, text, figure }: { id: string; text: string; figure: { value: number; kind: FigureKind } | null }) {
  const { enabled, base, ease } = useMotion();
  const span = useRef<HTMLSpanElement>(null);
  const running = useRef<{ stop(): void } | null>(null);
  const live = useRef<number | null>(null); // the value on screen while a tween runs

  // Before first paint, so the final value never flashes before the count starts.
  useLayoutEffect(() => {
    const node = span.current;
    running.current?.stop(); // a new target replaces the running tween
    running.current = null;
    const shown = live.current;
    live.current = null;
    if (node === null) return;
    node.textContent = text;
    if (figure === null) return;

    const plan = tweenPlan({ enabled, to: figure.value, shown, remembered: recallFigure(id) });
    rememberFigure(id, figure.value);
    if (plan === null) return;

    const { kind, value: to } = figure;
    node.textContent = formatFigure(kind, plan.from);
    live.current = plan.from;
    running.current = animate(plan.from, to, {
      duration: base,
      ease,
      onUpdate: (latest) => {
        live.current = latest;
        node.textContent = formatFigure(kind, latest);
      },
      onComplete: () => {
        live.current = null;
        running.current = null;
        node.textContent = text;
      },
    });
  }, [id, text, figure?.value, figure?.kind, enabled, base, ease]);

  // Leaving the screen cancels whatever is running.
  useLayoutEffect(() => () => running.current?.stop(), []);

  return <span ref={span} className="figure">{text}</span>;
}
