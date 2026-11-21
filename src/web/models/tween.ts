// Tile numbers count from the last value shown to the new one. Display only: at rest the text is the server's own.
import { formatCount, formatRate, formatUsd } from '../../core/views/format';

export type FigureKind = 'count' | 'rate' | 'usd';

/** The one formatter for a tile figure, used for the resting text and for every frame between. */
export function formatFigure(kind: FigureKind, value: number): string {
  if (kind === 'rate') return formatRate(value);
  if (kind === 'usd') return formatUsd(value);
  return formatCount(value);
}

/**
 * Where a tween starts, or null when the number should simply appear.
 * `shown` is the number on screen while a tween runs (a retarget starts there), else null.
 */
export function tweenPlan(input: {
  enabled: boolean;
  to: number | null;
  shown: number | null;
  remembered: number | null;
}): { from: number } | null {
  const { enabled, to, shown, remembered } = input;
  if (!enabled || to === null || !Number.isFinite(to)) return null;
  const from = shown ?? remembered;
  if (from === null || !Number.isFinite(from) || from === to) return null;
  return { from };
}

const remembered = new Map<string, number>();

export function rememberFigure(id: string, value: number): void {
  remembered.set(id, value);
}

export function recallFigure(id: string): number | null {
  return remembered.get(id) ?? null;
}

export function forgetFigure(id: string): void {
  remembered.delete(id);
}

/** What the ticker needs from a tween library: motion's `animate`, with the duration and ease already applied. */
export type TweenAnimator = (
  from: number,
  to: number,
  handlers: { onUpdate: (latest: number) => void; onComplete: () => void },
) => { stop(): void };

export interface TileTicker {
  /** The tile got new props: stop what runs, then either write the text at once or count to it. */
  show(input: { enabled: boolean; text: string; figure: { value: number; kind: FigureKind } | null; animate: TweenAnimator }): void;
  /** Before printing: jump to the exact server text and stop. */
  finish(): void;
  /** Leaving the screen: stop, and remember what the user last saw. */
  stop(): void;
}

/**
 * The decision sequence of one tile, with the DOM and the clock injected so it can be tested.
 * Rule for where a count starts: the last value that tile showed. While a tween runs that is the
 * on-screen frame (not its target); when it ends or the tile never tweened, it is the final value.
 * The range label plays no part: the same tile under a new range counts from what it last showed.
 */
export function createTileTicker(deps: { id: string; write: (text: string) => void; format?: (kind: FigureKind, value: number) => string }): TileTicker {
  const format = deps.format ?? formatFigure;
  let handle: { stop(): void } | null = null;
  let live: number | null = null; // the number on screen while a tween runs
  let finalText = '';
  let target: number | null = null;

  function halt(): number | null {
    const onScreen = live;
    handle?.stop();
    handle = null;
    live = null;
    return onScreen;
  }

  return {
    show({ enabled, text, figure, animate }) {
      const shown = halt();
      finalText = text;
      deps.write(text);
      if (figure === null) {
        target = null;
        forgetFigure(deps.id);
        return;
      }
      const plan = tweenPlan({ enabled, to: figure.value, shown, remembered: recallFigure(deps.id) });
      target = figure.value;
      rememberFigure(deps.id, figure.value);
      if (plan === null) return;

      const { kind, value: to } = figure;
      deps.write(format(kind, plan.from));
      live = plan.from;
      let mine: { stop(): void } | null = null;
      const started = animate(plan.from, to, {
        onUpdate: (latest) => {
          if (handle !== mine) return;
          live = latest;
          deps.write(format(kind, latest));
        },
        onComplete: () => {
          if (handle !== mine) return;
          handle = null;
          live = null;
          deps.write(finalText);
        },
      });
      mine = started;
      // If the animator finished before returning, onComplete already ran against a null handle; keep it settled.
      if (live !== null) handle = started;
    },
    finish() {
      if (handle === null) return;
      halt();
      if (target !== null) rememberFigure(deps.id, target);
      deps.write(finalText);
    },
    stop() {
      const onScreen = halt();
      if (onScreen !== null) rememberFigure(deps.id, onScreen);
    },
  };
}
