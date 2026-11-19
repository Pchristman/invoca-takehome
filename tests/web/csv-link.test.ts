// The CSV link the page builds, fetched from the real endpoint: it must hold exactly the rows the list is built from.
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { serverFixture, get } from '../server/helpers';
import { csvHref, parseUrlState } from '../../src/web/urlState';
import { missedCallsFor } from './fixtures';

const HEADER = 'caller_hash,unanswered_attempts,last_attempt_local,office,campaign,tracking_number,estimated_value_usd';
const app = createApp(serverFixture());

describe('csvHref against the real endpoint', () => {
  it.each([
    ['', ''],
    ['?view=missed-calls&range=last7', 'range=last7'],
    ['?view=missed-calls&range=all&location=loc_b', 'range=all&location=loc_b'],
  ])('state %j downloads the rows the list is built from', async (search, apiSearch) => {
    const res = await get(app, csvHref(parseUrlState(search)));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="callbacks-.*\.csv"$/);
    // Response.text() strips the byte-order mark, so read the raw bytes for it.
    const raw = await app.request(csvHref(parseUrlState(search)));
    expect([...new Uint8Array(await raw.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines.at(-1)).toBe(''); // the file ends with a line end
    const dataRows = lines.slice(1, -1);
    const expected = missedCallsFor(apiSearch).callbacks.rows.length;
    expect(expected).toBeGreaterThan(0);
    expect(dataRows).toHaveLength(expected);
    expect(res.text.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('an unknown office is a 400 naming the field', async () => {
    const res = await get(app, csvHref(parseUrlState('?view=missed-calls&location=nope')));
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: { code: 'unknown_location', field: 'location' } });
  });

  it('a campaign pick does not change the file', async () => {
    const plain = await get(app, csvHref(parseUrlState('?view=missed-calls&range=all')));
    const picked = await get(app, csvHref(parseUrlState('?view=missed-calls&range=all&campaign=cmp_a')));
    expect(picked.text).toBe(plain.text);
  });
});
