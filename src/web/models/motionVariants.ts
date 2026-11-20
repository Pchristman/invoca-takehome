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
    // Leaving is quicker than arriving.
    exit: { opacity: 0, y: 0, transition: { duration: settings.fast, ease: settings.ease } },
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

// Views transition; range, campaign and office changes do not (they keep focus and sort).
export function transitionKey(state: UrlState): string {
  return state.answer !== null ? 'answer' : state.view;
}

// The key of the content under the takeaway: the view, plus the range and the comparison, so a new range
// transitions the same way a tab switch does. Campaign and office choices do not (they keep focus and sort).
export function contentKey(state: UrlState): string {
  return JSON.stringify([transitionKey(state), state.range, state.compare]);
}
