import { describe, expect, it } from 'vitest';
import { fetchApi } from '../../src/web/api';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fake fetch that records the URL it was called with. */
function fake(make: () => Response | Promise<Response>) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(String(url));
    return make();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('fetchApi', () => {
  it('ok: returns the data and builds the URL from the params', async () => {
    const f = fake(() => json({ a: 1 }));
    const result = await fetchApi('/api/overview', new URLSearchParams({ range: 'last7' }), undefined, f.fn);
    expect(result).toEqual({ ok: true, data: { a: 1 } });
    expect(f.calls).toEqual(['/api/overview?range=last7']);

    const g = fake(() => json({ a: 1 }));
    await fetchApi('/api/meta', undefined, undefined, g.fn);
    expect(g.calls).toEqual(['/api/meta']);

    const h = fake(() => json({ a: 1 }));
    await fetchApi('/api/meta', new URLSearchParams(), undefined, h.fn);
    expect(h.calls).toEqual(['/api/meta']);
  });

  it.each([
    [400, { code: 'bad_date', message: 'Start date is not a date.', field: 'start' }],
    [400, { code: 'outside_data', message: 'That range is outside the data.' }],
    [400, { code: 'unknown_campaign', message: 'No such campaign.', field: 'campaign' }],
    [409, { code: 'no_data', message: 'No calls loaded.' }],
    [500, { code: 'internal', message: 'Something went wrong.' }],
  ])('server errors keep code, message, field and status (%i %o)', async (status, error) => {
    const f = fake(() => json({ error }, status));
    const result = await fetchApi('/api/overview', undefined, undefined, f.fn);
    expect(result).toEqual({ ok: false, error: { ...error, status } });
  });

  const notApi: [string, () => Response][] = [
    ['html', () => new Response('<html>app</html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['empty body', () => new Response('', { status: 200 })],
    ['broken json', () => new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } })],
  ];
  it.each(notApi)('not the API: %s is bad_response with a plain sentence', async (_name, make) => {
    const result = await fetchApi('/api/overview', undefined, undefined, fake(make).fn);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('bad_response');
    expect(result.error.message).toMatch(/API/);
    expect(result.error.message).toMatch(/server is running/);
    expect(result.error.message).not.toContain('Unexpected token');
    expect(result.error.message).not.toContain('<');
  });

  const down: [string, () => Response | Promise<Response>][] = [
    ['502 plain text', () => new Response('Bad Gateway', { status: 502, headers: { 'content-type': 'text/plain' } })],
    ['500 empty', () => new Response('', { status: 500 })],
    ['fetch rejects', () => Promise.reject(new TypeError('Failed to fetch'))],
  ];
  it.each(down)('server down: %s is network with a plain sentence', async (_name, make) => {
    const result = await fetchApi('/api/overview', undefined, undefined, fake(make).fn);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('network');
    expect(result.error.message).toContain('npm start');
    expect(result.error.message).not.toContain('Failed to fetch');
    expect(result.error.message).not.toContain('Bad Gateway');
    expect(result.error.message).not.toContain('<');
  });

  it('aborted: returns a network result and does not throw', async () => {
    const controller = new AbortController();
    controller.abort();
    // A real fetch rejects on an aborted signal; the fake does the same.
    const f = (async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return json({});
    }) as unknown as typeof fetch;
    const result = await fetchApi('/api/overview', undefined, controller.signal, f);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('network');
  });

  it('a very long error message from the server is kept as sent', async () => {
    const message = 'x'.repeat(150);
    const f = fake(() => json({ error: { code: 'bad_param', message } }, 400));
    const result = await fetchApi('/api/overview', undefined, undefined, f.fn);
    expect(result).toEqual({ ok: false, error: { code: 'bad_param', message, status: 400 } });
  });
});
