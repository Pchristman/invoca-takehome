import { describe, expect, it } from 'vitest';
import type { MissedCallsView } from '../../src/core/views/missedCallsView';
import { heatLevel, heatmapModel } from '../../src/web/models/heatmapModel';

type Heatmap = MissedCallsView['heatmap'];

function hours(at: Record<number, number> = {}): number[] {
  return Array.from({ length: 24 }, (_, h) => at[h] ?? 0);
}
function sum(h: number[]): number {
  return h.reduce((a, b) => a + b, 0);
}
function office(locationId: string, name: string, at: Record<number, number> = {}) {
  const h = hours(at);
  return { locationId, name, hours: h, total: sum(h) };
}
function weekdays(perDay: Record<number, Record<number, number>> = {}) {
  return Array.from({ length: 7 }, (_, weekday) => {
    const h = hours(perDay[weekday] ?? {});
    return { weekday, hours: h, total: sum(h) };
  });
}
function heatmap(offices = [office('a', 'Office A', { 9: 3 }), office('b', 'Office B', { 10: 10 })]): Heatmap {
  return { byOffice: offices, byWeekday: weekdays({ 0: { 9: 2 }, 4: { 17: 8 } }) };
}

describe('heatLevel', () => {
  it('maps counts to five steps', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(3, 10)).toBe(2);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(5, 5)).toBe(4);
    expect(heatLevel(1, 1)).toBe(4);
    expect(heatLevel(11, 10)).toBe(4);
  });
  it('is 0 for no max, negative or non-finite input', () => {
    expect(heatLevel(7, 0)).toBe(0);
    expect(heatLevel(0, 0)).toBe(0);
    expect(heatLevel(-1, 5)).toBe(0);
    expect(heatLevel(NaN, 5)).toBe(0);
    expect(heatLevel(5, Infinity)).toBe(0);
    expect(heatLevel(5, NaN)).toBe(0);
  });
  it('never reads a smallest positive count as empty', () => {
    expect(heatLevel(1, 1_000_000)).toBe(1);
  });
});

describe('heatmapModel', () => {
  it('a zero cell is empty text, level 0, labelled 0 missed calls', () => {
    const m = heatmapModel(heatmap(), 'office');
    const zero = m.rows[0]!.cells[0]!;
    expect(zero.text).toBe('');
    expect(zero.level).toBe(0);
    expect(zero.label.endsWith('0 missed calls')).toBe(true);
    const one = heatmapModel(heatmap([office('a', 'Office A', { 5: 1 })]), 'office').rows[0]!.cells[5]!;
    expect(one.text).toBe('1');
    expect(one.label).toBe('Office A, 05:00: 1 missed call');
  });

  it('office mode: API order, 24 cells, hour labels, formatted totals', () => {
    const m = heatmapModel(heatmap([office('a', 'Office A', { 9: 1200 }), office('b', 'Office B', { 1: 2 })]), 'office');
    expect(m.mode).toBe('office');
    expect(m.rows.map((r) => r.label)).toEqual(['Office A', 'Office B']);
    expect(m.rows.every((r) => r.cells.length === 24)).toBe(true);
    expect(m.hourLabels).toHaveLength(24);
    expect(m.hourLabels.slice(0, 3)).toEqual(['12am', '1am', '2am']);
    expect(m.hourLabels[11]).toBe('11am');
    expect(m.hourLabels[12]).toBe('12pm');
    expect(m.hourLabels[13]).toBe('1pm');
    expect(m.hourLabels[23]).toBe('11pm');
    expect(m.rows[0]!.total).toBe('1,200');
    expect(m.rows[0]!.cells[9]!.text).toBe('1,200');
  });

  it('weekday mode: seven rows Monday first', () => {
    const m = heatmapModel(heatmap(), 'weekday');
    expect(m.rows.map((r) => r.label)).toEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ]);
  });

  it('uses one scale per mode', () => {
    const m = heatmapModel(heatmap(), 'office');
    expect(m.rows[1]!.cells[10]!.level).toBe(4);
    expect(m.rows[0]!.cells[9]!.level).toBeLessThan(4);
    const d = heatmapModel(heatmap(), 'weekday');
    expect(d.rows[4]!.cells[17]!.level).toBe(4);
    expect(d.rows[0]!.cells[9]!.level).toBeLessThan(4);
  });

  it('works with one filtered office and flags empty when all counts are 0', () => {
    const one = heatmapModel({ byOffice: [office('a', 'Office A', { 2: 4 })], byWeekday: weekdays() }, 'office');
    expect(one.rows).toHaveLength(1);
    expect(one.empty).toBe(false);
    const none = heatmapModel({ byOffice: [office('a', 'Office A')], byWeekday: weekdays() }, 'office');
    expect(none.empty).toBe(true);
    expect(none.rows.flatMap((r) => r.cells).every((c) => c.level === 0)).toBe(true);
    expect(heatmapModel({ byOffice: [], byWeekday: weekdays() }, 'office').empty).toBe(true);
  });

  it('keeps names whole', () => {
    const long = 'x'.repeat(300);
    const m = heatmapModel(heatmap([office('a', long, { 1: 1 }), office('b', '<b>x</b>', { 1: 1 })]), 'office');
    expect(m.rows[0]!.label).toBe(long);
    expect(m.rows[1]!.label).toBe('<b>x</b>');
    expect(m.rows[0]!.cells[1]!.label.startsWith(`${long}, 01:00`)).toBe(true);
  });

  it('prints no Infinity, NaN or undefined', () => {
    for (const mode of ['office', 'weekday'] as const) {
      const m = heatmapModel(heatmap(), mode);
      const strings = m.rows.flatMap((r) => [r.label, r.total, ...r.cells.flatMap((c) => [c.text, c.label])]);
      for (const s of strings) expect(s).not.toMatch(/Infinity|NaN|undefined/);
    }
  });
});
