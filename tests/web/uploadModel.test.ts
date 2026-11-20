import { describe, expect, it } from 'vitest';
import type { RowClass, UploadKind, UploadPreview } from '../../src/db/upload/types';
import { INITIAL_UPLOAD, uploadModel, uploadReducer } from '../../src/web/models/uploadModel';
import type { UploadState } from '../../src/web/models/uploadModel';

import { noExamples as NO_EXAMPLES, previewOf } from './uploadFixtures';

const preview = (p: UploadPreview, fileName = 'f.csv'): UploadState => ({ step: 'preview', fileName, preview: p });
const labels = (state: UploadState) => uploadModel(state, '/').rows.map((r) => r.label);

describe('uploadModel rows', () => {
  it('has a fixed order per kind', () => {
    expect(labels(preview(previewOf('calls')))).toEqual(['New calls', 'New versions', 'Already stored', 'Bad rows']);
    expect(labels(preview(previewOf('campaigns')))).toEqual(['New campaigns', 'Already stored', 'Conflicts', 'Bad rows']);
    expect(labels(preview(previewOf('locations')))).toEqual(['New locations', 'Already stored', 'Conflicts', 'Bad rows']);
  });

  it('formats counts with thousands separators', () => {
    const view = uploadModel(preview(previewOf('calls', { newRows: 5411, duplicates: 12 })), '/');
    expect(view.rows[0]).toMatchObject({ label: 'New calls', count: '5,411' });
    expect(view.rows[2]).toMatchObject({ label: 'Already stored', count: '12' });
  });

  it('passes hints through and sorts bad reasons by count then name', () => {
    const p = previewOf('calls', { newRows: 1, bad: 15 }, { hints: ['one hint', 'two hint'], badByReason: { 'unknown office': 3, 'bad timestamp': 3, 'unknown campaign': 12 } });
    const view = uploadModel(preview(p), '/');
    expect(view.hints).toEqual(['one hint', 'two hint']);
    expect(view.badReasons).toEqual(['unknown campaign: 12', 'bad timestamp: 3', 'unknown office: 3']);
  });

  it('writes example lines and shortens long ids', () => {
    const examples = NO_EXAMPLES();
    const cls: RowClass = 'new';
    examples[cls] = [
      { row: 3, id: 'c_77', note: 'new call' },
      { row: 1200, id: 'x'.repeat(100), note: 'new call' },
    ];
    const view = uploadModel(preview(previewOf('calls', { newRows: 2 }, { examples })), '/');
    expect(view.rows[0]!.examples[0]).toBe('row 3: c_77 (new call)');
    const long = view.rows[0]!.examples[1]!;
    expect(long).toContain('row 1,200: ');
    expect(long).not.toContain('x'.repeat(100));
    expect(long).toContain('…');
  });
});

describe('uploadModel confirm', () => {
  it('canConfirm is false for all duplicates, header only and all bad', () => {
    for (const p of [previewOf('calls', { duplicates: 4 }), previewOf('calls', { rowsRead: 0 }), previewOf('calls', { bad: 4 })]) {
      const view = uploadModel(preview(p), '/');
      expect(view.canConfirm).toBe(false);
      expect(view.confirmLabel).toBeNull();
    }
  });

  it('canConfirm is true for one new row, and for a new version alone', () => {
    expect(uploadModel(preview(previewOf('calls', { newRows: 1 })), '/').canConfirm).toBe(true);
    expect(uploadModel(preview(previewOf('calls', { newVersions: 1 })), '/').canConfirm).toBe(true);
  });

  it('has the three empty messages', () => {
    expect(uploadModel(preview(previewOf('calls', { duplicates: 4 })), '/').emptyMessage).toBe('Nothing to add: every row is already stored.');
    expect(uploadModel(preview(previewOf('calls', { bad: 4 })), '/').emptyMessage).toBe('Nothing to add: no row in this file can be stored.');
    expect(uploadModel(preview(previewOf('campaigns', { conflicts: 2 })), '/').emptyMessage).toBe('Nothing to add: no row in this file can be stored.');
    expect(uploadModel(preview(previewOf('calls', { rowsRead: 0 })), '/').emptyMessage).toBe('This file has no rows.');
    expect(uploadModel(preview(previewOf('calls', { newRows: 1 })), '/').emptyMessage).toBeNull();
  });

  it('labels the button singular and plural', () => {
    const label = (kind: UploadKind, n: number) => uploadModel(preview(previewOf(kind, { newRows: n })), '/').confirmLabel;
    expect(label('calls', 1)).toBe('Add 1 call');
    expect(label('calls', 2)).toBe('Add 2 calls');
    expect(label('calls', 40)).toBe('Add 40 calls');
    expect(label('campaigns', 1)).toBe('Add 1 campaign');
    expect(label('campaigns', 3)).toBe('Add 3 campaigns');
    expect(label('locations', 1)).toBe('Add 1 location');
    expect(label('locations', 2)).toBe('Add 2 locations');
  });

  it('says what was added once done, and links to the default view', () => {
    const p = previewOf('calls', { newRows: 40 });
    const done = (written: number, kind: UploadKind = 'calls'): UploadState => ({ step: 'done', fileName: 'f.csv', preview: previewOf(kind, { newRows: written }), written });
    expect(uploadModel({ step: 'done', fileName: 'f.csv', preview: p, written: 40 }, '/?dev').done).toBe('Added 40 new calls to the database.');
    expect(uploadModel(done(1), '/').done).toBe('Added 1 new call to the database.');
    expect(uploadModel(done(3, 'campaigns'), '/').done).toBe('Added 3 new campaigns to the database.');
    expect(uploadModel(done(1), '/campaigns?dev').seeNewDataHref).toBe('/campaigns?dev');
  });

  it('has no confirm while checking or saving', () => {
    expect(uploadModel({ step: 'checking', fileName: 'f.csv' }, '/').busy).not.toBeNull();
    const saving = uploadModel({ step: 'saving', fileName: 'f.csv', preview: previewOf('calls', { newRows: 2 }) }, '/');
    expect(saving.busy).not.toBeNull();
    expect(saving.canConfirm).toBe(false);
    expect(saving.confirmLabel).toBeNull();
  });
});

describe('uploadReducer', () => {
  const p = previewOf('calls', { newRows: 2 });

  it('goes choose, checking, preview, saving, done', () => {
    let s = uploadReducer(INITIAL_UPLOAD, { type: 'choose', fileName: 'a.csv' });
    expect(s).toEqual({ step: 'checking', fileName: 'a.csv' });
    s = uploadReducer(s, { type: 'previewed', preview: p });
    expect(s).toEqual({ step: 'preview', fileName: 'a.csv', preview: p });
    s = uploadReducer(s, { type: 'confirm' });
    expect(s).toEqual({ step: 'saving', fileName: 'a.csv', preview: p });
    s = uploadReducer(s, { type: 'committed', written: 2 });
    expect(s).toEqual({ step: 'done', fileName: 'a.csv', preview: p, written: 2 });
  });

  it('goes to error from every step, and reset goes back to choose', () => {
    const steps: UploadState[] = [
      { step: 'choose' },
      { step: 'checking', fileName: 'a.csv' },
      { step: 'preview', fileName: 'a.csv', preview: p },
      { step: 'saving', fileName: 'a.csv', preview: p },
      { step: 'done', fileName: 'a.csv', preview: p, written: 2 },
    ];
    for (const step of steps) {
      const s = uploadReducer(step, { type: 'failed', message: 'Nope.' });
      expect(s).toMatchObject({ step: 'error', message: 'Nope.' });
      expect(uploadReducer(s, { type: 'reset' })).toEqual({ step: 'choose' });
    }
    expect(uploadReducer({ step: 'choose' }, { type: 'failed', message: 'x' })).toMatchObject({ fileName: null });
  });

  it('choosing a new file while previewing discards the old preview', () => {
    const s = uploadReducer({ step: 'preview', fileName: 'a.csv', preview: p }, { type: 'choose', fileName: 'b.csv' });
    expect(s).toEqual({ step: 'checking', fileName: 'b.csv' });
  });

  it('ignores a second confirm while saving, and a choose while saving', () => {
    const saving: UploadState = { step: 'saving', fileName: 'a.csv', preview: p };
    expect(uploadReducer(saving, { type: 'confirm' })).toBe(saving);
    expect(uploadReducer(saving, { type: 'choose', fileName: 'b.csv' })).toBe(saving);
  });

  it('ignores a late reply after a reset', () => {
    expect(uploadReducer(INITIAL_UPLOAD, { type: 'previewed', preview: p })).toBe(INITIAL_UPLOAD);
    expect(uploadReducer(INITIAL_UPLOAD, { type: 'committed', written: 2 })).toBe(INITIAL_UPLOAD);
    expect(uploadReducer(INITIAL_UPLOAD, { type: 'confirm' })).toBe(INITIAL_UPLOAD);
  });
});
