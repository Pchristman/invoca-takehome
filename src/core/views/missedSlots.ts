import type { CleanCall } from '../types';

export interface MissedSlot {
  locationId: string;
  weekday: number;
  hour: number;
  calls: number;
}

/**
 * The office, local weekday and local hour with the most unanswered calls among the calls given.
 * Null when none is unanswered, or when two or more slots tie for the most: no slot is named then.
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

  const ranked = [...slots.values()].sort((a, b) => b.calls - a.calls);
  const [top, next] = ranked;
  return top && (!next || next.calls < top.calls) ? top : null;
}
