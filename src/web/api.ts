import type { ApiErrorCode } from '../server/api';

/** The server's own codes, plus two the browser adds when there is no usable server reply. */
export type ClientErrorCode = ApiErrorCode | 'network' | 'bad_response';

export interface ClientError {
  code: ClientErrorCode;
  message: string;
  field?: string;
  status?: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ClientError };

// Plain sentences. Raw error text ("Failed to fetch", "Unexpected token <") never reaches the screen.
const NETWORK_MESSAGE = 'Could not reach the API. Check that the server is running (npm start), then try again.';
const BAD_RESPONSE_MESSAGE =
  'The API sent back something that is not data. Check that the server is running (npm start), then try again.';

/** Read the body as JSON; undefined when it is empty or not JSON. */
async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text === '' ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A body shaped { error: { code, message, field? } }, or undefined. */
function readServerError(body: unknown): ClientError | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, message, field } = error as { code?: unknown; message?: unknown; field?: unknown };
  if (typeof code !== 'string' || typeof message !== 'string') return undefined;
  const result: ClientError = { code: code as ApiErrorCode, message };
  if (typeof field === 'string') result.field = field;
  return result;
}

/** GET a path from the API. Never throws: every failure comes back as { ok: false, error }. */
export async function fetchApi<T>(
  path: string,
  params?: URLSearchParams,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<ApiResult<T>> {
  const query = params ? params.toString() : '';
  const url = query === '' ? path : `${path}?${query}`;

  let response: Response;
  try {
    response = await fetchFn(url, { signal });
  } catch {
    // Server down, DNS, or aborted.
    return { ok: false, error: { code: 'network', message: NETWORK_MESSAGE } };
  }

  const body = await readJson(response);

  if (response.ok) {
    if (body === undefined) return { ok: false, error: { code: 'bad_response', message: BAD_RESPONSE_MESSAGE } };
    return { ok: true, data: body as T };
  }

  const serverError = readServerError(body);
  if (serverError) return { ok: false, error: { ...serverError, status: response.status } };
  return { ok: false, error: { code: 'network', message: NETWORK_MESSAGE, status: response.status } };
}
