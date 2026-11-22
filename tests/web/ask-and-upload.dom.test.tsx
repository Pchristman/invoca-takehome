// @vitest-environment happy-dom
// Click-through tests for the question box and the upload panel, including Escape.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatLongDate } from '../../src/web/format';
import { baseMeta, callsTo, currentParams, deferred, hangUntilAborted, ok, renderApp, settle, stubFetch } from './domHarness';
import type { FetchCall, Route } from './domHarness';
import { overviewFor } from './fixtures';
import { previewOf } from './uploadFixtures';

const OVERVIEW = overviewFor('range=all');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Ask a question', () => {
  const META = baseMeta({ aiStatus: 'on' });
  const askStatus = () => document.querySelector('form.ask [role="status"]');
  const input = () => screen.getByLabelText('Ask a question') as HTMLInputElement;

  function start(question: Route): FetchCall[] {
    const calls = stubFetch({ '/api/overview': () => ok(OVERVIEW), '/api/question': question, '/api/answer': hangUntilAborted }, META);
    renderApp('/');
    return calls;
  }

  it('submitting sends the question and, on a filter, navigates to the answer page', async () => {
    const calls = start(() => ok({ ok: true, source: 'ai', cached: false, query: 'view=missed-calls&f_office=loc_a' }));
    await screen.findByLabelText('Ask a question');
    expect(askStatus()).not.toBeNull(); // in the DOM before anything is asked
    fireEvent.change(input(), { target: { value: 'Which office misses most?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(currentParams().has('answer')).toBe(true));
    expect(callsTo(calls, '/api/question')[0]!.params.get('q')).toBe('Which office misses most?');
    expect(currentParams().get('view')).toBe('missed-calls');
    expect(currentParams().getAll('f_office')).toEqual(['loc_a']);
    await waitFor(() => expect(callsTo(calls, '/api/answer')).toHaveLength(1));
    expect(askStatus()).not.toBeNull();
  });

  it('while busy the button reads Cancel; Cancel aborts the request and the box works again', async () => {
    const calls = start(hangUntilAborted);
    await screen.findByLabelText('Ask a question');
    fireEvent.change(input(), { target: { value: 'How many calls on weekends?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull();
    expect(askStatus()!.textContent).toContain('Reading your question...');
    const request = callsTo(calls, '/api/question')[0]!;
    expect(request.signal!.aborted).toBe(false);

    fireEvent.click(cancel);
    expect(request.signal!.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy();
    expect(askStatus()!.textContent).toBe('');
    expect(input().value).toBe('How many calls on weekends?');
    await settle();
    expect(currentParams().has('answer')).toBe(false);
  });

  it("a reply that couldn't become a filter shows its message and keeps the question", async () => {
    const message = "Couldn't turn that into a filter. Try naming an office, a campaign, a weekday or an hour.";
    start(() => ok({ ok: false, reason: 'invalid_filter', message }));
    await screen.findByLabelText('Ask a question');
    fireEvent.change(input(), { target: { value: 'Why is the sky blue?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(askStatus()!.textContent).toContain(message));
    expect(within(askStatus() as HTMLElement).getAllByRole('listitem').length).toBeGreaterThan(0); // the example questions
    expect(input().value).toBe('Why is the sky blue?');
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy();
    expect(currentParams().has('answer')).toBe(false);
  });
});

describe('Upload data', () => {
  const PREVIEW = previewOf('calls', { newRows: 3, duplicates: 1 }, { fileName: 'calls.csv' });
  const NEW_META = baseMeta({ span: { start: '2026-09-01', end: '2026-09-20' } });
  const commitReply = (warning?: string) => ok({ preview: PREVIEW, written: 3, meta: NEW_META, ...(warning ? { warning } : {}) });
  const panel = () => screen.getByRole('complementary', { name: 'Upload data' });
  const panelHeading = () => within(panel()).getByRole('heading');
  const headerUpload = () => screen.getByRole('banner').querySelector('#upload-button') as HTMLButtonElement;
  const file = () => new File(['call_id\n'], 'calls.csv', { type: 'text/csv' });

  async function openPanel(commit: Route): Promise<FetchCall[]> {
    const calls = stubFetch({
      '/api/overview': () => ok(OVERVIEW),
      '/api/upload/preview': () => ok({ preview: PREVIEW }),
      '/api/upload/commit': commit,
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Top actions' });
    fireEvent.click(headerUpload());
    await screen.findByRole('complementary', { name: 'Upload data' });
    return calls;
  }

  async function chooseFile(): Promise<void> {
    fireEvent.change(screen.getByLabelText(/Choose a calls, campaigns or locations CSV file/), { target: { files: [file()] } });
    await screen.findByRole('button', { name: 'Add 3 calls' });
  }

  it('choose a file, see the preview, confirm, see what was added; focus goes to the heading at each step', async () => {
    const calls = await openPanel(() => commitReply());
    await waitFor(() => expect(document.activeElement).toBe(panelHeading()));
    expect(panelHeading().textContent).toBe('Upload data');

    await chooseFile();
    expect(callsTo(calls, '/api/upload/preview')).toHaveLength(1);
    expect(panelHeading().textContent).toBe('calls.csv');
    expect(within(panel()).getByText('New calls')).toBeTruthy();
    expect(within(panel()).getByText('Already stored')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(panelHeading()));

    fireEvent.click(screen.getByRole('button', { name: 'Add 3 calls' }));
    await within(panel()).findByText(/^Added 3 new calls\./);
    expect(callsTo(calls, '/api/upload/commit')).toHaveLength(1);
    expect(within(panel()).queryByRole('alert')).toBeNull();
    expect(within(panel()).getByRole('link', { name: 'See the new data' }).getAttribute('href')).toBe('/');
    await waitFor(() => expect(document.activeElement).toBe(panelHeading()));
  });

  it('a warning in the commit reply is shown as an alert', async () => {
    const warning = 'The rows were saved, but AI is off for the rest of this session.';
    await openPanel(() => commitReply(warning));
    await chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 calls' }));
    const alert = await within(panel()).findByRole('alert');
    expect(alert.textContent).toBe(warning);
    expect(within(panel()).getByText(/^Added 3 new calls\./)).toBeTruthy();
  });

  it('while saving, Close and the header toggle are disabled; after the write the header shows the new data date', async () => {
    const commit = deferred();
    await openPanel(() => commit.promise);
    const header = screen.getByRole('banner');
    expect(header.textContent).toContain(`Data as of ${formatLongDate('2026-09-14')}`);
    await chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 calls' }));

    await within(panel()).findByText('Saving...');
    const close = within(panel()).getByRole('button', { name: 'Close' }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    expect(headerUpload().disabled).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.getByRole('complementary', { name: 'Upload data' })).toBeTruthy(); // Escape does not close it either

    await act(async () => commit.resolve(commitReply()));
    await within(panel()).findByText(/^Added 3 new calls\./);
    expect(close.disabled).toBe(false);
    expect(headerUpload().disabled).toBe(false);
    expect(header.textContent).toContain(`Data as of ${formatLongDate('2026-09-20')}`);
    expect(header.textContent).not.toContain(`Data as of ${formatLongDate('2026-09-14')}`);
  });

  it('Escape closes the upload panel and gives focus back to its header button', async () => {
    await openPanel(() => commitReply());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Upload data' })).toBeNull());
    expect(document.activeElement).toBe(headerUpload());
  });
});
