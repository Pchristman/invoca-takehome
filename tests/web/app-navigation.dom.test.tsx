// @vitest-environment happy-dom
// Click-through tests for state kept in the URL (sorts, heatmap mode, Back) and for how view replies land.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callsTo, currentParams, deferred, fail, ok, renderApp, settle, stubFetch } from './domHarness';
import { campaignsFor, missedCallsFor, overviewFor, plantedStore, storeWithNames, storeWithZeroBudget } from './fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Campaign names in table order (the row header's title is the bare name, without badges). */
function campaignOrder(): string[] {
  const table = screen.getByRole('table', { name: 'Campaigns in the selected range' });
  return within(table)
    .getAllByRole('rowheader')
    .map((th) => th.getAttribute('title') ?? '');
}

/** Back, as the browser does it: the history entry changes, then popstate fires. */
async function goBack(): Promise<void> {
  await act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('Campaigns sort', () => {
  // Paid earns $1,400, Free $700, Idle $0; all three have the same calls, so the default order is by id.
  const CAMPAIGNS = campaignsFor('range=all', storeWithZeroBudget());

  it('a header click sorts the table and writes the sort to the URL; a range change keeps it', async () => {
    const calls = stubFetch({ '/api/campaigns': () => ok(CAMPAIGNS) });
    renderApp('/?view=campaigns');
    await screen.findByRole('table', { name: 'Campaigns in the selected range' });
    expect(campaignOrder().slice(0, 3)).toEqual(['Free', 'Idle', 'Paid']);

    fireEvent.click(screen.getByRole('button', { name: 'Revenue' }));
    expect(currentParams().get('sort')).toBe('revenueUsd');
    expect(currentParams().get('dir')).toBe('desc');
    expect(campaignOrder().slice(0, 3)).toEqual(['Paid', 'Free', 'Idle']);

    fireEvent.click(screen.getByRole('button', { name: 'Revenue' }));
    expect(currentParams().get('dir')).toBe('asc');
    expect(campaignOrder().slice(0, 3)).toEqual(['Idle', 'Free', 'Paid']);

    const before = callsTo(calls, '/api/campaigns').length;
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => expect(callsTo(calls, '/api/campaigns').length).toBe(before + 1));
    await screen.findByRole('table', { name: 'Campaigns in the selected range' });
    expect(currentParams().get('range')).toBe('last7');
    expect([currentParams().get('sort'), currentParams().get('dir')]).toEqual(['revenueUsd', 'asc']);
    expect(campaignOrder().slice(0, 3)).toEqual(['Idle', 'Free', 'Paid']);
    // The sort is the page's, not the API's.
    expect(callsTo(calls, '/api/campaigns').at(-1)!.params.has('sort')).toBe(false);
  });

  it('Back restores the earlier sort', async () => {
    stubFetch({ '/api/campaigns': () => ok(CAMPAIGNS) });
    renderApp('/?view=campaigns');
    await screen.findByRole('table', { name: 'Campaigns in the selected range' });
    fireEvent.click(screen.getByRole('button', { name: 'Revenue' }));
    expect(campaignOrder().slice(0, 3)).toEqual(['Paid', 'Free', 'Idle']);
    await goBack();
    expect(currentParams().has('sort')).toBe(false);
    await waitFor(() => expect(campaignOrder().slice(0, 3)).toEqual(['Free', 'Idle', 'Paid']));
  });
});

describe('Missed calls heatmap mode', () => {
  const MISSED = missedCallsFor('range=all', plantedStore('answer-worse'));
  const caption = () => screen.getByRole('table', { name: /Missed calls by hour of day/ }).querySelector('caption')!.textContent;

  it('the mode is written to the URL, survives a range change, and Back restores it', async () => {
    const calls = stubFetch({ '/api/missed-calls': () => ok(MISSED) });
    renderApp('/?view=missed-calls');
    await screen.findByRole('button', { name: 'By weekday' });
    expect(caption()).toMatch(/one row per office/);

    fireEvent.click(screen.getByRole('button', { name: 'By weekday' }));
    expect(currentParams().get('heatmap')).toBe('weekday');
    expect(screen.getByRole('button', { name: 'By weekday' }).getAttribute('aria-pressed')).toBe('true');
    expect(caption()).toMatch(/one row per weekday/);

    const before = callsTo(calls, '/api/missed-calls').length;
    fireEvent.click(screen.getByRole('button', { name: 'All data' }));
    await waitFor(() => expect(callsTo(calls, '/api/missed-calls').length).toBe(before + 1));
    await screen.findByRole('button', { name: 'By weekday' });
    expect(currentParams().get('heatmap')).toBe('weekday');
    expect(caption()).toMatch(/one row per weekday/);

    await goBack(); // to before the range change: weekday, default range
    await screen.findByRole('button', { name: 'By weekday' });
    expect(currentParams().has('range')).toBe(false);
    expect(caption()).toMatch(/one row per weekday/);
    await goBack(); // to before the mode change
    expect(currentParams().has('heatmap')).toBe(false);
    await waitFor(() => expect(caption()).toMatch(/one row per office/));
  });
});

describe('view replies', () => {
  it('a slow reply for an old range that lands after the newer one does not replace it', async () => {
    const old = deferred();
    const first = campaignsFor('range=all', storeWithNames(['First reply']));
    const stale = campaignsFor('range=all', storeWithNames(['Stale reply']));
    const fresh = campaignsFor('range=all', storeWithNames(['Fresh reply']));
    // The held reply ignores the abort, as a reply already on its way would.
    stubFetch({
      '/api/campaigns': (call) => {
        const range = call.params.get('range');
        if (range === 'last7') return old.promise;
        return ok(range === 'all' ? fresh : first);
      },
    });
    renderApp('/?view=campaigns');
    await screen.findByRole('rowheader', { name: /First reply/ });

    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await screen.findByText('Loading this view...');
    fireEvent.click(screen.getByRole('button', { name: 'All data' }));
    await screen.findByRole('rowheader', { name: /Fresh reply/ });

    await act(async () => old.resolve(ok(stale)));
    await settle();
    expect(screen.getByRole('rowheader', { name: /Fresh reply/ })).toBeTruthy();
    expect(screen.queryByText(/Stale reply/)).toBeNull();
    expect(currentParams().get('range')).toBe('all');
  });

  it('an error reply shows the error with Try again, and Try again fetches again and shows the view', async () => {
    let attempts = 0;
    const calls = stubFetch({
      '/api/overview': () => (++attempts === 1 ? fail(500, 'internal', 'boom') : ok(overviewFor('range=all'))),
    });
    renderApp('/');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The server hit an unexpected error');
    expect(alert.textContent).not.toContain('boom'); // the server's internal text never reaches the screen
    expect(screen.queryByRole('heading', { name: 'Suggested actions by page' })).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'Suggested actions by page' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(callsTo(calls, '/api/overview')).toHaveLength(2);
  });
});
