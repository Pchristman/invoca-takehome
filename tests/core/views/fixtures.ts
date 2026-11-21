import { expect } from 'vitest';
import { cleanExport } from '../../../src/core/clean';
import { inclusiveDays } from '../../../src/core/localDate';
import type { ResolvedRange } from '../../../src/core/ranges';
import type { CallStore, Campaign, Channel, CleanCall, DataNotes, Location } from '../../../src/core/types';
import { loadFixture, makeCall } from '../helpers';

export const campaign = (id: string, name: string, channel: Channel, dailyBudgetUsd: number | null): Campaign => ({
  id,
  name,
  channel,
  dailyBudgetUsd,
});

export const office = (id: string, name: string, timezone = 'America/Denver'): Location => ({
  id,
  name,
  timezone,
  timezoneValid: true,
});

export function makeStore(
  calls: CleanCall[],
  opts: { campaigns?: Campaign[]; locations?: Location[]; dataNotes?: Partial<DataNotes> } = {},
): CallStore {
  const baseNotes = cleanExport(loadFixture([])).dataNotes;
  return {
    calls,
    campaigns: opts.campaigns ?? [],
    locations: opts.locations ?? [],
    dataNotes: { ...baseNotes, ...opts.dataNotes },
  };
}

export const range = (start: string, end: string): ResolvedRange => ({
  start,
  end,
  days: inclusiveDays(start, end),
  clamped: false,
});

/** n calls, each its own caller (makeCall gives each a fresh caller hash). */
export const many = (n: number, over: Partial<CleanCall> = {}): CleanCall[] =>
  Array.from({ length: n }, () => makeCall(over));

/** A call that started at the given instant; localDate is the ISO date unless overridden. */
export const callAt = (startedAtIso: string, over: Partial<CleanCall> = {}): CleanCall =>
  makeCall({ startedAt: new Date(startedAtIso), localDate: startedAtIso.slice(0, 10), ...over });

/** booked <= answered <= calls. Booked first, then answered-not-booked, then missed at the slot. */
export function officeCalls(
  locationId: string,
  shape: { calls: number; answered: number; booked: number; missedSlot?: { weekday: number; hour: number } },
  over: Partial<CleanCall> = {},
): CleanCall[] {
  const slot = shape.missedSlot ?? { weekday: 3, hour: 10 };
  const result: CleanCall[] = [];
  for (let i = 0; i < shape.calls; i++) {
    if (i < shape.booked) {
      result.push(makeCall({ locationId, answered: true, outcome: 'booked', booked: true, revenueUsd: 100, ...over }));
    } else if (i < shape.answered) {
      result.push(
        makeCall({ locationId, answered: true, outcome: 'not_qualified', booked: false, revenueUsd: 0, ...over }),
      );
    } else {
      result.push(
        makeCall({
          locationId,
          answered: false,
          outcome: 'missed',
          booked: false,
          revenueUsd: 0,
          localWeekday: slot.weekday,
          localHour: slot.hour,
          ...over,
        }),
      );
    }
  }
  return result;
}

/** Answered calls with an outcome, dated well before every test range; booked ones at $100. */
export function basisCalls(
  campaignId: string,
  channel: Channel,
  shape: { answered: number; booked: number },
): CleanCall[] {
  const base = { campaignId, channel, localDate: '2026-08-01', answered: true };
  return Array.from({ length: shape.answered }, (_, i) =>
    i < shape.booked
      ? makeCall({ ...base, outcome: 'booked', booked: true, revenueUsd: 100 })
      : makeCall({ ...base, outcome: 'not_qualified', booked: false, revenueUsd: 0 }),
  );
}

/** Fails on any NaN or Infinity found in numbers, arrays or objects. */
export function expectAllFinite(value: unknown, path = 'value'): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${path} is ${value}`).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => expectAllFinite(item, `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, item] of Object.entries(value)) expectAllFinite(item, `${path}.${key}`);
  }
}
