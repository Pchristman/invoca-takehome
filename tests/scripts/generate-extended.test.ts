import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { GenerateError, generateExtendedCalls } from '../../scripts/generate-extended';
import { cleanExport } from '../../src/core/clean';
import { loadExport } from '../../src/core/loadExport';
import { callsText, FIXTURE, OFF } from './extendedFixture';

type Row = Record<string, string>;
const parseRows = (text: string): Row[] => parse(text, { columns: true, skip_empty_lines: true }) as Row[];

const PLAIN5 = { ...OFF, plainCalls: 5 };
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

const originalRows = parseRows(FIXTURE.calls);
const syntheticOf = (out: string): Row[] => parseRows(out).slice(originalRows.length);
const ms = (s: string | undefined) => Date.parse(s ?? '');

describe('generateExtendedCalls: plain calls', () => {
  it('same seed gives identical text; a different seed gives different text', () => {
    const a = generateExtendedCalls(FIXTURE, PLAIN5);
    expect(generateExtendedCalls(FIXTURE, PLAIN5)).toBe(a);
    expect(generateExtendedCalls(FIXTURE, { ...PLAIN5, seed: PLAIN5.seed + 1 })).not.toBe(a);
  });

  it('the original calls text is kept byte for byte at the start', () => {
    expect(generateExtendedCalls(FIXTURE, PLAIN5).startsWith(FIXTURE.calls)).toBe(true);
  });

  it('adds exactly plainCalls rows, with the original header columns', () => {
    const out = generateExtendedCalls(FIXTURE, PLAIN5);
    const header = Object.keys(originalRows[0] ?? {});
    expect(header).toHaveLength(14);
    expect(parseRows(out)).toHaveLength(originalRows.length + 5);
    for (const row of syntheticOf(out)) expect(Object.keys(row)).toEqual(header);
  });

  it('every line ends CRLF, the file ends with CRLF, and no bare LF', () => {
    const out = generateExtendedCalls(FIXTURE, PLAIN5);
    expect(out).toMatch(/\r\n$/);
    expect(out.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  it('synthetic ids are x_ numbered from 1 and do not collide with the input', () => {
    const ids = syntheticOf(generateExtendedCalls(FIXTURE, PLAIN5)).map((r) => r.call_id);
    expect(ids).toEqual(['x_000001', 'x_000002', 'x_000003', 'x_000004', 'x_000005']);

    const clash = { ...FIXTURE, calls: callsText([{ id: 'x_000001', start: '2026-10-01T10:00:00Z', outcome: 'qualified_lead' }, { id: 'c1', start: '2026-12-01T10:00:00Z', outcome: 'qualified_lead' }]) };
    expect(() => generateExtendedCalls(clash, { ...PLAIN5, plainCalls: 1 })).toThrow(GenerateError);
    expect(() => generateExtendedCalls(clash, { ...PLAIN5, plainCalls: 1 })).toThrow(/x_000001/);
  });

  it('synthetic starts stay at least a day inside the span', () => {
    const starts = originalRows.map((r) => ms(r.started_at));
    const lo = Math.min(...starts) + DAY;
    const hi = Math.max(...starts) - DAY;
    const out = generateExtendedCalls(FIXTURE, { ...PLAIN5, plainCalls: 200 });
    for (const r of syntheticOf(out)) {
      expect(ms(r.started_at)).toBeGreaterThanOrEqual(lo);
      expect(ms(r.started_at)).toBeLessThanOrEqual(hi);
      expect(ms(r.ended_at)).toBe(ms(r.started_at) + Number(r.duration_seconds) * 1000);
      for (const col of ['started_at', 'ended_at', 'updated_at'] as const) expect(r[col]).toMatch(ISO);
      const gap = ms(r.updated_at) - ms(r.ended_at);
      expect(gap).toBeGreaterThanOrEqual(5000);
      expect(gap).toBeLessThanOrEqual(30000);
      expect(r.caller_number_hash).toMatch(/^h_x[0-9a-f]{7}$/);
    }
  });

  it('weekday and time of day are copied from a real call', () => {
    const real = originalRows.map((r) => ms(r.started_at));
    for (const r of syntheticOf(generateExtendedCalls(FIXTURE, { ...PLAIN5, plainCalls: 50 }))) {
      expect(real.some((t) => (ms(r.started_at) - t) % WEEK === 0)).toBe(true);
    }
  });

  it('a span under a week throws GenerateError', () => {
    const short = { ...FIXTURE, calls: callsText([{ id: 'c1', start: '2026-10-01T10:00:00Z' }, { id: 'c2', start: '2026-10-04T10:00:00Z' }]) };
    expect(() => generateExtendedCalls(short, { ...PLAIN5, plainCalls: 1 })).toThrow(GenerateError);
    expect(() => generateExtendedCalls(short, { ...PLAIN5, plainCalls: 1 })).toThrow(/span/i);
  });

  it('an empty template pool throws GenerateError', () => {
    const noPlain = {
      ...FIXTURE,
      calls: callsText([
        { id: 'c1', start: '2026-09-01T10:00:00Z', campaign: '' },
        { id: 'c2', start: '2026-11-01T10:00:00Z', campaign: '' },
      ]),
    };
    expect(() => generateExtendedCalls(noPlain, { ...PLAIN5, plainCalls: 1 })).toThrow(GenerateError);
    expect(() => generateExtendedCalls(noPlain, { ...PLAIN5, plainCalls: 1 })).toThrow(/plain/i);
  });

  it('no clock or Math.random', () => {
    const source = readFileSync('scripts/generate-extended.ts', 'utf8');
    expect(source).not.toMatch(/Math\.random|Date\.now|new Date\(\)/);
  });
});

// ---------- Task 2: pattern A, the office answer-rate drop ----------

const cleaned = (calls: string) => cleanExport(loadExport({ ...FIXTURE, calls }));
const synthOf = (calls: string) => cleaned(calls).calls.filter((c) => c.callId.startsWith('x_'));

const A_LOC_A = { locationId: 'loc_a', weekdays: { from: 0, to: 4 }, hours: { from: 9, to: 11 }, calls: 6, answered: 2 };
const withA = (over: Partial<typeof A_LOC_A> = {}) => ({ ...OFF, officeAnswerDrop: { ...A_LOC_A, ...over } });

describe('generateExtendedCalls: pattern A, office answer drop', () => {
  it('all at the target office, in the window by local time', () => {
    const calls = synthOf(generateExtendedCalls(FIXTURE, withA()));
    expect(calls).toHaveLength(6);
    for (const c of calls) {
      expect(c.locationId).toBe('loc_a');
      expect(c.localWeekday).toBeGreaterThanOrEqual(0);
      expect(c.localWeekday).toBeLessThanOrEqual(4);
      expect(c.localHour).toBeGreaterThanOrEqual(9);
      expect(c.localHour).toBeLessThanOrEqual(11);
    }
  });

  it('the window holds across a DST change (New York, 1 Nov)', () => {
    const calls = synthOf(generateExtendedCalls(FIXTURE, withA({ locationId: 'loc_b', calls: 40, answered: 8 })));
    expect(calls).toHaveLength(40);
    for (const c of calls) {
      expect(c.localHour).toBeGreaterThanOrEqual(9);
      expect(c.localHour).toBeLessThanOrEqual(11);
    }
    expect(calls.some((c) => c.localDate >= '2026-11-01')).toBe(true);
    expect(calls.some((c) => c.localDate < '2026-11-01')).toBe(true);
  });

  it('exactly answered of them are answered, and those are booked', () => {
    const calls = synthOf(generateExtendedCalls(FIXTURE, withA()));
    const answered = calls.filter((c) => c.answered);
    expect(answered).toHaveLength(2);
    for (const c of answered) {
      expect(c.booked).toBe(true);
      expect(c.revenueUsd).toBeGreaterThan(0);
    }
    const unanswered = calls.filter((c) => !c.answered);
    expect(unanswered).toHaveLength(4);
    for (const c of unanswered) {
      expect(['missed', 'voicemail', null]).toContain(c.outcome);
      expect(c.revenueUsd).toBe(0);
      expect(c.agentId).toBeNull();
    }
  });

  it('no bad rows, and revenue only on booked', () => {
    const { dataNotes } = cleaned(generateExtendedCalls(FIXTURE, withA()));
    expect(dataNotes.badCalls).toBe(0);
    expect(dataNotes.revenueOnNonBookedCalls).toBe(0);
  });

  it('a target office not in locations.csv throws GenerateError naming it', () => {
    expect(() => generateExtendedCalls(FIXTURE, withA({ locationId: 'loc_zz' }))).toThrow(GenerateError);
    expect(() => generateExtendedCalls(FIXTURE, withA({ locationId: 'loc_zz' }))).toThrow(/loc_zz/);
  });

  it('answered above calls throws GenerateError', () => {
    expect(() => generateExtendedCalls(FIXTURE, withA({ calls: 3, answered: 4 }))).toThrow(GenerateError);
  });

  it('a window that never occurs throws GenerateError', () => {
    const short = { ...FIXTURE, calls: callsText([
      { id: 'c1', start: '2026-10-01T10:00:00Z', outcome: 'booked', revenue: '100' },
      { id: 'c2', start: '2026-10-04T10:00:00Z', answered: false, outcome: 'missed' },
    ]) };
    const config = withA({ weekdays: { from: 6, to: 6 } });
    expect(() => generateExtendedCalls(short, config)).toThrow(GenerateError);
    expect(() => generateExtendedCalls(short, config)).toThrow(/window|span/i);
  });

  it('an empty window (hours from after to) throws GenerateError naming the window', () => {
    const config = withA({ hours: { from: 9, to: 8 } });
    expect(() => generateExtendedCalls(FIXTURE, config)).toThrow(/window/i);
  });

  it('no booked templates, or no unanswered templates, throws GenerateError naming which', () => {
    const wide = (rows: Parameters<typeof callsText>[0]) => ({ ...FIXTURE, calls: callsText(rows) });
    const noBooked = wide([
      { id: 'c1', start: '2026-09-01T10:00:00Z', answered: false, outcome: 'missed' },
      { id: 'c2', start: '2026-11-01T10:00:00Z', outcome: 'qualified_lead' },
    ]);
    expect(() => generateExtendedCalls(noBooked, withA())).toThrow(/booked/i);
    const noUnanswered = wide([
      { id: 'c1', start: '2026-09-01T10:00:00Z', outcome: 'booked', revenue: '100' },
      { id: 'c2', start: '2026-11-01T10:00:00Z', outcome: 'qualified_lead' },
    ]);
    expect(() => generateExtendedCalls(noUnanswered, withA())).toThrow(/unanswered/i);
  });
});

// ---------- Task 3: pattern B, the office low-conversion outlier ----------

const B_LOC_B = { locationId: 'loc_b', calls: 6, unanswered: 1, booked: 1 };
const withB = (over: Partial<typeof B_LOC_B> = {}) => ({ ...OFF, officeLowConversion: { ...B_LOC_B, ...over } });

describe('generateExtendedCalls: pattern B, office low conversion', () => {
  it('counts are exact', () => {
    const calls = synthOf(generateExtendedCalls(FIXTURE, withB()));
    expect(calls).toHaveLength(6);
    for (const c of calls) expect(c.locationId).toBe('loc_b');
    expect(calls.filter((c) => !c.answered)).toHaveLength(1);
    const booked = calls.filter((c) => c.booked);
    expect(booked).toHaveLength(1);
    expect(booked[0]?.revenueUsd).toBeGreaterThan(0);
    const notBooked = calls.filter((c) => c.answered && !c.booked);
    expect(notBooked).toHaveLength(4);
    for (const c of notBooked) {
      expect(['qualified_lead', 'not_qualified']).toContain(c.outcome);
      expect(c.revenueUsd).toBe(0);
    }
  });

  it('no pending, no unattributed, no bad rows', () => {
    const store = cleaned(generateExtendedCalls(FIXTURE, withB({ calls: 60, unanswered: 12, booked: 5 })));
    const calls = store.calls.filter((c) => c.callId.startsWith('x_'));
    expect(calls).toHaveLength(60);
    expect(calls.some((c) => c.pending || c.unattributed)).toBe(false);
    expect(store.dataNotes.badCalls).toBe(0);
  });

  it('starts stay inside the span margin', () => {
    const starts = originalRows.map((r) => ms(r.started_at));
    const lo = Math.min(...starts) + DAY;
    const hi = Math.max(...starts) - DAY;
    for (const r of syntheticOf(generateExtendedCalls(FIXTURE, withB({ calls: 60, unanswered: 12, booked: 5 })))) {
      expect(ms(r.started_at)).toBeGreaterThanOrEqual(lo);
      expect(ms(r.started_at)).toBeLessThanOrEqual(hi);
    }
  });

  it('booked + unanswered above calls throws GenerateError', () => {
    expect(() => generateExtendedCalls(FIXTURE, withB({ calls: 5, unanswered: 3, booked: 3 }))).toThrow(GenerateError);
  });

  it('a target office not in locations.csv throws GenerateError naming it', () => {
    expect(() => generateExtendedCalls(FIXTURE, withB({ locationId: 'loc_zz' }))).toThrow(/loc_zz/);
  });

  it('no answered-not-booked templates and a positive remainder throws GenerateError', () => {
    const noQualified = { ...FIXTURE, calls: callsText([
      { id: 'c1', start: '2026-09-01T10:00:00Z', answered: false, outcome: 'missed' },
      { id: 'c2', start: '2026-11-01T10:00:00Z', outcome: 'booked', revenue: '100' },
    ]) };
    expect(() => generateExtendedCalls(noQualified, withB())).toThrow(GenerateError);
    expect(() => generateExtendedCalls(noQualified, withB())).toThrow(/not booked/i);
  });
});

// ---------- Task 4: patterns C and D, the campaign surge and fade ----------

const CD = {
  ...OFF,
  windowDays: 28,
  campaignSurge: { campaignId: 'camp_a', calls: 6, unanswered: 1, booked: 2 },
  campaignFade: { campaignId: 'camp_b', calls: 6, unanswered: 1, booked: 0 },
};

/** 'YYYY-MM-DD' minus a number of days. */
const minusDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10);

describe('generateExtendedCalls: patterns C and D, campaign surge and fade', () => {
  const store = cleaned(generateExtendedCalls(FIXTURE, CD));
  const realCalls = store.calls.filter((c) => !c.callId.startsWith('x_'));
  const synth = store.calls.filter((c) => c.callId.startsWith('x_'));
  const surge = synth.filter((c) => c.campaignId === 'camp_a');
  const fade = synth.filter((c) => c.campaignId === 'camp_b');
  const lastDate = realCalls.map((c) => c.localDate).sort().at(-1) as string;

  it('surge calls are camp_a, in the last 28 days; fade calls are camp_b, in the 28 days before', () => {
    expect(synth).toHaveLength(12);
    expect(surge).toHaveLength(6);
    expect(fade).toHaveLength(6);
    for (const c of surge) {
      expect(c.localDate >= minusDays(lastDate, 27)).toBe(true);
      expect(c.localDate <= minusDays(lastDate, 1)).toBe(true);
    }
    for (const c of fade) {
      expect(c.localDate >= minusDays(lastDate, 55)).toBe(true);
      expect(c.localDate <= minusDays(lastDate, 28)).toBe(true);
    }
  });

  it('counts are exact', () => {
    const count = (calls: typeof synth) => ({
      unanswered: calls.filter((c) => !c.answered).length,
      booked: calls.filter((c) => c.booked).length,
      notBooked: calls.filter((c) => c.answered && !c.booked).length,
    });
    expect(count(surge)).toEqual({ unanswered: 1, booked: 2, notBooked: 3 });
    expect(count(fade)).toEqual({ unanswered: 1, booked: 0, notBooked: 5 });
  });

  it("the campaign's own channel and tracking number are kept", () => {
    for (const c of synth) {
      const real = realCalls.filter((r) => r.campaignId === c.campaignId);
      expect(real.some((r) => r.channel === c.channel && r.trackingNumber === c.trackingNumber)).toBe(true);
    }
  });

  it('no bad rows, no unattributed', () => {
    expect(store.dataNotes.badCalls).toBe(0);
    expect(synth.some((c) => c.unattributed || c.pending)).toBe(false);
  });

  it('a span under 2 x windowDays throws GenerateError', () => {
    const forty = { ...FIXTURE, calls: callsText([
      { id: 'c1', start: '2026-10-01T10:00:00Z', outcome: 'booked', revenue: '100' },
      { id: 'c2', start: '2026-10-10T10:00:00Z', answered: false, outcome: 'missed' },
      { id: 'c3', start: '2026-10-20T10:00:00Z', outcome: 'qualified_lead' },
      { id: 'c4', start: '2026-11-10T10:00:00Z', outcome: 'qualified_lead' },
    ]) };
    expect(() => generateExtendedCalls(forty, CD)).toThrow(GenerateError);
    expect(() => generateExtendedCalls(forty, CD)).toThrow(/span/i);
  });

  it('an unknown campaign throws GenerateError naming it', () => {
    const config = { ...CD, campaignSurge: { ...CD.campaignSurge, campaignId: 'camp_zz' } };
    expect(() => generateExtendedCalls(FIXTURE, config)).toThrow(/camp_zz/);
  });

  it('a campaign with no booked calls to clone throws GenerateError', () => {
    const noBooked = { ...FIXTURE, calls: callsText([
      { id: 'c1', start: '2026-09-01T10:00:00Z', outcome: 'booked', revenue: '100' },
      { id: 'c2', start: '2026-09-10T10:00:00Z', campaign: 'camp_b', answered: false, outcome: 'missed' },
      { id: 'c3', start: '2026-11-10T10:00:00Z', campaign: 'camp_b', outcome: 'qualified_lead' },
    ]) };
    const config = { ...CD, campaignSurge: { campaignId: 'camp_b', calls: 6, unanswered: 1, booked: 2 } };
    expect(() => generateExtendedCalls(noBooked, config)).toThrow(GenerateError);
    expect(() => generateExtendedCalls(noBooked, config)).toThrow(/booked/i);
  });

  it('counts that do not fit within calls throw GenerateError', () => {
    const config = { ...CD, campaignFade: { campaignId: 'camp_b', calls: 3, unanswered: 2, booked: 2 } };
    expect(() => generateExtendedCalls(FIXTURE, config)).toThrow(GenerateError);
  });
});
