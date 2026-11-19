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
  let bookedWithoutRevenueCalls = 0;
  let unattributedWithoutTrackingNumber = 0;
  let callsWithoutCallerHash = 0;
  let revenueOnNonBookedCents = 0;

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
    if (call.callerHash === '') callsWithoutCallerHash += 1;
    if (unattributed && call.trackingNumber === '') unattributedWithoutTrackingNumber += 1;
    else if (unattributed) trackingCounts.set(call.trackingNumber, (trackingCounts.get(call.trackingNumber) ?? 0) + 1);
    if (booked && call.revenueUsd === null) bookedWithoutRevenueCalls += 1;
    // An explicit 0 on a non-booked call is not an anomaly.
    if (!booked && call.revenueUsd !== null && call.revenueUsd > 0) {
      revenueOnNonBookedCalls += 1;
      revenueOnNonBookedCents += Math.round(call.revenueUsd * 100); // whole cents: no float drift
    }

    // Phase 1 guarantees a good row's location exists and has a valid zone; Intl would silently use the host zone otherwise.
    const zone = zoneByLocation.get(call.locationId);
    if (zone === undefined) throw new Error(`call ${call.callId}: location "${call.locationId}" is not in the loaded locations`);
    const local = localParts(call.startedAt, zone);
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
    .sort((a, b) => b.calls - a.calls || (a.trackingNumber < b.trackingNumber ? -1 : a.trackingNumber > b.trackingNumber ? 1 : 0));

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
      unattributedWithoutTrackingNumber,
      callsWithoutCallerHash,
      unattributedTrackingNumbers,
      pendingCalls,
      badCallsByReason,
      badCalls,
      badRowsByReason: loaded.badByReason,
      badRows: BAD_REASONS.reduce((sum, reason) => sum + loaded.badByReason[reason], 0),
      referenceIssues: loaded.referenceIssues,
      revenueOnNonBookedCalls,
      revenueOnNonBookedUsd: revenueOnNonBookedCents / 100,
      bookedWithoutRevenueCalls,
      outcomeLagDays: measureOutcomeLagDays(dedupe.groups, dedupe.winners),
      unparseableUpdatedAt: loaded.unparseableUpdatedAt,
      unparseableEndedAt: loaded.unparseableEndedAt,
      notes: loaded.notes,
    },
  };
}
