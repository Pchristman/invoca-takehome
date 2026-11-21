// What the upload panel draws, and the steps it goes through. Pure: no React, no File.
// Every count comes from the server's preview; this file only formats it.

import type { RowClass, UploadKind, UploadPreview } from '../../db/upload/types';
import { formatCount } from '../../core/views/format';
import { formatLongDate } from '../format';
import { shorten } from '../../server/api'; // long file names and ids are cut so one cannot stretch the panel

export type UploadState =
  | { step: 'choose' }
  | { step: 'checking'; fileName: string }
  | { step: 'preview'; fileName: string; preview: UploadPreview }
  | { step: 'saving'; fileName: string; preview: UploadPreview }
  | { step: 'done'; fileName: string; preview: UploadPreview; spanEnd: string | null; warning: string | null }
  | { step: 'error'; fileName: string | null; message: string };

export type UploadAction =
  | { type: 'choose'; fileName: string }
  | { type: 'previewed'; preview: UploadPreview }
  | { type: 'confirm' }
  | { type: 'committed'; preview: UploadPreview; spanEnd: string | null; warning: string | null }
  | { type: 'failed'; message: string }
  | { type: 'reset' };

export const INITIAL_UPLOAD: UploadState = { step: 'choose' };

/** The next state. An action that makes no sense in the current step returns the same state, so a double click or a late reply does nothing. */
export function uploadReducer(state: UploadState, action: UploadAction): UploadState {
  switch (action.type) {
    case 'choose':
      // A reply is on its way and the file is being written: do not let a new choice replace it.
      if (state.step === 'saving') return state;
      return { step: 'checking', fileName: action.fileName };
    case 'previewed':
      return state.step === 'checking' ? { step: 'preview', fileName: state.fileName, preview: action.preview } : state;
    case 'confirm':
      return state.step === 'preview' ? { step: 'saving', fileName: state.fileName, preview: state.preview } : state;
    case 'committed':
      return state.step === 'saving' ? { step: 'done', fileName: state.fileName, preview: action.preview, spanEnd: action.spanEnd, warning: action.warning } : state;
    case 'failed':
      return { step: 'error', fileName: state.step === 'choose' ? null : state.fileName, message: action.message };
    case 'reset':
      return INITIAL_UPLOAD;
  }
}

export interface UploadRow {
  label: string;
  count: string;
  examples: string[];
}

export interface UploadView {
  title: string;
  /** Shown while the server is working; null otherwise. */
  busy: string | null;
  /** Shown in an alert; null unless the step is error. */
  error: string | null;
  rows: UploadRow[];
  hints: string[];
  badReasons: string[];
  canConfirm: boolean;
  confirmLabel: string | null;
  emptyMessage: string | null;
  done: string | null;
  /** Rows were saved but something after the write failed (the server's own text); shown in an alert. */
  warning: string | null;
  seeNewDataHref: string;
}

const NOUNS: Record<UploadKind, readonly [string, string]> = {
  calls: ['call', 'calls'],
  campaigns: ['campaign', 'campaigns'],
  locations: ['location', 'locations'],
};

function exampleLine(example: { row: number; id: string; note: string }): string {
  return `row ${formatCount(example.row)}: ${shorten(example.id)} (${example.note})`;
}

function rowFor(preview: UploadPreview, label: string, cls: RowClass, n: number): UploadRow {
  return { label, count: formatCount(n), examples: preview.examples[cls].map(exampleLine) };
}

function rowsFor(preview: UploadPreview): UploadRow[] {
  const { kind, counts } = preview;
  const rows = [rowFor(preview, `New ${NOUNS[kind][1]}`, 'new', counts.newRows)];
  if (kind === 'calls') rows.push(rowFor(preview, 'New versions', 'new_version', counts.newVersions));
  rows.push(rowFor(preview, 'Already stored', 'duplicate', counts.duplicates));
  rows.push(rowFor(preview, 'Conflicts', 'conflict', counts.conflicts));
  rows.push(rowFor(preview, 'Bad rows', 'bad', counts.bad));
  return rows;
}

function badReasonsFor(preview: UploadPreview): string[] {
  return Object.entries(preview.badByReason)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([reason, n]) => `${reason.replace(/_/g, ' ')}: ${formatCount(n)}`);
}

function emptyMessageFor(preview: UploadPreview): string {
  const { rowsRead, duplicates } = preview.counts;
  if (rowsRead === 0) return 'This file has no rows.';
  if (duplicates === rowsRead) return 'Nothing to add: every row is already stored.';
  return 'Nothing to add: no row in this file can be stored.';
}

/** What the commit did, from its own counts. The date is said only when the server sent one. */
function doneText(preview: UploadPreview, spanEnd: string | null): string {
  const { newRows, newVersions } = preview.counts;
  const noun = NOUNS[preview.kind];
  const parts: string[] = [];
  if (newRows > 0) parts.push(formatCount(newRows, [`new ${noun[0]}`, `new ${noun[1]}`]));
  if (newVersions > 0) parts.push(formatCount(newVersions, ['new version of a call already stored', 'new versions of calls already stored']));
  if (parts.length === 0) return 'Nothing was added.';
  const added = `Added ${parts.join(' and ')}.`;
  return spanEnd === null ? added : `${added} The data now runs to ${formatLongDate(spanEnd)}.`;
}

/** What to draw for this state. `seeNewDataHref` is defaultsHref of the current page, passed in. */
export function uploadModel(state: UploadState, seeNewDataHref: string): UploadView {
  const view: UploadView = {
    title: 'Upload data',
    busy: null,
    error: null,
    rows: [],
    hints: [],
    badReasons: [],
    canConfirm: false,
    confirmLabel: null,
    emptyMessage: null,
    done: null,
    warning: null,
    seeNewDataHref,
  };
  if (state.step === 'choose') return view;
  if (state.step === 'checking') return { ...view, busy: `Checking ${shorten(state.fileName)}...` };
  if (state.step === 'error') return { ...view, error: state.message };

  const { preview } = state;
  const addable = preview.counts.newRows + preview.counts.newVersions;
  const noun = NOUNS[preview.kind];
  const shown: UploadView = {
    ...view,
    title: `${shorten(state.fileName)}`,
    rows: rowsFor(preview),
    hints: preview.hints,
    badReasons: badReasonsFor(preview),
  };
  if (state.step === 'done') return { ...shown, done: doneText(preview, state.spanEnd), warning: state.warning };
  if (state.step === 'saving') return { ...shown, busy: 'Saving...' };
  if (addable === 0) return { ...shown, emptyMessage: emptyMessageFor(preview) };
  return { ...shown, canConfirm: true, confirmLabel: `Add ${formatCount(addable, noun)}` };
}
