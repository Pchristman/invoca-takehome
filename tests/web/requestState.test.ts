import { describe, expect, it } from 'vitest';
import { initialRequest, requestReducer } from '../../src/web/requestState';
import type { RequestState } from '../../src/web/requestState';
import type { ApiResult } from '../../src/web/api';

const ok = (n: number): ApiResult<{ n: number }> => ({ ok: true, data: { n } });
const bad: ApiResult<{ n: number }> = { ok: false, error: { code: 'network', message: 'down' } };

describe('requestReducer', () => {
  it('start gives loading and drops old data', () => {
    const ready: RequestState<{ n: number }> = { status: 'ready', key: 'a', data: { n: 1 } };
    const next = requestReducer(ready, { type: 'start', key: 'b' });
    expect(next).toEqual({ status: 'loading', key: 'b' });
    expect('data' in next).toBe(false);
  });

  it('done ok gives ready; done error gives failed', () => {
    const loading = initialRequest<{ n: number }>('a');
    expect(requestReducer(loading, { type: 'done', key: 'a', result: ok(1) })).toEqual({
      status: 'ready',
      key: 'a',
      data: { n: 1 },
    });
    expect(requestReducer(loading, { type: 'done', key: 'a', result: bad })).toEqual({
      status: 'failed',
      key: 'a',
      error: bad.ok ? undefined : bad.error,
    });
  });

  it('a stale reply is ignored', () => {
    let s = initialRequest<{ n: number }>('a');
    s = requestReducer(s, { type: 'start', key: 'a' });
    s = requestReducer(s, { type: 'start', key: 'b' });
    s = requestReducer(s, { type: 'done', key: 'a', result: ok(1) });
    expect(s).toEqual({ status: 'loading', key: 'b' });
    s = requestReducer(s, { type: 'done', key: 'b', result: ok(2) });
    expect(s).toEqual({ status: 'ready', key: 'b', data: { n: 2 } });
    const after = requestReducer(s, { type: 'done', key: 'a', result: ok(1) });
    expect(after).toBe(s);
  });

  it('a reply for the current key after a failure replaces it (retry)', () => {
    let s = initialRequest<{ n: number }>('a#1');
    s = requestReducer(s, { type: 'done', key: 'a#1', result: bad });
    expect(s.status).toBe('failed');
    s = requestReducer(s, { type: 'start', key: 'a#2' });
    expect(s).toEqual({ status: 'loading', key: 'a#2' });
    s = requestReducer(s, { type: 'done', key: 'a#2', result: ok(3) });
    expect(s).toEqual({ status: 'ready', key: 'a#2', data: { n: 3 } });
  });

  it('initialRequest is loading', () => {
    expect(initialRequest('k')).toEqual({ status: 'loading', key: 'k' });
  });
});
