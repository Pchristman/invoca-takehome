import type { ReactNode } from 'react';
import { Reveal, RevealPresence } from './Reveal';

/** One view on screen at a time: the old one leaves, then the new one comes in. Not on first load. */
export function ViewTransition({ id, children }: { id: string; children: ReactNode }) {
  return (
    <RevealPresence wait>
      <Reveal key={id} kind="view" id={id}>
        {children}
      </Reveal>
    </RevealPresence>
  );
}
