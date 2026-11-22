// @vitest-environment happy-dom
// Click-through tests for the range control: presets, custom dates, Clear dates and where Compare is offered.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callsTo, currentParams, ok, renderApp, settle, stubFetch } from './domHarness';
import type { FetchCall } from './domHarness';
import { campaignsFor, locationsFor, missedCallsFor, overviewFor } from './fixtures';

const OVERVIEW = overviewFor('range=all');
const CAMPAIGNS = campaignsFor('range=all');
const LOCATIONS = locationsFor('range=all');
const MISSED = missedCallsFor('range=all');

let calls: FetchCall[];

beforeEach(() => {
  calls = stubFetch({
    '/api/overview': () => ok(OVERVIEW),
    '/api/campaigns': () => ok(CAMPAIGNS),
    '/api/locations': () => ok(LOCATIONS),
    '/api/missed-calls': () => ok(MISSED),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const preset = (name: string) => screen.getByRole('button', { name });
const startInput = () => screen.getByLabelText('Start date') as HTMLInputElement;
const endInput = () => screen.getByLabelText('End date') as HTMLInputElement;

/** Wait for the first overview reply, so later counts start from a settled page. */
async function ready(): Promise<void> {
  await screen.findByRole('heading', { name: 'Suggested actions by page' });
}

describe('range presets', () => {
  it('clicking a preset writes it to the URL and fetches the view for it', async () => {
    renderApp('/');
    await ready();
    fireEvent.click(preset('Last 7 days'));
    expect(currentParams().get('range')).toBe('last7');
    await waitFor(() => expect(callsTo(calls, '/api/overview').at(-1)?.params.get('range')).toBe('last7'));
    expect(preset('Last 7 days').getAttribute('aria-pressed')).toBe('true');
    expect(preset('Last 28 days').getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking the preset that is already active changes nothing: no navigation, no fetch', async () => {
    renderApp('/');
    await ready();
    await settle();
    const before = calls.length;
    const historyLength = window.history.length;
    // last28 is the default, so it is active with no range in the URL.
    expect(preset('Last 28 days').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(preset('Last 28 days'));
    await settle();
    expect(window.location.search).toBe('');
    expect(window.history.length).toBe(historyLength);
    expect(calls.length).toBe(before);
  });

  it('dates typed but not applied give way when a preset is clicked', async () => {
    renderApp('/');
    await ready();
    fireEvent.change(startInput(), { target: { value: '2026-09-03' } });
    expect(startInput().value).toBe('2026-09-03');
    fireEvent.click(preset('Last 7 days'));
    await waitFor(() => expect(startInput().value).toBe(''));
    expect(currentParams().has('start')).toBe(false);
  });
});

describe('custom dates', () => {
  it('Apply is off until both dates are set, then writes them to the URL and fetches that range', async () => {
    renderApp('/');
    await ready();
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toHaveProperty('disabled', true);
    fireEvent.change(startInput(), { target: { value: '2026-09-03' } });
    expect(apply).toHaveProperty('disabled', true);
    fireEvent.change(endInput(), { target: { value: '2026-09-10' } });
    expect(apply).toHaveProperty('disabled', false);
    fireEvent.click(apply);
    expect(currentParams().get('start')).toBe('2026-09-03');
    expect(currentParams().get('end')).toBe('2026-09-10');
    await waitFor(() => {
      const last = callsTo(calls, '/api/overview').at(-1)!;
      expect([last.params.get('start'), last.params.get('end')]).toEqual(['2026-09-03', '2026-09-10']);
    });
    // No preset is active on a custom range.
    for (const name of ['Last 7 days', 'Last 28 days', 'All data']) expect(preset(name).getAttribute('aria-pressed')).toBe('false');
  });

  it('Clear dates goes back to the default preset and moves focus to the start date', async () => {
    renderApp('/?start=2026-09-03&end=2026-09-10');
    await ready();
    expect(startInput().value).toBe('2026-09-03');
    fireEvent.click(screen.getByRole('button', { name: 'Clear dates' }));
    expect(window.location.search).toBe('');
    expect(document.activeElement).toBe(startInput());
    await waitFor(() => expect(callsTo(calls, '/api/overview').at(-1)?.params.toString()).toBe(''));
    expect(preset('Last 28 days').getAttribute('aria-pressed')).toBe('true');
    expect(startInput().value).toBe('');
    expect(endInput().value).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear dates' })).toBeNull();
  });
});

describe('comparison controls', () => {
  it.each([
    ['overview', true],
    ['campaigns', true],
    ['locations', false],
    ['missed-calls', false],
  ])('on %s they are shown: %s', async (view, shown) => {
    renderApp(`/?view=${view}`);
    await screen.findByRole('group', { name: 'Preset ranges' });
    expect(screen.queryByRole('group', { name: 'Comparison range' }) !== null).toBe(shown);
    expect(screen.queryByLabelText('Compare start date') !== null).toBe(shown);
    expect(screen.queryByRole('button', { name: 'Compare' }) !== null).toBe(shown);
  });
});
