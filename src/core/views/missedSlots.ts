import type { CleanCall } from '../types';

export interface MissedSlot {
  locationId: string;
  weekday: number;
  hour: number;
  calls: number;
}

/**
 * The office, local weekday and local hour with the most unanswered calls among the calls given.
 * Ties go to the lower location id (plain character order), then weekday, then hour. Null when none is unanswered.
 */
export function busiestMissedSlot(calls: readonly CleanCall[]): MissedSlot | null {
  const slots = new Map<string, MissedSlot>();
  for (const call of calls) {
    if (call.answered) continue;
    const key = `${call.locationId}|${call.localWeekday}|${call.localHour}`;
    const slot = slots.get(key);
    if (slot) slot.calls += 1;
    else slots.set(key, { locationId: call.locationId, weekday: call.localWeekday, hour: call.localHour, calls: 1 });
  }

  let best: MissedSlot | null = null;
  for (const slot of slots.values()) {
    if (best === null || beats(slot, best)) best = slot;
  }
  return best;
}

function beats(a: MissedSlot, b: MissedSlot): boolean {
  if (a.calls !== b.calls) return a.calls > b.calls;
  if (a.locationId !== b.locationId) return a.locationId < b.locationId;
  if (a.weekday !== b.weekday) return a.weekday < b.weekday;
  return a.hour < b.hour;
}
