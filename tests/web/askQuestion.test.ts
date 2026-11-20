import { describe, it, expect } from 'vitest';
import { askQuestion } from '../../src/web/api';

function reply(body: string, status = 200): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

describe('askQuestion', () => {
  it('passes a QuestionResponse through and encodes the question', async () => {
    let seen = '';
    const fetchFn = (async (url: string) => {
      seen = url;
      return new Response(JSON.stringify({ ok: true, source: 'ai', cached: false, query: 'view=overview' }));
    }) as unknown as typeof fetch;
    expect(await askQuestion('a & b?', undefined, fetchFn)).toEqual({ ok: true, source: 'ai', cached: false, query: 'view=overview' });
    expect(seen).toBe('/api/question?q=a+%26+b%3F');
  });

  it('a non-JSON reply or a dead server is an api_error, never a throw', async () => {
    const dead = { ok: false, reason: 'api_error', message: "Can't reach the data." };
    expect(await askQuestion('x', undefined, reply('<html>'))).toEqual(dead);
    expect(await askQuestion('x', undefined, (async () => { throw new Error('down'); }) as typeof fetch)).toEqual(dead);
  });

  it('a 400 shows the server sentence', async () => {
    const body = JSON.stringify({ error: { code: 'bad_param', message: 'q is too long.', field: 'q' } });
    expect(await askQuestion('x', undefined, reply(body, 400))).toEqual({ ok: false, reason: 'api_error', message: 'q is too long.' });
  });
});
