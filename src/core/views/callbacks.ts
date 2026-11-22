import { localDateTime } from '../localTime';
import { callsInRange, toCents } from '../metrics';
import { estimateMissedCallValue } from '../missedValue';
import type { MissedValueRates } from '../missedValue';
import type { ResolvedRange } from '../ranges';
import { compareText, UNATTRIBUTED_NAME } from '../text';
import type { CallStore, CleanCall } from '../types';

export interface CallbackRow {
  callerHash: string;
  /** Unanswered calls in range (and at the filtered office, if any). */
  unansweredAttempts: number;
  lastAttemptAt: Date;
  /** The last attempt in the office's time zone, "YYYY-MM-DD HH:mm". */
  lastAttemptLocal: string;
  locationId: string;
  officeName: string;
  campaignId: string | null;
  /** 'Unattributed' when campaignId is null. */
  campaignName: string;
  trackingNumber: string;
  /** The latest missed call's value only. */
  estimatedValueUsd: number;
}

export interface CallbackList {
  /** Value descending, ties by caller hash. */
  rows: CallbackRow[];
  /** Unanswered calls with no caller hash: they can't be called back. */
  unidentifiedUnanswered: number;
}

/** True when `a` started after `b` (ties broken by call id). */
function isLater(a: CleanCall, b: CleanCall): boolean {
  const diff = a.startedAt.getTime() - b.startedAt.getTime();
  return diff !== 0 ? diff > 0 : a.callId > b.callId;
}

/**
 * Callers with an unanswered call in range and no answered call after their last one. The "got through"
 * check looks at every office and to the end of the export, not just the range or the office filter.
 */
export function buildCallbackList(
  store: CallStore,
  range: ResolvedRange,
  rates: MissedValueRates,
  options: { locationId?: string } = {},
): CallbackList {
  const missed = callsInRange(store.calls, range).filter(
    (call) => !call.answered && (options.locationId === undefined || call.locationId === options.locationId),
  );

  const byCaller = new Map<string, CleanCall[]>();
  let unidentifiedUnanswered = 0;
  for (const call of missed) {
    if (call.callerHash === '') {
      unidentifiedUnanswered += 1; // never merged with other blank hashes
      continue;
    }
    const group = byCaller.get(call.callerHash);
    if (group) group.push(call);
    else byCaller.set(call.callerHash, [call]);
  }

  // Latest answered call per caller, over the whole export.
  const latestAnswered = new Map<string, CleanCall>();
  for (const call of store.calls) {
    if (!call.answered || call.callerHash === '') continue;
    const seen = latestAnswered.get(call.callerHash);
    if (!seen || isLater(call, seen)) latestAnswered.set(call.callerHash, call);
  }

  const rows: CallbackRow[] = [];
  for (const [callerHash, group] of byCaller) {
    const last = group.reduce((a, b) => (isLater(b, a) ? b : a));
    const answeredAfter = latestAnswered.get(callerHash);
    // Strictly later by time: an answer at the same instant does not count.
    if (answeredAfter && answeredAfter.startedAt.getTime() > last.startedAt.getTime()) continue;

    const location = store.locations.find((l) => l.id === last.locationId);
    // Cleaning drops calls whose office or campaign is not in the store, so both lookups succeed.
    if (!location) throw new Error(`Call ${last.callId} is at unknown office ${last.locationId}`);
    let campaignName = UNATTRIBUTED_NAME;
    if (last.campaignId !== null) {
      const campaign = store.campaigns.find((c) => c.id === last.campaignId);
      if (!campaign) throw new Error(`Call ${last.callId} is in unknown campaign ${last.campaignId}`);
      campaignName = campaign.name;
    }
    const cents = toCents(estimateMissedCallValue(rates, last).valueUsd);
    rows.push({
      callerHash,
      unansweredAttempts: group.length,
      lastAttemptAt: last.startedAt,
      lastAttemptLocal: localDateTime(last.startedAt, location.timezone),
      locationId: last.locationId,
      officeName: location.name,
      campaignId: last.campaignId,
      campaignName,
      trackingNumber: last.trackingNumber,
      estimatedValueUsd: cents / 100,
    });
  }

  rows.sort((a, b) => b.estimatedValueUsd - a.estimatedValueUsd || compareText(a.callerHash, b.callerHash));
  return { rows, unidentifiedUnanswered };
}
