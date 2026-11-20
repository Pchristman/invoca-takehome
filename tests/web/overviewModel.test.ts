import { describe, expect, it } from 'vitest';
import type { Change } from '../../src/core/metrics';
import type { OverviewView } from '../../src/core/views';
import { BLANK } from '../../src/web/format';
import { overviewModel, reasonHeadline } from '../../src/web/models/overviewModel';
import { emptyRangeStore, overviewFor } from './fixtures';

/** A copy of the view with the calls tile's change replaced (both counts stay as the API had them). */
function withCallsChange(view: OverviewView, change: Change): OverviewView {
  return { ...view, tiles: { ...view.tiles, calls: { ...view.tiles.calls, change } } };
}

describe('reasonHeadline', () => {
  it('gives the two headlines of the real server sentences', () => {
    const noFull = overviewFor('range=all').notes.comparison.reason!;
    const noLike = overviewFor('start=2026-09-10&end=2026-09-11&compareStart=2026-09-01&compareEnd=2026-09-03').notes
      .comparison.reason!;
    expect(noFull.startsWith('No full previous period')).toBe(true);
    expect(noLike.startsWith('No like-for-like comparison')).toBe(true);
    expect(reasonHeadline(noFull)).toBe('No full previous period');
    expect(reasonHeadline(noLike)).toBe('No like-for-like comparison');
  });

  it('returns a string with no colon whole, and empty for empty', () => {
    expect(reasonHeadline('Nothing to compare')).toBe('Nothing to compare');
    expect(reasonHeadline('')).toBe('');
  });
});

describe('overview tiles', () => {
  const view = overviewFor('range=last7');
  const model = overviewModel(view);

  it('has five tiles in order with the labels', () => {
    expect(model.tiles.map((t) => t.key)).toEqual(['calls', 'uniqueCallers', 'answerRate', 'bookings', 'revenueUsd']);
    expect(model.tiles.map((t) => t.label)).toEqual(['Calls', 'Unique callers', 'Answer rate', 'Bookings', 'Revenue']);
  });

  it('prints the API values', () => {
    const byKey = Object.fromEntries(model.tiles.map((t) => [t.key, t]));
    expect(byKey.calls!.value).toBe('14');
    expect(byKey.calls!.previous).toBe('was 14');
    // The Phase 7 plan text said $1,400 for range=last7; that is wrong. last7 is 7 days (Sep 8-14) of one
    // booked $100 call a day = $700. ($1,400 is the all-data missed-calls estimate.) Record in DECISIONS.md.
    expect(byKey.revenueUsd!.value).toBe('$700');
    expect(byKey.answerRate!.value).toBe('50.0%');
  });

  it("prints each tile's change as the exact text and tone for the fixture", () => {
    // The fixture is the same in both weeks: every count is a 0% change, the answer rate 0 points.
    expect(model.tiles.map((t) => [t.key, view.tiles[t.key].change])).toEqual([
      ['calls', { kind: 'percent', value: 0 }],
      ['uniqueCallers', { kind: 'percent', value: 0 }],
      ['answerRate', { kind: 'points', value: 0 }],
      ['bookings', { kind: 'percent', value: 0 }],
      ['revenueUsd', { kind: 'percent', value: 0 }],
    ]);
    expect(model.tiles.map((t) => t.change)).toEqual([
      { text: '0.0%', tone: 'flat' },
      { text: '0.0%', tone: 'flat' },
      { text: '0.0 points', tone: 'flat' },
      { text: '0.0%', tone: 'flat' },
      { text: '0.0%', tone: 'flat' },
    ]);
  });

  it('a "none" change from the API (all-data range, no previous) is null', () => {
    const all = overviewFor('range=all');
    expect(all.tiles.calls.change).toEqual({ kind: 'none' });
    expect(overviewModel(all).tiles[0]!.change).toBeNull();
  });
});

describe('changes', () => {
  const base = overviewFor('range=last7');
  const changeOf = (change: Change) => overviewModel(withCallsChange(base, change)).tiles[0]!.change;

  it('formats percent, points and new with a tone', () => {
    expect(changeOf({ kind: 'percent', value: 12.54 })).toEqual({ text: '+12.5%', tone: 'up' });
    expect(changeOf({ kind: 'percent', value: -3 })).toEqual({ text: '-3.0%', tone: 'down' });
    expect(changeOf({ kind: 'percent', value: 0.04 })).toEqual({ text: '0.0%', tone: 'flat' });
    expect(changeOf({ kind: 'points', value: 3.2 })).toEqual({ text: '+3.2 points', tone: 'up' });
    expect(changeOf({ kind: 'new' })).toEqual({ text: 'new', tone: 'new' });
  });

  it('shows nothing for none with a usable previous', () => {
    expect(changeOf({ kind: 'none' })).toBeNull();
  });
});

describe('no comparison', () => {
  it('blanks change and previous and explains once', () => {
    const view = overviewFor('range=all');
    const model = overviewModel(view);
    for (const tile of model.tiles) {
      expect(tile.change).toBeNull();
      expect(tile.previous).toBeNull();
      expect(tile.unavailable?.startsWith('No full previous period')).toBe(true);
    }
    expect(model.comparisonReason).toBe(view.notes.comparison.reason);
  });

  it('has neither when the comparison is usable', () => {
    const model = overviewModel(overviewFor('range=last7'));
    expect(model.comparisonReason).toBeNull();
    for (const tile of model.tiles) expect(tile.unavailable).toBeNull();
  });
});

describe('empty range', () => {
  const model = overviewModel(overviewFor('start=2026-09-10&end=2026-09-20', emptyRangeStore()));

  it('is empty with zero tiles and a blank answer rate', () => {
    expect(model.empty).toBe(true);
    const byKey = Object.fromEntries(model.tiles.map((t) => [t.key, t]));
    expect(byKey.calls!.value).toBe('0');
    expect(byKey.uniqueCallers!.value).toBe('0');
    expect(byKey.bookings!.value).toBe('0');
    expect(byKey.answerRate!.value).toBe(BLANK);
  });

  it('still has the top actions', () => {
    expect(model.topActions).toHaveLength(3);
  });
});

describe('top actions', () => {
  const view = overviewFor('range=last7');
  const model = overviewModel(view);

  it('the missed-calls action carries a locationId when the API has one', () => {
    // The fixture's missed-calls action has no office, so edit a copy of the real JSON to add one.
    expect(view.topActions[2]!.action.link).toEqual({ view: 'missed-calls' });
    const edited: OverviewView = {
      ...view,
      topActions: view.topActions.map((t, i) =>
        i === 2 ? { ...t, action: { ...t.action, link: { view: 'missed-calls' as const, locationId: 'loc_b' } } } : t,
      ),
    };
    const actions = overviewModel(edited).topActions;
    expect(actions[2]!.link).toEqual({ view: 'missed-calls', locationId: 'loc_b' });
    expect(actions[0]!.link).toEqual({ view: 'campaigns' });
    expect(actions[1]!.link).toEqual({ view: 'missed-calls' });
  });

  it('passes the API actions through in order', () => {
    expect(view.topActions.map((t) => t.view)).toEqual(['campaigns', 'locations', 'missed-calls']);
    expect(model.topActions.map((t) => t.viewLabel)).toEqual(['Campaigns', 'Locations', 'Missed calls']);
    model.topActions.forEach((a, i) => {
      const api = view.topActions[i]!.action;
      expect(a.text).toBe(api.text);
      expect(a.link).toEqual(api.link);
      expect(a.actionable).toBe(api.actionable);
    });
  });
});

describe('top actions with an alert entry', () => {
  it('gives four rows, the second labelled Campaigns with the alert text', () => {
    const real = overviewFor('range=last7');
    const [campaigns, ...rest] = real.topActions;
    const alert = {
      ...campaigns!,
      action: { ...campaigns!.action, kind: 'review_call_changes' as const, text: 'Calls jumped for 2 campaigns.' },
    };
    const model = overviewModel({ ...real, topActions: [campaigns!, alert, ...rest] });
    expect(model.topActions).toHaveLength(4);
    expect(model.topActions[1]!.viewLabel).toBe('Campaigns');
    expect(model.topActions[1]!.text).toBe('Calls jumped for 2 campaigns.');
  });
});
