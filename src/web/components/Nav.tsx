import type { ViewName } from '../../core/views/facts';
import { VIEW_ORDER, withView, toSearch } from '../urlState';
import type { UrlState } from '../urlState';
import { Link } from './Link';

export const VIEW_LABELS: Record<ViewName, string> = {
  overview: 'Overview',
  campaigns: 'Campaigns',
  locations: 'Locations',
  'missed-calls': 'Missed calls',
};

/** Four links. Each keeps the range, comparison and dev, and drops the campaign and location pick. */
export function Nav({ state }: { state: UrlState }) {
  return (
    <nav aria-label="Views">
      <ul className="nav">
        {VIEW_ORDER.map((view) => (
          <li key={view}>
            <Link
              href={`/${toSearch({ ...withView(state, view), campaign: null, location: null })}`}
              ariaCurrent={view === state.view ? 'page' : undefined}
            >
              {VIEW_LABELS[view]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
