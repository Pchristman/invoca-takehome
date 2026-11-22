import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { resolveComparison } from '../../src/core/comparison';
import { tally } from '../../src/core/metrics';
import { buildMissedValueRates, estimateMissedCallValue } from '../../src/core/missedValue';
import { dataSpan, resolveRange } from '../../src/core/ranges';
import type { RangeSpec } from '../../src/core/ranges';
import { callsPerWeek } from '../../src/core/weeks';
import { buildCampaigns, buildLocations, buildMissedCalls, buildOverview } from '../../src/core/views';
import { readExportFromDir } from '../../src/node/readDataDir';
import { buildAnswer } from '../../src/core/answer';
import type { AnswerFilter } from '../../src/core/answer';
import { createApp } from '../../src/server/app';
import { parseAnswerQuery } from '../../src/server/params';
import { replyToQuery } from '../../src/server/questionQuery';
import { formatLongDate } from '../../src/web/format';
import { printModel } from '../../src/web/models/printModel';
import type { PrintTakeaways } from '../../src/web/models/printModel';
import { metaFor, overviewFor } from '../web/fixtures';
import { goodRow, loadFixture } from './helpers';
import { expectAllFinite } from './views/fixtures';

// An export that shares no names, zones or dates with the shipped one.
const CAMPAIGNS = 'campaign_id,name,channel,daily_budget_usd\nzz_c1,Quokka Promo,referral,40\nzz_c2,Wombat Weekend,paid_search,0\n';
const LOCATIONS =
  'location_id,name,timezone\nzz_kol,Kolkata Hub,Asia/Kolkata\nzz_akl,Auckland Annex,Pacific/Auckland\nzz_lon,London Desk,Europe/London\n';

const row = (over: Record<string, string>) =>
  goodRow({ campaign_id: 'zz_c1', marketing_channel: 'referral', location_id: 'zz_kol', ...over });

describe('cleaning a different export', () => {
  const store = cleanExport(
    loadFixture(
      [
        // a duplicate: the first row has no outcome yet, the later one books it
        row({ call_id: 'k1', started_at: '2031-05-10T20:00:00Z', outcome: '', revenue_usd: '', updated_at: '2031-05-10T21:00:00Z' }),
        row({ call_id: 'k1', started_at: '2031-05-10T20:00:00Z', outcome: 'booked', revenue_usd: '300', updated_at: '2031-05-12T21:00:00Z' }),
        // unattributed, in London summer time (UTC+1): 23:30 UTC is 00:30 the next day
        row({ call_id: 'l1', campaign_id: '', marketing_channel: 'direct', location_id: 'zz_lon', started_at: '2031-05-10T23:30:00Z', answered: 'false', outcome: 'missed', revenue_usd: '' }),
        // pending
        row({ call_id: 'a1', campaign_id: 'zz_c2', marketing_channel: 'paid_search', location_id: 'zz_akl', started_at: '2031-05-10T20:00:00Z', outcome: '', revenue_usd: '' }),
      ],
      CAMPAIGNS,
      LOCATIONS,
    ),
  );

  test('every call is kept and counted', () => {
    expect(store.calls.map((c) => c.callId)).toEqual(['k1', 'l1', 'a1']);
    expect(store.dataNotes.badCalls).toBe(0);
    expect(store.dataNotes.duplicateRowsCollapsed).toBe(1);
  });

  test('revenue, attribution and pending work on other names', () => {
    expect(store.calls.reduce((sum, c) => sum + c.revenueUsd, 0)).toBe(300);
    expect(store.dataNotes.unattributedCalls).toBe(1);
    expect(store.dataNotes.pendingCalls).toBe(1);
  });

  test('local dates follow each office zone, including a half-hour offset', () => {
    const byId = Object.fromEntries(store.calls.map((c) => [c.callId, c]));
    expect(byId.k1).toMatchObject({ localDate: '2031-05-11', localHour: 1 }); // 20:00 UTC + 5:30
    expect(byId.l1).toMatchObject({ localDate: '2031-05-11', localHour: 0 });
    expect(byId.a1).toMatchObject({ localDate: '2031-05-11', localHour: 8 }); // 20:00 UTC + 12:00
  });
});

describe('ranges and metrics on a different export', () => {
  // Calls in zones and on dates unlike the shipped export's: Mon 5th, Wed 7th, Mon 12th, Sun 18th.
  const days = ['2031-05-05', '2031-05-07', '2031-05-12', '2031-05-18'];
  const store = cleanExport(
    loadFixture(
      days.flatMap((day, i) => [
        row({ call_id: `p${i}`, caller_number_hash: `hp${i}`, started_at: `${day}T12:00:00Z`, outcome: 'booked', revenue_usd: '100' }),
        row({ call_id: `q${i}`, caller_number_hash: `hq${i}`, started_at: `${day}T13:00:00Z`, location_id: 'zz_lon', answered: 'false', outcome: 'missed', revenue_usd: '' }),
      ]),
      CAMPAIGNS,
      LOCATIONS,
    ),
  );
  const span = dataSpan(store.calls)!;

  const resolve = (spec: RangeSpec) => {
    const result = resolveRange(span, spec);
    if (!result.ok) throw new Error(result.error.message);
    return result.range;
  };

  test('the span and presets come from the data, not from constants', () => {
    expect(span).toEqual({ start: '2031-05-05', end: '2031-05-18' });
    expect(resolve({ kind: 'preset', preset: 'all' })).toEqual({ ...span, days: 14, clamped: false });
    expect(resolve({ kind: 'preset', preset: 'last7' })).toEqual({ start: '2031-05-12', end: '2031-05-18', days: 7, clamped: false });
  });

  test('the comparison is the seven days before', () => {
    const result = resolveComparison(span, resolve({ kind: 'preset', preset: 'last7' }));
    expect(result.ok && result.comparison).toMatchObject({
      previous: { start: '2031-05-05', end: '2031-05-11', days: 7 },
      available: true,
    });
  });

  test('totals, weeks and missed-call value work on other names', () => {
    expect(tally(store.calls)).toEqual({ calls: 8, uniqueCallers: 8, answered: 4, bookings: 4, revenueUsd: 400 });

    const weeks = callsPerWeek(store.calls, span, span);
    expect(weeks.map((w) => [w.weekStart, w.calls, w.partial])).toEqual([
      ['2031-05-05', 4, false],
      ['2031-05-12', 4, false],
    ]);

    const value = estimateMissedCallValue(buildMissedValueRates(store.calls), { campaignId: 'zz_c1', channel: 'referral' });
    expect(value.valueUsd).toBe(100);
    expect(value.source).toBe('overall'); // only 4 answered calls, below the minimum for the campaign's own rate
  });
});

describe('views on a different export', () => {
  const days = ['2031-05-05', '2031-05-07', '2031-05-12', '2031-05-18'];
  const store = cleanExport(
    loadFixture(
      [
        ...days.flatMap((day, i) => [
          row({ call_id: `p${i}`, caller_number_hash: `hp${i}`, started_at: `${day}T12:00:00Z`, outcome: 'booked', revenue_usd: '100' }),
          row({ call_id: `w${i}`, caller_number_hash: `hw${i}`, campaign_id: 'zz_c2', marketing_channel: 'paid_search', location_id: 'zz_akl', started_at: `${day}T08:00:00Z`, outcome: 'not_qualified', revenue_usd: '' }),
          row({ call_id: `q${i}`, caller_number_hash: `hq${i}`, started_at: `${day}T13:00:00Z`, location_id: 'zz_lon', answered: 'false', outcome: 'missed', revenue_usd: '' }),
        ]),
        row({ call_id: 'u1', caller_number_hash: 'hu1', campaign_id: '', marketing_channel: 'direct', location_id: 'zz_lon', started_at: '2031-05-18T09:00:00Z', answered: 'false', outcome: 'missed', revenue_usd: '' }),
      ],
      CAMPAIGNS,
      LOCATIONS,
    ),
  );
  const span = dataSpan(store.calls)!;

  const resolve = (spec: RangeSpec) => {
    const result = resolveRange(span, spec);
    if (!result.ok) throw new Error(result.error.message);
    return result.range;
  };

  test.each(['all', 'last7'] as const)('every view builds for %s', (preset) => {
    const range = resolve({ kind: 'preset', preset });
    const comparison = resolveComparison(span, range);
    const previous = comparison.ok && comparison.comparison.available ? comparison.comparison.previous : undefined;

    const overview = buildOverview(store, range, previous);
    const campaigns = buildCampaigns(store, range, previous);
    const locations = buildLocations(store, range, previous);
    const missed = buildMissedCalls(store, range, previous);
    for (const view of [overview, campaigns, locations, missed]) {
      expectAllFinite(view);
      expect(view.actions.length).toBeGreaterThan(0);
      for (const action of view.actions) expect(action.text.length).toBeGreaterThan(0);
    }

    expect(campaigns.rows.map((r) => r.name)).toEqual(expect.arrayContaining(['Quokka Promo', 'Wombat Weekend']));

    const london = buildMissedCalls(store, range, previous, { locationId: 'zz_lon' });
    expect(london.officeFilter).toEqual({ locationId: 'zz_lon', name: 'London Desk' });
  });

  test('a 7-day range against a 3-day range compares per day and stays finite', () => {
    const range = resolve({ kind: 'preset', preset: 'last7' });
    const second = { start: '2031-05-05', end: '2031-05-07' };
    const overview = buildOverview(store, range, second);
    const campaigns = buildCampaigns(store, range, second);
    for (const view of [overview, campaigns]) {
      expect(view.notes.comparison).toMatchObject({ available: true, perDay: true, currentDays: 7, previousDays: 3 });
      expectAllFinite(view);
      const text = JSON.stringify(view);
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('NaN');
    }
  });
});

describe('the print summary on a different export', () => {
  const days = ['2031-05-05', '2031-05-07', '2031-05-12', '2031-05-18'];
  const store = cleanExport(
    loadFixture(
      days.flatMap((day, i) => [
        row({ call_id: `p${i}`, caller_number_hash: `hp${i}`, started_at: `${day}T12:00:00Z`, outcome: 'booked', revenue_usd: '100' }),
        row({ call_id: `q${i}`, caller_number_hash: `hq${i}`, started_at: `${day}T13:00:00Z`, location_id: 'zz_lon', answered: 'false', outcome: 'missed', revenue_usd: '' }),
      ]),
      CAMPAIGNS,
      LOCATIONS,
    ),
  );
  const meta = metaFor(store);
  const takeaways = Object.fromEntries(
    (['overview', 'campaigns', 'locations', 'missed-calls'] as const).map((view) => [
      view,
      { status: 'ready', key: view, data: { view, text: `Takeaway for ${view}.`, source: 'template', reason: 'ai_off' } },
    ]),
  ) as PrintTakeaways;
  const build = (preset: string) => printModel({ view: overviewFor(`range=${preset}`, store), meta, span: meta.span!, takeaways });

  test.each(['last7', 'all'])('builds for %s: finite, five tiles, three blocks, no undefined or NaN', (preset) => {
    const model = build(preset);
    expect(model.blocks.map((b) => b.view)).toEqual(['campaigns', 'locations', 'missed-calls']);
    expect(model.tiles).toHaveLength(5);
    expect(model.blocks.every((b) => b.actions.length > 0)).toBe(true);
    expectAllFinite(model);
    const text = JSON.stringify(model);
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
    expect(model.asOf).toBe(`Data as of ${formatLongDate(days[days.length - 1]!)}`); // the data's last date, never the clock
  });

  test('the 7-day range names its length; All data has no comparison', () => {
    expect(build('last7').rangeLine).toContain('(7 days)');
    const all = build('all');
    expect(all.comparisonLine).toBeNull();
    expect(all.comparisonReason).not.toBeNull();
  });
});

describe('the answer on a different export', () => {
  const days = ['2031-05-05', '2031-05-07', '2031-05-12', '2031-05-18'];
  const store = cleanExport(
    loadFixture(
      [
        ...days.flatMap((day, i) => [
          row({ call_id: `p${i}`, caller_number_hash: `hp${i}`, started_at: `${day}T12:00:00Z`, outcome: 'booked', revenue_usd: '100' }),
          row({ call_id: `q${i}`, caller_number_hash: `hq${i}`, started_at: `${day}T13:00:00Z`, location_id: 'zz_lon', answered: 'false', outcome: 'missed', revenue_usd: '' }),
        ]),
        row({ call_id: 'u1', caller_number_hash: 'hu1', campaign_id: '', marketing_channel: 'direct', location_id: 'zz_lon', started_at: '2031-05-18T09:00:00Z', answered: 'false', outcome: 'missed', revenue_usd: '' }),
      ],
      CAMPAIGNS,
      LOCATIONS,
    ),
  );
  const span = dataSpan(store.calls)!;
  const resolved = resolveRange(span, { kind: 'preset', preset: 'all' });
  if (!resolved.ok) throw new Error(resolved.error.message);
  const all = resolved.range;
  const open: AnswerFilter = { view: 'missed-calls', officeIds: [], campaignIds: [], includeUnattributed: false, weekdays: [], hours: [] };

  test('builds with its own names, zones and dates', () => {
    // Monday 2031-05-05 13:00 UTC is 14:00 in London (UTC+1); the 12th is a Monday too, so two calls match.
    const view = buildAnswer(store, all, { ...open, officeIds: ['zz_lon'], weekdays: [0], hours: [14] });
    expect(view.rows.map((r) => [r.name, r.calls, r.unanswered])).toEqual([['London Desk', 2, 2]]);
    expect(view.sentence).toBe('London Desk had the most unanswered calls: 2 of 2.');
    expectAllFinite(view);
    const campaigns = buildAnswer(store, all, { ...open, view: 'campaigns', includeUnattributed: true });
    expect(campaigns.rows.map((r) => r.name)).toEqual(['Unattributed']);
  });

  test('the URL validator parses its ids and rejects the shipped ones', () => {
    const parsed = parseAnswerQuery(store, span, { view: ['missed-calls'], f_office: ['zz_lon'], f_weekday: ['0'], range: ['all'] });
    expect(parsed.ok && parsed.value.filter).toMatchObject({ officeIds: ['zz_lon'], weekdays: [0] });
    expect(parseAnswerQuery(store, span, { f_office: ['loc_06'] }).ok).toBe(false);
  });

  test('a model reply names this export, not the shipped one', () => {
    const reply = {
      answerable: true,
      view: 'missed-calls' as const,
      offices: ['london desk'],
      campaigns: ['Quokka Promo'],
      includeUnattributed: false,
      weekdays: ['monday' as const],
      hours: [14],
      range: { preset: 'all' as const },
    };
    expect(replyToQuery(store, span, reply, 'london desk and Quokka Promo')).toEqual({
      ok: true,
      value: 'view=missed-calls&f_office=zz_lon&f_campaign=zz_c1&f_weekday=0&f_hour=14&range=all',
    });
    expect(replyToQuery(store, span, { ...reply, offices: ['Canyon Office'] }, 'Canyon Office').ok).toBe(false);
  });
});

describe('call-change alerts on a different export', () => {
  // zz_c1 gets 25 calls in the seven days before the last seven and 60 in the last seven; one early call makes the data span reach back far enough.
  const many = (prefix: string, day: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
      row({ call_id: `${prefix}${i}`, caller_number_hash: `h${prefix}${i}`, started_at: `${day}T12:00:00Z`, outcome: 'booked', revenue_usd: '100' }),
    );
  const store = cleanExport(
    loadFixture([...many('a', '2031-05-01', 1), ...many('b', '2031-05-08', 25), ...many('c', '2031-05-15', 60)], CAMPAIGNS, LOCATIONS),
  );
  const span = dataSpan(store.calls)!;
  const resolved = resolveRange(span, { kind: 'preset', preset: 'last7' });
  if (!resolved.ok) throw new Error(resolved.error.message);
  const comparison = resolveComparison(span, resolved.range);
  const previous = comparison.ok && comparison.comparison.available ? comparison.comparison.previous : undefined;

  test('the jump is flagged and Overview lists it with the new name', () => {
    const campaigns = buildCampaigns(store, resolved.range, previous);
    expect(campaigns.rows.find((r) => r.campaignId === 'zz_c1')?.alert?.direction).toBe('jump');
    const overview = buildOverview(store, resolved.range, previous);
    const alert = overview.topActions.find((t) => t.action.kind === 'review_call_changes');
    expect(alert?.action.text).toContain('Quokka Promo');
    expectAllFinite(campaigns);
    expectAllFinite(overview);
  });
});

describe('the server on a different export', () => {
  const days = ['2031-05-05', '2031-05-07', '2031-05-12', '2031-05-18'];
  const store = cleanExport(
    loadFixture(
      [
        ...days.flatMap((day, i) => [
          row({ call_id: `p${i}`, caller_number_hash: `hp${i}`, started_at: `${day}T12:00:00Z`, outcome: 'booked', revenue_usd: '100' }),
          row({ call_id: `w${i}`, caller_number_hash: `hw${i}`, campaign_id: 'zz_c2', marketing_channel: 'paid_search', location_id: 'zz_akl', started_at: `${day}T08:00:00Z`, outcome: 'not_qualified', revenue_usd: '' }),
          row({ call_id: `q${i}`, caller_number_hash: `hq${i}`, started_at: `${day}T13:00:00Z`, location_id: 'zz_lon', answered: 'false', outcome: 'missed', revenue_usd: '' }),
        ]),
      ],
      CAMPAIGNS,
      LOCATIONS,
    ),
  );
  const app = createApp(store);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getJson = async (path: string): Promise<{ status: number; body: any }> => {
    const response = await app.request(path);
    return { status: response.status, body: await response.json() };
  };

  test.each(['all', 'last7'])('every route answers for %s', async (range) => {
    for (const path of ['/api/overview', '/api/campaigns', '/api/locations', '/api/missed-calls']) {
      expect([path, (await app.request(`${path}?range=${range}`)).status]).toEqual([path, 200]);
    }
    expect((await app.request(`/api/missed-calls/callbacks.csv?range=${range}`)).status).toBe(200);

    const campaigns = (await getJson(`/api/campaigns?range=${range}`)).body;
    expect(campaigns.rows.map((r: { name: string }) => r.name)).toEqual(expect.arrayContaining(['Quokka Promo', 'Wombat Weekend']));
  });

  test('the pickers work on other names', async () => {
    const london = await getJson('/api/missed-calls?range=all&location=zz_lon');
    expect(london.status).toBe(200);
    expect(london.body.officeFilter.name).toBe('London Desk');
    expect((await getJson('/api/campaigns?range=all&campaign=zz_c1')).status).toBe(200);
  });

  test('meta lists the three offices', async () => {
    const { body } = await getJson('/api/meta');
    expect(body.locations.map((l: { name: string }) => l.name).sort()).toEqual(['Auckland Annex', 'Kolkata Hub', 'London Desk']);
  });
});

describe('nothing in src/ is tied to the shipped dataset', () => {
  const srcDir = join(__dirname, '..', '..', 'src');
  const sourceFiles = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ file: f, text: readFileSync(join(srcDir, f), 'utf8') }));
  // The page shell is shipped code too.
  sourceFiles.push({ file: '../index.html', text: readFileSync(join(srcDir, '..', 'index.html'), 'utf8') });

  // Every name, id and zone in the shipped export, plus the tracking-number prefix.
  const shipped = readExportFromDir(join(__dirname, '..', 'fixtures', 'original-export'));
  const needles = [
    ...shipped.campaigns.flatMap((c) => [c.id, c.name]),
    ...shipped.locations.flatMap((l) => [l.id, l.name, l.timezone]),
    '+1-555',
  ];

  test('the shipped export gave us names to look for', () => {
    expect(needles.length).toBeGreaterThan(30);
    expect(sourceFiles.length).toBeGreaterThan(5);
    // The scan covers components and the page shell, not just .ts.
    expect(sourceFiles.some((f) => f.file.endsWith('.tsx'))).toBe(true);
    expect(sourceFiles.some((f) => f.file.endsWith('index.html'))).toBe(true);
  });

  test.each([...new Set(needles)])('no source file contains "%s"', (needle) => {
    expect(sourceFiles.filter((f) => f.text.includes(needle)).map((f) => f.file)).toEqual([]);
  });

  test('the answer code is part of the scan and holds no dataset name', () => {
    const files = sourceFiles.map((f) => f.file.replace(/\\/g, '/'));
    expect(files.filter((f) => f.startsWith('core/answer/')).length).toBe(3);
    expect(files).toContain('server/questionQuery.ts');
    const answerText = sourceFiles
      .filter((f) => /core[\\/]answer[\\/]|questionQuery\.ts$/.test(f.file))
      .map((f) => f.text)
      .join('\n');
    expect([...new Set(needles)].filter((needle) => answerText.includes(needle))).toEqual([]);
  });

  test('no source file contains a literal year-month such as 2026-10', () => {
    expect(sourceFiles.filter((f) => /\b20\d\d-\d\d/.test(f.text)).map((f) => f.file)).toEqual([]);
  });
});
