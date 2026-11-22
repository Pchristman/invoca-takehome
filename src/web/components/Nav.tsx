import { VIEW_LABELS } from '../models/viewLabels';
import { VIEW_ORDER, withView, toSearch } from '../urlState';
import type { UrlState } from '../urlState';
import { Link } from './Link';

/** Four links. Each keeps the range and comparison, and drops the campaign and location pick. */
export function Nav({ state }: { state: UrlState }) {
  return (
    <nav aria-label="Views">
      <ul className="nav">
        {VIEW_ORDER.map((view) => (
          <li key={view}>
            <Link
              href={`/${toSearch({ ...withView(state, view), campaign: null, location: null })}`}
              ariaCurrent={state.answer === null && view === state.view ? 'page' : undefined}
            >
              {VIEW_LABELS[view]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
