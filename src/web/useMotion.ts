import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { MotionConfig, useReducedMotion } from 'motion/react';
import { MOTION_OFF, readMotionCss, resolveMotion, type MotionSettings } from './models/motionSettings';

// Default is "off", so a component rendered outside MotionRoot (every render test) never animates.
export const MotionContext = createContext<MotionSettings>(MOTION_OFF);

export function useMotion(): MotionSettings {
  return useContext(MotionContext);
}

// Reads the timing from the CSS tokens and follows the reduced-motion setting while the app is open.
export function MotionRoot({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion() ?? false;
  const settings = useMemo(
    () => resolveMotion({ reduced, ...readMotionCss(getComputedStyle(document.documentElement)) }),
    [reduced],
  );
  return createElement(
    MotionConfig,
    { reducedMotion: 'user' },
    createElement(MotionContext, { value: settings }, children),
  );
}
