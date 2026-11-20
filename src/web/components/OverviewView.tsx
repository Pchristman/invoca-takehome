import type { DateRange } from '../../core/ranges';
import type { OverviewView as OverviewData } from '../../core/views';
import { caveatsFor } from '../models/caveats';
import { comparisonLine } from '../models/comparisonLine';
import { overviewModel } from '../models/overviewModel';
import { TONE_WORD } from '../models/changeModel';
import { actionHref } from '../urlState';
import type { UrlState } from '../urlState';
import { Caveats } from './Caveats';
import { Link } from './Link';

export function OverviewView({ view, state, span }: { view: OverviewData; state: UrlState; span: DateRange }) {
  const model = overviewModel(view);
  const caveats = caveatsFor(view.notes, span, { comparing: true, range: view.range, view: 'overview' });
  const line = comparisonLine(view.notes, view.range);

  return (
    <>
      <Caveats items={caveats} />
      {line !== null && <p className="muted small">{line}</p>}
      <section className="tile-grid" aria-label="Key numbers">
        {model.tiles.map((tile) => (
          <div className="tile" key={tile.key}>
            <div className="tile-label">{tile.label}</div>
            <div className="tile-value">{tile.value}</div>
            {tile.previous !== null && <div className="tile-change muted">{tile.previous}</div>}
            {tile.change !== null && (
              <div className={`tile-change tone-${tile.change.tone}`}>
                {tile.change.text} ({TONE_WORD[tile.change.tone]})
              </div>
            )}
            {tile.unavailable !== null && <div className="tile-change muted">{tile.unavailable}</div>}
          </div>
        ))}
      </section>
      {model.comparisonReason !== null && <p className="muted small">{model.comparisonReason}</p>}
      {model.empty && <p role="status">No calls in this range.</p>}
      <section className="section">
        <h2>Top actions</h2>
        <ul>
          {model.topActions.map((item) => (
            <li key={`${item.viewLabel}-${item.text}`} className={item.actionable ? undefined : 'muted'}>
              <strong>{item.viewLabel}.</strong> {item.text}{' '}
              <Link href={actionHref(state, item.link)}>Open {item.viewLabel}</Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
