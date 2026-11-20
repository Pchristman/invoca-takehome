import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { revealFor, type RevealKind } from '../models/motionVariants';
import { useMotion } from '../useMotion';

/**
 * Fades and rises in, fades out. Put it inside <RevealPresence> and give it a key at the call site.
 * With motion off it is a plain div, so no opacity or transform is ever written (nothing can stick half-faded).
 */
export function Reveal({ kind, id, children }: { kind: RevealKind; id: string; children: ReactNode }) {
  const settings = useMotion();
  if (!settings.enabled) return <div data-reveal={id}>{children}</div>;
  const reveal = revealFor(settings, kind);
  return (
    <motion.div data-motion={kind} data-reveal={id} initial={reveal.initial} animate={reveal.animate} exit={reveal.exit} transition={reveal.transition}>
      {children}
    </motion.div>
  );
}

/** The call-site wrapper for Reveal: not on first render; "wait" lets the old one leave before the new one enters. */
export function RevealPresence({ wait = false, children }: { wait?: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false} mode={wait ? 'wait' : 'sync'}>
      {children}
    </AnimatePresence>
  );
}
