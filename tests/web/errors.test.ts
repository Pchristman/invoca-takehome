import { describe, expect, it } from 'vitest';
import { resolveComparison } from '../../src/core/comparison';
import { dataSpan } from '../../src/core/ranges';
import type { Meta } from '../../src/server/api';
import type { ClientError, ClientErrorCode } from '../../src/web/api';
import { describeError } from '../../src/web/models/errors';
import { screenFor } from '../../src/web/models/screen';
import { serverFixture } from '../server/helpers';
import { emptyRangeStore, metaFor } from './fixtures';

// A Record, so this list fails to compile when ClientErrorCode grows.
const ALL_CODES: Record<ClientErrorCode, true> = {
  no_data: true,
  bad_date: true,
  start_after_end: true,
  outside_data: true,
  bad_param: true,
  unknown_campaign: true,
  unknown_location: true,
  unknown_view: true,
  not_found: true,
  internal: true,
  network: true,
  bad_response: true,
};
const codes = Object.keys(ALL_CODES) as ClientErrorCode[];
const RANGE_CODES: ClientErrorCode[] = [
  'bad_date',
  'start_after_end',
  'outside_data',
  'bad_param',
  'unknown_campaign',
  'unknown_location',
];
const err = (code: ClientErrorCode, message = 'Server words.'): ClientError => ({ code, message });

describe('describeError', () => {
  it.each(codes)('%s has a title and message', (code) => {
    const d = describeError(err(code));
    expect(d.title.length).toBeGreaterThan(0);
    expect(d.message.length).toBeGreaterThan(0);
  });

  it.each(RANGE_CODES)("%s passes the server's message through verbatim", (code) => {
    const message = 'x'.repeat(120);
    const d = describeError(err(code, message));
    expect(d.message).toBe(message);
    expect(d.title).toBe("That range or filter can't be used");
    expect(d.canReset).toBe(true);
  });

  it('retry vs reset', () => {
    for (const code of ['network', 'bad_response', 'internal'] as const) {
      expect(describeError(err(code))).toMatchObject({
        canRetry: true,
        canReset: false,
      });
    }
    for (const code of RANGE_CODES) {
      expect(describeError(err(code))).toMatchObject({
        canRetry: false,
        canReset: true,
      });
    }
    expect(describeError(err('no_data'))).toMatchObject({
      canRetry: false,
      canReset: false,
    });
    for (const code of ['not_found', 'unknown_view'] as const) {
      expect(describeError(err(code))).toMatchObject({
        canRetry: false,
        canReset: true,
      });
    }
  });

  it('uses the exact copy for the other codes', () => {
    expect(describeError(err('no_data')).title).toBe('This export has no calls');
    expect(describeError(err('internal'))).toMatchObject({
      title: 'The server hit an unexpected error',
      message: 'Try again. If it keeps happening, look at the terminal running npm start.',
    });
    expect(describeError(err('network', 'Client sentence.'))).toMatchObject({
      title: "Can't reach the data",
      message: 'Client sentence.',
    });
    expect(describeError(err('bad_response', 'Other sentence.'))).toMatchObject({ message: 'Other sentence.' });
    expect(describeError(err('not_found')).title).toBe('Something is missing');
  });
});

describe('screenFor', () => {
  const meta: Meta = metaFor(serverFixture());

  it('null and loading are loading', () => {
    expect(screenFor(null)).toEqual({ screen: 'loading' });
    expect(screenFor({ status: 'loading', key: 'meta' })).toEqual({
      screen: 'loading',
    });
  });

  it('failed is an error', () => {
    const error = err('network');
    expect(screenFor({ status: 'failed', key: 'meta', error })).toEqual({
      screen: 'error',
      error,
    });
  });

  it('ready with no data is empty and carries the notes in order', () => {
    const empty: Meta = {
      ...meta,
      hasData: false,
      callCount: 0,
      span: null,
      notes: ['first note', 'second note'],
    };
    expect(screenFor({ status: 'ready', key: 'meta', data: empty })).toEqual({
      screen: 'empty',
      notes: ['first note', 'second note'],
    });
  });

  it('ready with data is ready', () => {
    expect(screenFor({ status: 'ready', key: 'meta', data: meta })).toEqual({
      screen: 'ready',
      meta,
    });
  });
});

describe('comparison wording matches the real server', () => {
  it('both unavailable reasons still contain a colon', () => {
    const span = dataSpan(emptyRangeStore().calls)!;
    const before = resolveComparison(span, {
      start: '2026-09-01',
      end: '2026-09-07',
    });
    // Another length and outside the data: the data wins, so the reason still has a colon.
    const unequal = resolveComparison(
      span,
      { start: '2026-09-10', end: '2026-09-12' },
      { start: '2026-07-01', end: '2026-07-02' },
    );
    for (const result of [before, unequal]) {
      if (!result.ok) throw new Error('comparison should resolve');
      expect(result.comparison.unavailableReason).toContain(':');
    }
    if (before.ok) expect(before.comparison.unavailableReason).toMatch(/^No full previous period:/);
    if (unequal.ok) expect(unequal.comparison.unavailableReason).toMatch(/^No full previous period:/);
  });

  it('a plain unequal range inside the data is available', () => {
    const span = dataSpan(emptyRangeStore().calls)!;
    const result = resolveComparison(
      span,
      { start: '2026-09-10', end: '2026-09-12' },
      { start: '2026-09-01', end: '2026-09-02' },
    );
    if (!result.ok) throw new Error('comparison should resolve');
    expect(result.comparison.available).toBe(true);
    expect(result.comparison.unavailableReason).toBeNull();
  });
});

describe('describeError never returns undefined', () => {
  it.each([...codes, 'rate_limited'])('%s gets copy', (code) => {
    const d = describeError({ code: code as ClientErrorCode, message: 'Server words.' });
    expect(d).toBeDefined();
    expect(d.title.length).toBeGreaterThan(0);
    expect(typeof d.canRetry).toBe('boolean');
  });

  it('an unknown code gets a generic title, passes the message through and offers retry', () => {
    expect(describeError({ code: 'rate_limited' as ClientErrorCode, message: 'Slow down.' })).toEqual({
      title: 'Something went wrong',
      message: 'Slow down.',
      canReset: false,
      canRetry: true,
    });
  });
});
