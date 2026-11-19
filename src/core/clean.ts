import { dedupeRows } from './dedupe';
import { localParts } from './localTime';
import { measureOutcomeLagDays } from './outcomeLag';
import { BAD_REASONS, type BadReason, type CallStore, type CleanCall, type LoadedExport } from './types';

/** Turn a loaded export into one localized call per call_id, plus the data notes. */
export function cleanExport(loaded: LoadedExport): CallStore {
  const dedupe = dedupeRows(loaded.rows);
  const zoneByLocation = new Map(loaded.locations.map((l) => [l.id, l.timezone]));

  const badCallsByReason = Object.fromEntries(BAD_REASONS.map((reason) => [reason, 0])) as Record<BadReason, number>;
  const calls: CleanCall[] = [];
  const trackingCounts = new Map<string, number>();
  let badCalls = 0;
  let pendingCalls = 0;
  let revenueOnNonBookedCalls = 0;
  let revenueOnNonBookedUsd = 0;
  let bookedWithoutRevenueCalls = 0;

  for (const winner of dedupe.winners) {
    if (!winner.ok) {
      badCallsByReason[winner.bad.reason] += 1;
      badCalls += 1;
      continue;
    }
    const call = winner.call;
    const booked = call.outcome === 'booked';
    const pending = call.answered && call.outcome === null;
    const unattributed = call.campaignId === null;

    if (pending) pendingCalls += 1;
    if (unattributed) trackingCounts.set(call.trackingNumber, (trackingCounts.get(call.trackingNumber) ?? 0) + 1);
    if (booked && call.revenueUsd === null) bookedWithoutRevenueCalls += 1;
    if (!booked && call.revenueUsd !== null) {
      revenueOnNonBookedCalls += 1;
      revenueOnNonBookedUsd += call.revenueUsd;
    }

    // Phase 1 guarantees a good row's location exists and has a valid zone.
    const local = localParts(call.startedAt, zoneByLocation.get(call.locationId)!);
    calls.push({
      callId: call.callId,
      startedAt: call.startedAt,
      durationSeconds: call.durationSeconds,
      callerHash: call.callerHash,
      trackingNumber: call.trackingNumber,
      campaignId: call.campaignId,
      unattributed,
      channel: call.channel,
      locationId: call.locationId,
      answered: call.answered,
      outcome: call.outcome,
      booked,
      pending,
      revenueUsd: booked ? (call.revenueUsd ?? 0) : 0,
      agentId: call.agentId,
      localDate: local.date,
      localHour: local.hour,
      localWeekday: local.weekday,
    });
  }

  const unattributedTrackingNumbers = [...trackingCounts]
    .map(([trackingNumber, count]) => ({ trackingNumber, calls: count }))
    .sort((a, b) => b.calls - a.calls || a.trackingNumber.localeCompare(b.trackingNumber));

  return {
    calls,
    campaigns: loaded.campaigns,
    locations: loaded.locations,
    dataNotes: {
      rowsRead: dedupe.rowsRead,
      callsAfterDedup: dedupe.winners.length,
      duplicateRowsCollapsed: dedupe.duplicateRowsCollapsed,
      tiedCalls: dedupe.tiedCalls,
      unattributedCalls: calls.filter((c) => c.unattributed).length,
      unattributedTrackingNumbers,
      pendingCalls,
      badCallsByReason,
      badCalls,
      revenueOnNonBookedCalls,
      revenueOnNonBookedUsd,
      bookedWithoutRevenueCalls,
      outcomeLagDays: measureOutcomeLagDays(dedupe.groups, dedupe.winners),
      unparseableUpdatedAt: loaded.unparseableUpdatedAt,
      notes: loaded.notes,
    },
  };
}
