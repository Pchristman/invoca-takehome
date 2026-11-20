import type { TakeawayShow } from '../models/takeawayModel';
import { Reveal, RevealPresence } from './Reveal';

/** One sentence about the view, marked AI or template. An add-on: the view is complete without it. */
export function Takeaway({ show }: { show: TakeawayShow }) {
  return (
    <RevealPresence wait>
      {show.kind !== 'hidden' && (
        <Reveal key={show.kind} kind="takeaway" id={show.kind}>
          <TakeawayBody show={show} />
        </Reveal>
      )}
    </RevealPresence>
  );
}

function TakeawayBody({ show }: { show: Exclude<TakeawayShow, { kind: 'hidden' }> }) {
  if (show.kind === 'loading') {
    return (
      <p className="takeaway loading" role="status">
        {show.label}
      </p>
    );
  }
  return (
    <section className="takeaway" aria-label="Takeaway">
      <span className="badge takeaway-marker">{show.marker}</span>
      <p className="takeaway-text">{show.text}</p>
      {show.note !== null && <p className="takeaway-note small muted">{show.note}</p>}
    </section>
  );
}
