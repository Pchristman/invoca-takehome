// Tests added after the Phase 4 adversarial review: each one pins a finding from it.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { GenerateError, generateExtendedCalls, writeExtended } from '../../scripts/generate-extended';
import { cleanExport } from '../../src/core/clean';
import { loadExport } from '../../src/core/loadExport';
import { callLine, callsText, FIXTURE, OFF } from './extendedFixture';
import type { RawCall } from './extendedFixture';

type Row = Record<string, string>;
const parseRows = (text: string): Row[] => parse(text, { columns: true, skip_empty_lines: true }) as Row[];
const withCalls = (calls: string) => ({ ...FIXTURE, calls });
const cleaned = (calls: string) => cleanExport(loadExport({ ...FIXTURE, calls }));
const copiesOf = (out: string): Row[] => parseRows(out).filter((r) => r.call_id?.startsWith('x_'));

const PLAIN = { ...OFF, plainCalls: 5 };
/** Unattributed anchors keep the span at 80 days without adding plain templates. */
const ANCHOR_FIRST: RawCall = { id: 'u1', start: '2026-09-01T10:00:00Z', campaign: '', channel: 'direct', tracking: '+1-555-0009', answered: false, outcome: 'missed' };
const ANCHOR_LAST: RawCall = { id: 'u2', start: '2026-11-20T10:00:00Z', campaign: '', channel: 'direct', tracking: '+1-555-0009', answered: false, outcome: 'missed' };

describe('line endings, BOM and a missing final newline', () => {
  const lines = callsText([
    { id: 'c1', start: '2026-09-01T10:00:00Z', outcome: 'qualified_lead' },
    { id: 'c2', start: '2026-11-01T10:00:00Z', outcome: 'booked', revenue: '90' },
  ]);

  it('an input with no final newline gets one before the synthetic rows', () => {
    const out = generateExtendedCalls(withCalls(lines.replace(/\r\n$/, '')), { ...PLAIN, plainCalls: 3 });
    expect(parseRows(out)).toHaveLength(2 + 3);
    expect(out).toMatch(/\r\n$/);
  });

  it('an LF input gets LF rows, not a mix', () => {
    const out = generateExtendedCalls(withCalls(lines.replace(/\r\n/g, '\n')), { ...PLAIN, plainCalls: 3 });
    expect(out.includes('\r')).toBe(false);
    expect(parseRows(out)).toHaveLength(2 + 3);
  });

  it('an input that mixes CRLF and LF throws GenerateError', () => {
    expect(() => generateExtendedCalls(withCalls(lines.replace('\r\n', '\n')), { ...PLAIN, plainCalls: 1 })).toThrow(/mixes/);
  });

  it('a UTF-8 byte order mark is kept and is not part of the first column name', () => {
    const out = generateExtendedCalls(withCalls('﻿' + lines), { ...PLAIN, plainCalls: 3 });
    expect(out.startsWith('﻿' + lines)).toBe(true);
    const ids = (parse(out, { bom: true, columns: true, skip_empty_lines: true }) as Row[]).map((r) => r.call_id);
    expect(ids).toHaveLength(5);
    expect(ids.slice(2).sort()).toEqual(['x_000001', 'x_000002', 'x_000003']);
  });
});

describe('surge and fade windows are office-local dates', () => {
  // Camp_a's only calls are at 06:00 UTC at the New York office: after the 1 Nov clock change that is 01:00
  // local on the same date, a local day later than a UTC window "ends" on. The last call is 23:30 on 19 Nov in
  // Phoenix, so the last local date is 19 Nov. Thursdays test the surge's last day; Fridays the fade's.
  const inputOn = (dates: string[]) =>
    withCalls(
      callsText([
        { id: 'b1', start: '2026-09-01T10:00:00Z', campaign: 'camp_b', outcome: 'qualified_lead' },
        { id: 'a1', start: `${dates[0]}T06:00:00Z`, loc: 'loc_b', answered: false, outcome: 'missed' },
        { id: 'a2', start: `${dates[1]}T06:00:00Z`, loc: 'loc_b', outcome: 'booked', revenue: '100' },
        { id: 'a3', start: `${dates[2]}T06:00:00Z`, loc: 'loc_b', outcome: 'qualified_lead' },
        { id: 'b2', start: '2026-11-20T06:30:00Z', campaign: 'camp_b', outcome: 'qualified_lead' },
      ]),
    );
  const block = { campaignId: 'camp_a', calls: 60, unanswered: 20, booked: 20 };

  it('every surge copy is inside the last 28 local days, before the last day', () => {
    const calls = cleaned(generateExtendedCalls(inputOn(['2026-10-15', '2026-10-22', '2026-10-29']), { ...OFF, campaignSurge: block })).calls;
    expect(calls.filter((c) => !c.callId.startsWith('x_')).map((c) => c.localDate).sort().at(-1)).toBe('2026-11-19');
    const copies = calls.filter((c) => c.callId.startsWith('x_'));
    expect(copies).toHaveLength(60);
    for (const c of copies) expect([c.callId, c.localDate >= '2026-10-23' && c.localDate <= '2026-11-18']).toEqual([c.callId, true]);
  });

  it('every fade copy is inside the 28 local days before that', () => {
    const copies = cleaned(generateExtendedCalls(inputOn(['2026-10-16', '2026-10-23', '2026-10-30']), { ...OFF, campaignFade: block })).calls.filter((c) => c.callId.startsWith('x_'));
    expect(copies).toHaveLength(60);
    for (const c of copies) expect([c.callId, c.localDate >= '2026-09-25' && c.localDate <= '2026-10-22']).toEqual([c.callId, true]);
  });
});

describe('outcome lag', () => {
  it('data with no outcome lag at all cannot take duplicates: GenerateError naming the lag', () => {
    const noLag = withCalls(callsText([ANCHOR_FIRST, ANCHOR_LAST, { id: 'k1', start: '2026-10-10T10:00:00Z', outcome: 'booked', revenue: '50' }]));
    expect(() => generateExtendedCalls(noLag, { ...OFF, duplicatedCalls: 1 })).toThrow(GenerateError);
    expect(() => generateExtendedCalls(noLag, { ...OFF, duplicatedCalls: 1 })).toThrow(/lag/i);
  });
});

describe('repeat callers and agents', () => {
  it('copies reuse real callers at the share the data shows, and make new ones when it shows none', () => {
    const repeated = callsText([
      ANCHOR_FIRST,
      ANCHOR_LAST,
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `r${i}`,
        start: `2026-10-${String(1 + i).padStart(2, '0')}T12:00:00Z`,
        outcome: 'qualified_lead',
        hash: `h_r${i % 4}`,
      })),
    ]);
    const real = new Set(parseRows(repeated).map((r) => r.caller_number_hash));
    const copies = copiesOf(generateExtendedCalls(withCalls(repeated), { ...OFF, plainCalls: 100 }));
    const reused = copies.filter((r) => real.has(r.caller_number_hash ?? '')).length;
    expect(reused).toBeGreaterThan(40); // 4 callers over 20 calls: about 4 in 5 copies are repeats
    expect(reused).toBeLessThan(100); // and not all
    // No repeat callers in the fixture, so every copy is a new caller.
    expect(copiesOf(generateExtendedCalls(FIXTURE, { ...OFF, plainCalls: 50 })).every((r) => r.caller_number_hash?.startsWith('h_x'))).toBe(true);
  });

  it("a call moved to another office gets one of that office's agents", () => {
    const input = withCalls(
      callsText([
        ANCHOR_FIRST,
        ANCHOR_LAST,
        { id: 'p1', start: '2026-10-01T12:00:00Z', loc: 'loc_a', agent: 'agt_a', outcome: 'booked', revenue: '80' },
        { id: 'p2', start: '2026-10-02T12:00:00Z', loc: 'loc_a', agent: 'agt_a', outcome: 'qualified_lead' },
        { id: 'p3', start: '2026-10-03T12:00:00Z', loc: 'loc_a', answered: false, outcome: 'missed' },
        { id: 'q1', start: '2026-10-04T12:00:00Z', loc: 'loc_b', agent: 'agt_b', outcome: 'qualified_lead' },
      ]),
    );
    const out = copiesOf(generateExtendedCalls(input, { ...OFF, officeLowConversion: { locationId: 'loc_b', calls: 12, unanswered: 2, booked: 4 } }));
    expect(out).toHaveLength(12);
    expect(out.filter((r) => r.answered === 'true').every((r) => r.agent_id === 'agt_b')).toBe(true);
    expect(out.filter((r) => r.answered === 'false').every((r) => r.agent_id === '')).toBe(true);
  });
});

describe('config checks and errors', () => {
  it('fractional or negative counts throw GenerateError naming the setting', () => {
    expect(() => generateExtendedCalls(FIXTURE, { ...OFF, plainCalls: 2.5 })).toThrow(/plainCalls/);
    expect(() => generateExtendedCalls(FIXTURE, { ...OFF, officeLowConversion: { locationId: 'loc_b', calls: 5, unanswered: 1.5, booked: 0 } })).toThrow(/unanswered/);
    expect(() => generateExtendedCalls(FIXTURE, { ...OFF, pendingCalls: -1 })).toThrow(/pendingCalls/);
  });

  it('a window outside the week or the day throws GenerateError', () => {
    const drop = { ...OFF.officeAnswerDrop, calls: 2, answered: 0 };
    expect(() => generateExtendedCalls(FIXTURE, { ...OFF, officeAnswerDrop: { ...drop, weekdays: { from: 0, to: 9 } } })).toThrow(/window/i);
    expect(() => generateExtendedCalls(FIXTURE, { ...OFF, officeAnswerDrop: { ...drop, hours: { from: 0, to: 30 } } })).toThrow(/window/i);
  });

  it('windowDays under 7 throws GenerateError naming it', () => {
    expect(() => generateExtendedCalls(FIXTURE, { ...OFF, windowDays: 0 })).toThrow(/windowDays/);
  });

  it('an unknown time zone throws GenerateError naming it', () => {
    const bad = { ...FIXTURE, locations: FIXTURE.locations.replace('America/Phoenix', 'Mars/Olympus') };
    expect(() => generateExtendedCalls(bad, PLAIN)).toThrow(GenerateError);
    expect(() => generateExtendedCalls(bad, PLAIN)).toThrow(/Mars\/Olympus/);
  });

  it('writeExtended on a folder with no calls.csv throws GenerateError, not a raw file error', () => {
    expect(() => writeExtended(join(tmpdir(), 'no-such-export-folder'), join(tmpdir(), 'out-folder'))).toThrow(GenerateError);
  });
});

describe("which row is a call's final state", () => {
  const rowWith = (id: string, updated: string, over: Partial<RawCall>) => callLine({ id, start: '2026-10-10T10:00:00Z', ...over }).replace(/[^,]*$/, updated);
  const only = (lines: string[]) => withCalls(callsText([ANCHOR_FIRST, ANCHOR_LAST], lines));
  const allBooked = (out: string) => {
    const copies = copiesOf(out);
    return copies.length === 5 && copies.every((r) => r.outcome === 'booked' && r.revenue_usd === '100');
  };

  it('on a tie in updated_at the later row in the file wins', () => {
    const input = only([rowWith('t1', '2026-10-10T10:05:00Z', { outcome: '' }), rowWith('t1', '2026-10-10T10:05:00Z', { outcome: 'booked', revenue: '100' })]);
    expect(allBooked(generateExtendedCalls(input, PLAIN))).toBe(true);
  });

  it('a row whose updated_at cannot be read loses, even when it comes first', () => {
    const input = only([rowWith('t1', 'not-a-time', { outcome: '' }), rowWith('t1', '2026-10-10T10:05:00Z', { outcome: 'booked', revenue: '100' })]);
    expect(allBooked(generateExtendedCalls(input, PLAIN))).toBe(true);
  });
});
