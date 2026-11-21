import type { ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { revealFor, type RevealKind } from '../models/motionVariants';
import { useMotion } from '../useMotion';

// While a view fades out it is still on screen; inert stops it being clicked with old state.
export function inertWhenLeaving(isPresent: boolean): true | undefined {
  return isPresent ? undefined : true;
}

function MotionReveal({ kind, id, children }: { kind: RevealKind; id: string; children: ReactNode }) {
  const reveal = revealFor(useMotion(), kind);
  const isPresent = useIsPresent();
  return (
    <motion.div
      data-motion={kind}
      data-reveal={id}
      data-reveal-kind={kind}
      inert={inertWhenLeaving(isPresent)}
      initial={reveal.initial}
      animate={reveal.animate}
      exit={reveal.exit}
      transition={reveal.transition}
    >
      {children}
    </motion.div>
  );
}

/**
 * Fades and rises in, fades out. Put it inside <RevealPresence> and give it a key at the call site.
 * With motion off it is a plain div, so no opacity or transform is ever written (nothing can stick half-faded).
 * Both carry data-reveal-kind, so the layout rules (a view keeps its height while the next one loads) apply either way.
 */
export function Reveal({ kind, id, children }: { kind: RevealKind; id: string; children: ReactNode }) {
  if (!useMotion().enabled) {
    return (
      <div data-reveal={id} data-reveal-kind={kind}>
        {children}
      </div>
    );
  }
  return <MotionReveal kind={kind} id={id}>{children}</MotionReveal>;
}

/**
 * The call-site wrapper for Reveal: not on first render; "wait" lets the old one leave before the new one enters.
 * With motion off it renders its children directly, so nothing keeps the old view around.
 * Trade-off: toggling the setting swaps AnimatePresence in or out, which remounts the children
 * (their local state is lost once). Acceptable: the OS setting rarely changes mid-session.
 */
export function RevealPresence({ wait = false, children }: { wait?: boolean; children: ReactNode }) {
  if (!useMotion().enabled) return <>{children}</>;
  return (
    <AnimatePresence initial={false} mode={wait ? 'wait' : 'sync'}>
      {children}
    </AnimatePresence>
  );
}
