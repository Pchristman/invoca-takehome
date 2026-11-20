import type { PrintBlock, PrintModel } from '../models/printModel';
import { TONE_WORD } from '../models/changeModel';
import type { TakeawayShow } from '../models/takeawayModel';
import { Caveats } from './Caveats';
import { Link } from './Link';

/** The one-page document. Plain text only: no links, no buttons, no dev content. Draws the model and decides nothing. */
export function PrintSummary({ model }: { model: PrintModel }) {
  return (
    <article className="print-page">
      <header className="print-head">
        <h1>Inbound call performance summary</h1>
        <p className="print-meta">{[model.rangeLine, model.asOf, model.skipped].filter((part) => part !== null).join(' · ')}</p>
      </header>
      <Caveats items={model.caveats} />
      {model.comparisonLine !== null && <p className="print-note">{model.comparisonLine}</p>}
      <section className="print-tiles" aria-label="Key numbers">
        {model.tiles.map((tile) => (
          <div className="print-tile" key={tile.key}>
            <div className="print-tile-label">{tile.label}</div>
            <div className="print-tile-value">{tile.value}</div>
            {tile.previous !== null && <div className="print-note">{tile.previous}</div>}
            {tile.change !== null && (
              <div className="print-note">
                {tile.change.text} ({TONE_WORD[tile.change.tone]})
              </div>
            )}
            {tile.unavailable !== null && <div className="print-note">{tile.unavailable}</div>}
          </div>
        ))}
      </section>
      {model.comparisonReason !== null && <p className="print-note">{model.comparisonReason}</p>}
      {model.empty && <p>No calls in this range.</p>}
      <PrintTakeaway show={model.overviewTakeaway} />
      {model.blocks.map((block) => (
        <Block key={block.view} block={block} />
      ))}
      <footer className="print-estimates">
        {model.estimateNotes.map((note) => (
          <p key={note} className="print-note">
            {note}
          </p>
        ))}
      </footer>
    </article>
  );
}

function Block({ block }: { block: PrintBlock }) {
  return (
    <section className="print-block">
      <h2>{block.label}</h2>
      <ul>
        {block.actions.map((action) => (
          <li key={action.text} className={action.actionable ? undefined : 'muted'}>
            {action.text}
          </li>
        ))}
      </ul>
      <PrintTakeaway show={block.takeaway} />
    </section>
  );
}

// Only a ready takeaway is drawn: a loading or hidden one leaves no text and no empty section on paper.
function PrintTakeaway({ show }: { show: TakeawayShow }) {
  if (show.kind !== 'ready') return null;
  return (
    <section className="print-takeaway">
      <span className="badge takeaway-marker">{show.marker}</span> <span>{show.text}</span>
    </section>
  );
}

/** On screen only: the Print button (not usable while takeaways are loading) and the way back to the app. */
export function PrintControls({ canPrint, backHref }: { canPrint: boolean; backHref: string }) {
  return (
    <div className="no-print print-controls">
      <button type="button" className="button" disabled={!canPrint} onClick={() => window.print()}>
        Print
      </button>
      <Link href={backHref}>Open the app</Link>
    </div>
  );
}
