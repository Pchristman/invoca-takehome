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

// New content replacing the dimmed old content: it starts from the dimmed look and rises into place.
// Null when motion is off. Played with element.animate, so nothing is remounted (charts and sort stay put).
export function settleAnimation(
  settings: MotionSettings,
): { keyframes: { opacity: number; transform: string }[]; options: { duration: number; easing: string } } | null {
  if (!settings.enabled) return null;
  return {
    keyframes: [
      { opacity: 0.55, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    options: { duration: settings.base * 1000, easing: `cubic-bezier(${settings.ease.join(', ')})` },
  };
}
