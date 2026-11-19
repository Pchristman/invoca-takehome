// The dev-mode data notes panel (PLAN.md 3.4) as plain sections. Values come from the API, formatted only.

import { BAD_REASONS } from '../../core/types';
import type { BadReason } from '../../core/types';
import { formatCount, formatUsd } from '../../core/views/format';
import type { DataNotesResponse } from '../../server/api';
import { formatSpendUsd } from '../format';

export interface NotesSection {
  title: string;
  items: { label: string; value: string }[];
  list?: string[];
}

// A Record, so adding a reason to BAD_REASONS is a compile error until it has a label here.
const REASON_LABELS: Record<BadReason, string> = {
  missing_call_id: 'Missing call id',
  bad_timestamp: 'Bad timestamp',
  unknown_location: 'Unknown location',
  invalid_timezone: 'Invalid time zone',
  unknown_campaign: 'Unknown campaign',
  bad_boolean: 'Bad yes/no value',
  bad_outcome: 'Bad outcome',
  inconsistent_outcome: 'Outcome contradicts answered',
  bad_channel: 'Bad channel',
  bad_duration: 'Bad duration',
  bad_revenue: 'Bad revenue',
};

export function badReasonLabel(reason: BadReason): string {
  return REASON_LABELS[reason];
}

const AI_STATUS_TEXT: Record<DataNotesResponse['ai']['status'], string> = {
  off: 'Off (no API key)',
  on: 'On',
  budget_reached: 'Budget reached',
};

export function dataNotesModel(response: DataNotesResponse): NotesSection[] {
  const { dataNotes: n, ai } = response;

  const badReasonItems = n.badRows === 0
    ? []
    : BAD_REASONS.filter((reason) => n.badRowsByReason[reason] > 0).map((reason) => ({
        label: badReasonLabel(reason),
        value: formatCount(n.badRowsByReason[reason]),
      }));

  const sections: NotesSection[] = [
    {
      title: 'Rows and duplicates',
      items: [
        { label: 'Rows read', value: formatCount(n.rowsRead) },
        { label: 'Calls after removing duplicates', value: formatCount(n.callsAfterDedup) },
        { label: 'Duplicate rows collapsed', value: formatCount(n.duplicateRowsCollapsed) },
        { label: 'Calls whose duplicate rows tied on updated_at', value: formatCount(n.tiedCalls) },
      ],
    },
    {
      title: 'Unattributed',
      items: [
        { label: 'Calls with no campaign', value: formatCount(n.unattributedCalls) },
        { label: 'Of those, no tracking number', value: formatCount(n.unattributedWithoutTrackingNumber) },
      ],
      list: n.unattributedTrackingNumbers.map((t) => `${t.trackingNumber} · ${formatCount(t.calls, ['call', 'calls'])}`),
    },
    {
      title: 'Pending',
      items: [{ label: 'Answered calls with no outcome yet', value: formatCount(n.pendingCalls) }],
    },
    {
      title: 'Bad rows',
      items: [
        { label: 'Rows skipped', value: n.badRows === 0 ? 'None' : formatCount(n.badRows) },
        { label: 'Calls dropped as bad', value: formatCount(n.badCalls) },
        ...badReasonItems,
      ],
      list: n.referenceIssues.map((issue) => `${issue.file} row ${issue.rowNumber}: ${issue.reason}`),
    },
    {
      title: 'Revenue',
      items: [
        {
          label: 'Revenue on non-booked calls, ignored',
          value: `${formatCount(n.revenueOnNonBookedCalls, ['call', 'calls'])}, ${formatUsd(n.revenueOnNonBookedUsd)}`,
        },
        { label: 'Booked calls with no revenue', value: formatCount(n.bookedWithoutRevenueCalls) },
      ],
    },
    {
      title: 'Outcome lag',
      items: [
        {
          label: 'Longest wait for an outcome',
          value: n.outcomeLagDays === 0 ? 'No later updates seen' : formatCount(n.outcomeLagDays, ['day', 'days']),
        },
      ],
    },
    {
      title: 'AI',
      items: [
        { label: 'Status', value: AI_STATUS_TEXT[ai.status] },
        { label: 'Spend so far', value: formatSpendUsd(ai.spendUsd) },
        { label: 'Cache hits', value: formatCount(ai.cacheHits) },
        { label: 'Checker failures', value: formatCount(ai.checkerFailures) },
      ],
    },
  ];

  if (n.notes.length > 0) sections.push({ title: 'Load notes', items: [], list: n.notes });
  return sections;
}
