// Which screen the app shows, from the state of the meta request.
import type { Meta } from '../../server/api';
import type { ClientError } from '../api';
import type { RequestState } from '../requestState';

export type Screen =
  | { screen: 'loading' }
  | { screen: 'error'; error: ClientError }
  | { screen: 'empty'; notes: string[] }
  | { screen: 'ready'; meta: Meta };

export function screenFor(meta: RequestState<Meta> | null): Screen {
  if (meta === null || meta.status === 'loading') return { screen: 'loading' };
  if (meta.status === 'failed') return { screen: 'error', error: meta.error };
  if (!meta.data.hasData) return { screen: 'empty', notes: meta.data.notes };
  return { screen: 'ready', meta: meta.data };
}
