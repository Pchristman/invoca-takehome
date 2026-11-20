import { describe, expect, test } from 'vitest';
import { parseTryArgs, TRY_USAGE } from '../../scripts/tryArgs';

describe('parseTryArgs', () => {
  test('one view, default range all', () => {
    expect(parseTryArgs(['overview'])).toEqual({ views: ['overview'], range: 'all' });
  });
  test('all gives the four views in order', () => {
    expect(parseTryArgs(['all', 'last7'])).toEqual({
      views: ['overview', 'campaigns', 'locations', 'missed-calls'],
      range: 'last7',
    });
  });
  test('an unknown view lists the valid ones', () => {
    expect(() => parseTryArgs(['nope'])).toThrow(/overview, campaigns, locations, missed-calls, all/);
  });
  test('no argument gives the usage line', () => {
    expect(() => parseTryArgs([])).toThrow(TRY_USAGE);
  });
});
