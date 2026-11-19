import { describe, expect, it } from 'vitest';
import { pageKey } from '../../src/web/models/pageKey';

const range = { start: '2026-09-01', end: '2026-09-07' };

describe('pageKey', () => {
  it('changes with the range start, the range end or the office', () => {
    const base = pageKey(range, { location: 'loc_a' });
    expect(pageKey({ ...range, start: '2026-09-02' }, { location: 'loc_a' })).not.toBe(base);
    expect(pageKey({ ...range, end: '2026-09-08' }, { location: 'loc_a' })).not.toBe(base);
    expect(pageKey(range, { location: 'loc_b' })).not.toBe(base);
    expect(pageKey(range, { location: null })).not.toBe(base);
  });

  it('does not change with anything else in the state', () => {
    const base = pageKey(range, { location: 'loc_a' });
    const other = { location: 'loc_a', campaign: 'c', dev: true, view: 'missed-calls' } as { location: string };
    expect(pageKey({ ...range }, other)).toBe(base);
  });
});
