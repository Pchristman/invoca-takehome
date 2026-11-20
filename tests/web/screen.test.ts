import { describe, expect, it } from 'vitest';
import type { ClientError } from '../../src/web/api';
import { displayState, keepPreviousFor } from '../../src/web/models/keepPrevious';
import { shouldCloseDataNotes } from '../../src/web/models/escapeKey';
import { VIEW_LABELS } from '../../src/web/models/viewLabels';
import { screenFor } from '../../src/web/models/screen';
import type { RequestState } from '../../src/web/requestState';

const A = '/api/campaigns?range=last28&campaign=a#0';
const B = '/api/campaigns?range=last28&campaign=b#0';

describe('keepPreviousFor', () => {
  it('keeps when only the campaign changes', () => {
    expect(keepPreviousFor(A, B)).toBe(true);
    expect(keepPreviousFor('/api/campaigns?range=last28#0', B)).toBe(true); // from "all" to a pick
  });
  it('drops on first load', () => expect(keepPreviousFor(null, A)).toBe(false));
  it('keeps when the range changes, so the page does not blank and flash', () => {
    expect(keepPreviousFor(A, '/api/campaigns?range=last7&campaign=b#0')).toBe(true);
    expect(keepPreviousFor(A, '/api/campaigns?start=2026-01-01&end=2026-01-07&campaign=b#0')).toBe(true);
  });
  it('keeps when the comparison changes', () => {
    expect(keepPreviousFor(A, '/api/campaigns?range=last28&compareStart=2026-01-01&compareEnd=2026-01-28&campaign=b#0')).toBe(true);
  });
  it('drops when the view changes', () => {
    expect(keepPreviousFor(A, '/api/overview?range=last28#0')).toBe(false);
  });
  it('drops when nothing but the retry count changed', () => {
    expect(keepPreviousFor(A, '/api/campaigns?range=last28&campaign=a#1')).toBe(false);
  });
});

describe('keepPreviousFor with an office', () => {
  const LA = '/api/missed-calls?range=last28&location=a#0';
  const LB = '/api/missed-calls?range=last28&location=b#0';
  it('keeps when only the office changes, including to and from none', () => {
    expect(keepPreviousFor(LA, LB)).toBe(true);
    expect(keepPreviousFor('/api/missed-calls?range=last28#0', LB)).toBe(true);
    expect(keepPreviousFor(LA, '/api/missed-calls?range=last28#0')).toBe(true);
  });
  it('keeps for a range or comparison change; drops for a retry or another view', () => {
    expect(keepPreviousFor(LA, '/api/missed-calls?range=last7&location=b#0')).toBe(true);
    expect(keepPreviousFor(LA, '/api/missed-calls?range=last28&compareStart=2026-01-01&compareEnd=2026-01-28&location=b#0')).toBe(true);
    expect(keepPreviousFor(LA, '/api/missed-calls?range=last28&location=a#1')).toBe(false);
    expect(keepPreviousFor(LA, '/api/overview?range=last28#0')).toBe(false);
  });
  it('displayState keeps the old data, marked busy, while an office-only change loads', () => {
    expect(displayState({ key: LA, data: 'old' }, { status: 'loading', key: LB })).toEqual({
      state: { status: 'ready', key: LB, data: 'old' },
      busy: true,
    });
  });
});

describe('displayState', () => {
  const ready = { key: A, data: 'old' };
  const error: ClientError = { code: 'network', message: 'x' };
  it('shows the new reply when ready, and no busy mark', () => {
    const next: RequestState<string> = { status: 'ready', key: B, data: 'new' };
    expect(displayState(ready, next)).toEqual({ state: next, busy: false });
  });
  it('keeps the old data, marked busy, while a campaign-only change loads', () => {
    expect(displayState(ready, { status: 'loading', key: B })).toEqual({
      state: { status: 'ready', key: B, data: 'old' },
      busy: true,
    });
  });
  it('shows loading and no old data for another view or a retry', () => {
    const next: RequestState<string> = { status: 'loading', key: '/api/overview?range=last28#0' };
    expect(displayState(ready, next)).toEqual({ state: next, busy: false });
    const retry: RequestState<string> = { status: 'loading', key: '/api/campaigns?range=last28&campaign=a#1' };
    expect(displayState(ready, retry)).toEqual({ state: retry, busy: false });
    expect(displayState(null, { status: 'loading', key: A })).toEqual({ state: { status: 'loading', key: A }, busy: false });
  });
  it('keeps the old data, marked busy, while a new range loads', () => {
    const next: RequestState<string> = { status: 'loading', key: '/api/campaigns?range=last7&campaign=a#0' };
    expect(displayState(ready, next)).toEqual({ state: { status: 'ready', key: next.key, data: 'old' }, busy: true });
  });
  it('shows the error, not stale data, when the new reply failed', () => {
    const next: RequestState<string> = { status: 'failed', key: B, error };
    expect(displayState(ready, next)).toEqual({ state: next, busy: false });
  });
  it('passes null through', () => expect(displayState(ready, null)).toEqual({ state: null, busy: false }));
});

describe('shouldCloseDataNotes', () => {
  it('closes on a plain Escape', () => {
    expect(shouldCloseDataNotes({ key: 'Escape', defaultPrevented: false, targetTag: 'BODY' })).toBe(true);
    expect(shouldCloseDataNotes({ key: 'Escape', defaultPrevented: false, targetTag: 'BUTTON' })).toBe(true);
  });
  it('ignores other keys', () => {
    expect(shouldCloseDataNotes({ key: 'a', defaultPrevented: false, targetTag: 'BODY' })).toBe(false);
  });
  it('ignores Escape already handled or inside a select, input or textarea', () => {
    expect(shouldCloseDataNotes({ key: 'Escape', defaultPrevented: true, targetTag: 'BODY' })).toBe(false);
    for (const tag of ['SELECT', 'INPUT', 'TEXTAREA', 'select']) {
      expect(shouldCloseDataNotes({ key: 'Escape', defaultPrevented: false, targetTag: tag })).toBe(false);
    }
  });
});

describe('screenFor', () => {
  it('has a label for every view', () => expect(Object.keys(VIEW_LABELS)).toEqual(['overview', 'campaigns', 'locations', 'missed-calls']));
  it('is loading for null and for a loading request', () => {
    expect(screenFor(null)).toEqual({ screen: 'loading' });
    expect(screenFor({ status: 'loading', key: 'k' })).toEqual({ screen: 'loading' });
  });
});
