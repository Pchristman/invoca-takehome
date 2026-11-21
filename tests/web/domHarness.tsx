// Shared set-up for the click-through tests (*.dom.test.tsx), which run in happy-dom.
// The app is rendered as main.tsx renders it, with reduced motion switched on so no transition gets in the way.
// fetch is stubbed per test: each test says what every API path replies, and can hold a reply back.
import { act, render } from '@testing-library/react';
import { vi } from 'vitest';
import type { Meta } from '../../src/server/api';
import { App } from '../../src/web/App';
import { MotionRoot } from '../../src/web/useMotion';
import { serverFixture } from '../server/helpers';
import { metaFor } from './fixtures';

export interface FetchCall {
  /** Path and query, e.g. "/api/overview?range=last7". */
  url: string;
  path: string;
  params: URLSearchParams;
  signal: AbortSignal | undefined;
}

/** What a route answers: a body (sent as 200 JSON), a full Reply, or a promise of either (to hold the reply back). */
export type Reply = { status: number; body: unknown };
export type RouteResult = Reply | Promise<Reply>;
export type Route = (call: FetchCall) => RouteResult;

export function ok(body: unknown): Reply {
  return { status: 200, body };
}

export function fail(status: number, code: string, message: string, field?: string): Reply {
  return { status, body: { error: field === undefined ? { code, message } : { code, message, field } } };
}

/** A reply the test sends later, by calling resolve. */
export function deferred(): { promise: Promise<Reply>; resolve(reply: Reply): void } {
  let resolve!: (reply: Reply) => void;
  const promise = new Promise<Reply>((r) => (resolve = r));
  return { promise, resolve };
}

/** A reply that never comes, unless the request is aborted (then fetch rejects, as a browser's does). */
export function hangUntilAborted(call: FetchCall): Promise<Reply> {
  return new Promise((_, reject) => {
    call.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });
}

/** The /api/meta reply the tests start from: the server fixture (2026-09-01 to 2026-09-14). */
export function baseMeta(overrides: Partial<Meta> = {}): Meta {
  return { ...metaFor(serverFixture()), ...overrides };
}

const TAKEAWAY = (view: string): Reply => ok({ view, text: 'Template takeaway.', source: 'template', reason: 'ai_off' });

/**
 * Stub fetch with these routes, keyed by path ("/api/overview"). /api/meta and /api/takeaway/* have defaults.
 * Any other path replies 404, so a request the test did not expect shows up as an error on screen.
 */
export function stubFetch(routes: Record<string, Route>, meta: Meta = baseMeta()): FetchCall[] {
  const calls: FetchCall[] = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const parsed = new URL(url, 'http://localhost');
    const call: FetchCall = { url, path: parsed.pathname, params: parsed.searchParams, signal: init?.signal ?? undefined };
    calls.push(call);
    if (call.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const route =
      routes[call.path] ??
      (call.path === '/api/meta' ? () => ok(meta) : call.path.startsWith('/api/takeaway/') ? () => TAKEAWAY(call.path.slice(14)) : undefined);
    const reply = route ? await route(call) : fail(404, 'not_found', `No route for ${call.path}`);
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchStub);
  return calls;
}

/** The OS asks for reduced motion, so the app turns motion off (as it does for a real user who asked). */
export function preferReducedMotion(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

/** Put the browser at this URL (path and query) without a page load. */
export function goTo(href: string): void {
  window.history.replaceState(null, '', href);
}

/** Render the app at this URL, the way main.tsx does. */
export function renderApp(href = '/') {
  goTo(href);
  preferReducedMotion();
  return render(
    <MotionRoot>
      <App />
    </MotionRoot>,
  );
}

/** The calls made to one path, in order. */
export function callsTo(calls: FetchCall[], path: string): FetchCall[] {
  return calls.filter((c) => c.path === path);
}

/** Let pending promises and effects settle (for checks that something did NOT happen). */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

/** The current query string as a URLSearchParams. */
export function currentParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}
