import { describe, expect, it } from 'vitest';
import { postUpload } from '../../src/web/api';

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(respond: () => Response | Promise<Response>): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const file = () => new File(['a,b\n1,2\n'], 'calls.csv', { type: 'text/csv' });

describe('postUpload', () => {
  it.each(['preview', 'commit'] as const)('posts the file under "file" to /api/upload/%s', async (mode) => {
    const { fetchFn, calls } = fakeFetch(() => json(200, { preview: { kind: 'calls' } }));
    const f = file();
    const result = await postUpload(mode, f, undefined, fetchFn);
    expect(result).toEqual({ ok: true, data: { preview: { kind: 'calls' } } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`/api/upload/${mode}`);
    expect(calls[0]!.init?.method).toBe('POST');
    const body = calls[0]!.init?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBeInstanceOf(File);
    expect(((body as FormData).get('file') as File).name).toBe('calls.csv');
  });

  it("carries the server's message and status for a 400 and a 413", async () => {
    const bad = await postUpload('preview', file(), undefined, fakeFetch(() => json(400, { error: { code: 'bad_upload', message: 'Not a CSV.' } })).fetchFn);
    expect(bad).toEqual({ ok: false, error: { code: 'bad_upload', message: 'Not a CSV.', status: 400 } });
    const big = await postUpload('preview', file(), undefined, fakeFetch(() => json(413, { error: { code: 'too_large', message: 'Over 10 MB.' } })).fetchFn);
    expect(big).toEqual({ ok: false, error: { code: 'too_large', message: 'Over 10 MB.', status: 413 } });
  });

  it('a dead server is the usual network message', async () => {
    const result = await postUpload('commit', file(), undefined, (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, error: { code: 'network' } });
    if (!result.ok) expect(result.error.message).toContain('Could not reach the API');
  });

  it('a reply that is not JSON is bad_response', async () => {
    const result = await postUpload('preview', file(), undefined, fakeFetch(() => new Response('<html>hi</html>', { status: 200 })).fetchFn);
    expect(result).toMatchObject({ ok: false, error: { code: 'bad_response' } });
  });
});
