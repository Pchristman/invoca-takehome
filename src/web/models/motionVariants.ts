// What moves and how. Pure rules, no React: every duration and the ease come from
// MotionSettings, so reduced motion (or an unreadable token) turns everything off here.
import type { Ease, MotionSettings } from './motionSettings';
import type { UrlState } from '../urlState';

export type RevealKind = 'view' | 'panel' | 'takeaway';

export interface Reveal {
  initial: { opacity: number; y: number };
  animate: { opacity: 1; y: 0 };
  exit: { opacity: number; y: number; transition: { duration: number; ease: Ease } };
  transition: { duration: number; ease: Ease };
}

// How far content rises while it fades in, in px (a distance, not a duration).
const RISE_PX = 6;

const AT_REST = { opacity: 1, y: 0 } as const;

export function revealFor(settings: MotionSettings, kind: RevealKind): Reveal {
  // Off: every state is the resting state, so nothing can stick half-faded.
  if (!settings.enabled) {
    return {
      initial: { ...AT_REST },
      animate: { ...AT_REST },
      exit: { ...AT_REST, transition: { duration: 0, ease: settings.ease } },
      transition: { duration: 0, ease: settings.ease },
    };
  }
  return {
    initial: { opacity: 0, y: RISE_PX },
    animate: { ...AT_REST },
    // Leaving is quicker than arriving. A view leaves in half the fast time, because the next view waits for it.
    exit: { opacity: 0, y: 0, transition: { duration: kind === 'view' ? settings.fast / 2 : settings.fast, ease: settings.ease } },
    transition: { duration: kind === 'takeaway' ? settings.fast : settings.base, ease: settings.ease },
  };
}

// Recharts takes milliseconds and a keyword ease; ease-out is the nearest to the token's curve.
export function chartAnimation(settings: MotionSettings): {
  isAnimationActive: boolean;
  animationDuration: number;
  animationEasing: 'ease-out';
} {
  return {
    isAnimationActive: settings.enabled,
    animationDuration: settings.base * 1000,
    animationEasing: 'ease-out',
  };
}

// The key of the content under the range control: the view (or the answer page), the range and the comparison.
// A change of any of them remounts the content, so a new range transitions the same way a tab switch does.
// Table sorts and the heatmap mode live in the URL, so the remount keeps them. Campaign and office choices are
// not in the key: the screen (and focus) stays in place while only the chart or the list updates.
export function contentKey(state: UrlState): string {
  return JSON.stringify([state.answer !== null ? 'answer' : state.view, state.range, state.compare]);
}
