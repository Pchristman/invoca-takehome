import { describe, expect, it } from 'vitest';
import { BAD_REASONS } from '../../src/core/types';
import type { BadReason, DataNotes } from '../../src/core/types';
import type { AiStatus, DataNotesResponse } from '../../src/server/api';
import { badReasonLabel, dataNotesModel } from '../../src/web/models/dataNotesModel';
import { serverFixture } from '../server/helpers';

const AI_OFF: AiStatus = { status: 'off', spendUsd: 0, cacheHits: 0, checkerFailures: 0 };

function zeroReasons(): Record<BadReason, number> {
  return Object.fromEntries(BAD_REASONS.map((r) => [r, 0])) as Record<BadReason, number>;
}

function notesWith(overrides: Partial<DataNotes> = {}): DataNotes {
  return {
    rowsRead: 5411,
    callsAfterDedup: 5000,
    duplicateRowsCollapsed: 411,
    tiedCalls: 3,
    unattributedCalls: 144,
    unattributedWithoutTrackingNumber: 2,
    callsWithoutCallerHash: 0,
    unattributedTrackingNumbers: Array.from({ length: 10 }, (_, i) => ({ trackingNumber: `+1555000${i}`, calls: 10 + i })),
    pendingCalls: 41,
    badCallsByReason: zeroReasons(),
    badCalls: 0,
    badRowsByReason: zeroReasons(),
    badRows: 0,
    referenceIssues: [],
    revenueOnNonBookedCalls: 2,
    revenueOnNonBookedUsd: 530,
    bookedWithoutRevenueCalls: 1,
    outcomeLagDays: 3,
    unparseableUpdatedAt: 0,
    unparseableEndedAt: 0,
    notes: [],
    ...overrides,
  };
}

function respond(dataNotes: DataNotes, ai: Partial<AiStatus> = {}): DataNotesResponse {
  return { dataNotes, ai: { ...AI_OFF, ...ai } };
}

function valueOf(response: DataNotesResponse, section: string, label: string): string | undefined {
  return dataNotesModel(response)
    .find((s) => s.title === section)
    ?.items.find((i) => i.label === label)?.value;
}

const SEVEN_TITLES = ['Rows and duplicates', 'Unattributed', 'Pending', 'Bad rows', 'Revenue', 'Outcome lag', 'AI'];

describe('dataNotesModel sections', () => {
  it('lists the sections in order, with Load notes only when notes exist', () => {
    const without = dataNotesModel(respond(notesWith()));
    expect(without.map((s) => s.title)).toEqual(SEVEN_TITLES);
    const withNotes = dataNotesModel(respond(notesWith({ notes: ['calls.csv is empty: starting with zero calls'] })));
    expect(withNotes.map((s) => s.title)).toEqual([...SEVEN_TITLES, 'Load notes']);
    expect(withNotes[withNotes.length - 1]?.list).toEqual(['calls.csv is empty: starting with zero calls']);
  });

it('follows the Load notes rule on the real fixture too', () => {    const real = serverFixture().dataNotes;    const titles = dataNotesModel(respond(real)).map((s) => s.title);    expect(titles.includes('Load notes')).toBe(real.notes.length > 0);  });
  it('every value is a non-empty string with no undefined, NaN or [object', () => {
    for (const section of dataNotesModel(respond(serverFixture().dataNotes))) {
      for (const item of section.items) {
        expect(item.value.length).toBeGreaterThan(0);
        expect(item.value).not.toMatch(/undefined|NaN|\[object/);
      }
    }
  });
});

describe('dataNotesModel values', () => {
  const response = respond(notesWith());

  it('prints the counts and dollars', () => {
    expect(valueOf(response, 'Rows and duplicates', 'Rows read')).toBe('5,411');
    expect(valueOf(response, 'Rows and duplicates', 'Calls after removing duplicates')).toBe('5,000');
    expect(valueOf(response, 'Rows and duplicates', 'Duplicate rows collapsed')).toBe('411');
    expect(valueOf(response, 'Rows and duplicates', 'Calls whose duplicate rows tied on updated_at')).toBe('3');
    expect(valueOf(response, 'Unattributed', 'Calls with no campaign')).toBe('144');
    expect(valueOf(response, 'Pending', 'Answered calls with no outcome yet')).toBe('41');
    expect(valueOf(response, 'Revenue', 'Revenue on non-booked calls, ignored')).toBe('2 calls, $530');
    expect(valueOf(response, 'Revenue', 'Booked calls with no revenue')).toBe('1');
    expect(valueOf(response, 'Outcome lag', 'Longest wait for an outcome')).toBe('3 days');
  });

  it('lists every tracking number with its calls', () => {
    const unattributed = dataNotesModel(response).find((s) => s.title === 'Unattributed');
    expect(unattributed?.list).toHaveLength(10);
    expect(unattributed?.list?.[0]).toBe('+15550000 · 10 calls');
  });
});

describe('dataNotesModel bad rows', () => {
  it('shows None and no per-reason items when there are none', () => {
    const section = dataNotesModel(respond(notesWith())).find((s) => s.title === 'Bad rows');
    expect(section?.items.find((i) => i.label === 'Rows skipped')?.value).toBe('None');
    expect(section?.items.map((i) => i.label)).toEqual(['Rows skipped', 'Calls dropped as bad']);
  });

  it('shows only reasons above 0, labelled, with the total, and reference issues', () => {
    const byReason = { ...zeroReasons(), bad_timestamp: 3, unknown_campaign: 1 };
    const section = dataNotesModel(
      respond(
        notesWith({
          badRows: 4,
          badCalls: 4,
          badRowsByReason: byReason,
          referenceIssues: [{ file: 'campaigns.csv', rowNumber: 7, reason: 'duplicate id', detail: 'x' }],
        }),
      ),
    ).find((s) => s.title === 'Bad rows');
    expect(section?.items.find((i) => i.label === 'Rows skipped')?.value).toBe('4');
    expect(section?.items.find((i) => i.label === badReasonLabel('bad_timestamp'))?.value).toBe('3');
    expect(section?.items.find((i) => i.label === badReasonLabel('unknown_campaign'))?.value).toBe('1');
    expect(section?.items).toHaveLength(4);
    expect(section?.list).toEqual(['campaigns.csv row 7: duplicate id']);
  });

  it('badReasonLabel is readable for every reason', () => {
    for (const reason of BAD_REASONS) {
      const label = badReasonLabel(reason);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain('_');
    }
  });
});

describe('dataNotesModel outcome lag and AI', () => {
  it('reads 0 days as no later updates and 1 as 1 day', () => {
    expect(valueOf(respond(notesWith({ outcomeLagDays: 0 })), 'Outcome lag', 'Longest wait for an outcome')).toBe('No later updates seen');
    expect(valueOf(respond(notesWith({ outcomeLagDays: 1 })), 'Outcome lag', 'Longest wait for an outcome')).toBe('1 day');
  });

  it('names the AI status and prints spend to four decimals', () => {
    const notes = notesWith();
    expect(valueOf(respond(notes, { status: 'off' }), 'AI', 'Status')).toBe('Off (no API key)');
    expect(valueOf(respond(notes, { status: 'on' }), 'AI', 'Status')).toBe('On');
    expect(valueOf(respond(notes, { status: 'budget_reached' }), 'AI', 'Status')).toBe('Budget reached');
    expect(valueOf(respond(notes, { spendUsd: 0.0012 }), 'AI', 'Spend so far')).toBe('$0.0012');
  });
});
