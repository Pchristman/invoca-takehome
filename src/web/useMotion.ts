import { createContext, createElement, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { MOTION_OFF, readMotionCss, resolveMotion, type MotionSettings } from './models/motionSettings';
import { reducedMotionStore } from './models/reducedMotion';

// Default is "off", so a component rendered outside MotionRoot (every render test) never animates.
export const MotionContext = createContext<MotionSettings>(MOTION_OFF);

export function useMotion(): MotionSettings {
  return useContext(MotionContext);
}

const reducedStore = reducedMotionStore(() =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : undefined,
);

// Reads the timing from the CSS tokens and follows the OS reduced-motion setting live.
// (motion's own useReducedMotion never updates after first render, so we subscribe ourselves.)
export function MotionRoot({ children }: { children: ReactNode }) {
  const reduced = useSyncExternalStore(reducedStore.subscribe, reducedStore.getSnapshot, reducedStore.getServerSnapshot);
  const settings = useMemo(
    () => resolveMotion({ reduced, ...readMotionCss(getComputedStyle(document.documentElement)) }),
    [reduced],
  );
  // MotionConfig reducedMotion="user" stays as a backstop: it makes motion drop transform
  // animations for any motion element that is not driven by our settings.
  return createElement(
    MotionConfig,
    { reducedMotion: 'user' },
    createElement(MotionContext, { value: settings }, children),
  );
}
