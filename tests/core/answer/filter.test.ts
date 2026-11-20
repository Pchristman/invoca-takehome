import { describe, expect, it } from 'vitest';
import { cleanExport } from '../../../src/core/clean';
import { applyFilter } from '../../../src/core/answer';
import type { AnswerFilter } from '../../../src/core/answer';
import { goodRow, loadFixture } from '../helpers';
import { callAt } from '../views/fixtures';

const open: AnswerFilter = {
  view: 'overview',
  officeIds: [],
  campaignIds: [],
  includeUnattributed: false,
  weekdays: [],
  hours: [],
};
const ids = (calls: { callId: string }[]) => calls.map((c) => c.callId);

describe('applyFilter', () => {
  const a = callAt('2026-10-02T10:00:00Z', { callId: 'a', locationId: 'o1', campaignId: 'c1', localWeekday: 4, localHour: 9 });
  const b = callAt('2026-10-02T11:00:00Z', { callId: 'b', locationId: 'o2', campaignId: 'c2', localWeekday: 4, localHour: 10 });
  const c = callAt('2026-10-03T11:00:00Z', {
    callId: 'c',
    locationId: 'o1',
    campaignId: null,
    unattributed: true,
    localWeekday: 5,
    localHour: 9,
  });
  const all = [a, b, c];

  it('empty lists return every call, and each list restricts', () => {
    expect(applyFilter(all, open)).toHaveLength(3);
    expect(ids(applyFilter(all, { ...open, officeIds: ['o1'] }))).toEqual(['a', 'c']);
    expect(ids(applyFilter(all, { ...open, campaignIds: ['c2'] }))).toEqual(['b']);
    expect(ids(applyFilter(all, { ...open, weekdays: [5] }))).toEqual(['c']);
    expect(ids(applyFilter(all, { ...open, hours: [10] }))).toEqual(['b']);
  });

  it('two lists together are an AND', () => {
    expect(ids(applyFilter(all, { ...open, officeIds: ['o1'], weekdays: [4] }))).toEqual(['a']);
    expect(ids(applyFilter(all, { ...open, officeIds: ['o2'], hours: [9] }))).toEqual([]);
  });

  it('includeUnattributed alone matches only calls with no campaign', () => {
    expect(ids(applyFilter(all, { ...open, includeUnattributed: true }))).toEqual(['c']);
  });

  it('includeUnattributed with a campaign matches that campaign and the unattributed', () => {
    expect(ids(applyFilter(all, { ...open, campaignIds: ['c1'], includeUnattributed: true }))).toEqual(['a', 'c']);
  });

  it('Friday near midnight UTC is the office local Friday (uses the real clean step for the zones)', () => {
    // callAt does not localize, so this goes through cleanExport.
    // loc_1 is Phoenix (UTC-7), loc_2 is Denver (UTC-6) in the shared fixture.
    const rows = [
      goodRow({ call_id: 'phx', location_id: 'loc_1', started_at: '2026-10-03T02:00:00Z' }),
      goodRow({ call_id: 'den', location_id: 'loc_2', started_at: '2026-10-03T02:00:00Z' }),
    ];
    const calls = cleanExport(loadFixture(rows)).calls;
    expect(calls).toHaveLength(2);
    expect(applyFilter(calls, { ...open, weekdays: [4] })).toHaveLength(2);
    expect(applyFilter(calls, { ...open, weekdays: [5] })).toHaveLength(0);
    expect(ids(applyFilter(calls, { ...open, hours: [19] }))).toEqual(['phx']);
    expect(ids(applyFilter(calls, { ...open, hours: [20] }))).toEqual(['den']);
  });
});
