import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Meta } from '../../src/server/api';
import { Header } from '../../src/web/components/Header';
import { UploadPanelView } from '../../src/web/components/UploadPanel';
import { INITIAL_UPLOAD } from '../../src/web/models/uploadModel';
import type { UploadState } from '../../src/web/models/uploadModel';
import { panelToClose } from '../../src/web/models/escapeKey';
import { EmptyScreen } from '../../src/web/App';
import { defaultsHref, parseUrlState, printHref } from '../../src/web/urlState';
import { serverFixture } from '../server/helpers';
import { metaFor } from './fixtures';
import { noExamples, previewOf } from './uploadFixtures';

const noop = () => undefined;
const meta: Meta = metaFor(serverFixture());

function panel(state: UploadState, resetHref = '/'): string {
  return renderToStaticMarkup(<UploadPanelView state={state} resetHref={resetHref} onChoose={noop} onConfirm={noop} onReset={noop} onClose={noop} />);
}

function withExamples() {
  const examples = noExamples();
  examples.new = [{ row: 3, id: 'c_77', note: 'new call' }];
  examples.bad = [{ row: 9, id: 'c_99', note: 'unknown campaign' }];
  return previewOf('calls', { newRows: 40, duplicates: 2, bad: 3 }, { examples, hints: ['Upload the campaigns first.'], badByReason: { unknown_campaign: 3 } });
}

describe('UploadPanel', () => {
  it('choose has a csv file input and one button', () => {
    const html = panel(INITIAL_UPLOAD);
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".csv,text/csv"');
    expect(html.split('<button').length - 1).toBe(1);
  });

  it('preview shows the labelled counts, hints, examples and the confirm button', () => {
    const html = panel({ step: 'preview', fileName: 'f.csv', preview: withExamples() });
    for (const label of ['New calls', 'New versions', 'Already stored', 'Bad rows']) expect(html).toContain(label);
    expect(html).toContain('Upload the campaigns first.');
    expect(html).toContain('row 3: c_77 (new call)');
    expect(html).toContain('unknown campaign: 3');
    expect(html).toContain('Add 40 calls');
  });

  it('has no confirm button, and shows the message, when nothing can be added', () => {
    const html = panel({ step: 'preview', fileName: 'f.csv', preview: previewOf('calls', { duplicates: 4 }) });
    expect(html).not.toContain('Add ');
    expect(html).toContain('Nothing to add: every row is already stored.');
  });

  it('saving shows a busy message and no confirm button', () => {
    const html = panel({ step: 'saving', fileName: 'f.csv', preview: withExamples() });
    expect(html).toContain('Saving...');
    expect(html).not.toContain('Add 40 calls');
  });

  it('done shows the added text and a plain link that keeps view and dev only', () => {
    const state = parseUrlState('?view=campaigns&dev&start=2026-09-01&end=2026-09-07&campaign=c1');
    const href = defaultsHref(state);
    const html = panel({ step: 'done', fileName: 'f.csv', preview: previewOf('calls', { newRows: 40 }), spanEnd: null, warning: null }, href);
    expect(html).toContain('Added 40 new calls.');
    expect(html).toContain('Choose another file');
    const match = /<a [^>]*href="([^"]*)"/.exec(html);
    expect(match).not.toBeNull();
    const linked = match![1]!.replace(/&amp;/g, '&');
    expect(linked).toBe(href);
    expect(parseUrlState(linked.slice(linked.indexOf('?'))).dev).toBe(true);
    expect(parseUrlState(linked.slice(linked.indexOf('?'))).view).toBe('campaigns');
    expect(linked).not.toContain('start');
    expect(linked).not.toContain('campaign=');
  });

  it('disables Close while saving, not otherwise', () => {
    expect(panel({ step: 'saving', fileName: 'f.csv', preview: withExamples() })).toMatch(/<button[^>]*disabled=""[^>]*>Close</);
    expect(panel({ step: 'preview', fileName: 'f.csv', preview: withExamples() })).not.toMatch(/<button[^>]*disabled/);
  });

  it('error shows the message in an alert', () => {
    const html = panel({ step: 'error', fileName: null, message: 'That file is not a CSV.' });
    expect(html).toMatch(/role="alert"[^>]*>[^<]*That file is not a CSV\./);
  });

  it('escapes text from the file', () => {
    const examples = noExamples();
    examples.new = [{ row: 1, id: '<script>alert(1)</script>', note: 'new call' }];
    const p = previewOf('calls', { newRows: 1 }, { examples, hints: ['<b>hint</b>'], badByReason: { '<i>why</i>': 1 } });
    const html = panel({ step: 'preview', fileName: 'a"b<c>.csv', preview: p });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>hint');
    expect(html).not.toContain('<i>why');
    expect(html).not.toContain('<c>');
  });

  it('shortens a very long file name and id', () => {
    const examples = noExamples();
    examples.new = [{ row: 1, id: 'i'.repeat(200), note: 'new call' }];
    const html = panel({ step: 'preview', fileName: `${'n'.repeat(200)}.csv`, preview: previewOf('calls', { newRows: 1 }, { examples }) });
    expect(html).not.toContain('i'.repeat(100));
    expect(html).not.toContain('n'.repeat(100));
  });
});

describe('Header upload button', () => {
  const render = (dev: boolean, uploadOpen = false) =>
    renderToStaticMarkup(
      <Header meta={meta} dev={dev} dataNotesOpen={false} onToggleDataNotes={noop} printLink={printHref(parseUrlState(''))} uploadOpen={uploadOpen} onToggleUpload={noop} />,
    );

  it('shows Upload data in normal mode and in dev mode', () => {
    expect(render(false)).toContain('Upload data');
    expect(render(true)).toContain('Upload data');
  });

  it('marks the button pressed only while the panel is open', () => {
    expect(render(false, false)).toContain('aria-pressed="false"');
    expect(render(false, true)).toContain('aria-pressed="true"');
  });
});

describe('upload panel focus and warning', () => {
  it('the heading can take focus, so a step that removes the focused control moves focus there', () => {
    expect(panel({ step: 'choose' })).toMatch(/<h2 tabindex="-1">/);
  });

  it('done shows the server warning as an alert, and no alert without one', () => {
    const done = { step: 'done' as const, fileName: 'f.csv', preview: previewOf('calls', { newRows: 4 }), spanEnd: null };
    const warning = 'The rows were saved, but AI could not be set up for the new data, so AI is off until the server restarts.';
    const html = panel({ ...done, warning });
    expect(html).toContain('Added 4 new calls.');
    expect(html).toContain(`<p role="alert">${warning}</p>`);
    expect(panel({ ...done, warning: null })).not.toContain('role="alert"');
  });
});

describe('Escape closes one panel', () => {
  const panels = { uploadOpen: true, uploadStep: 'preview', dataNotesOpen: true };
  const escape = (over: Partial<Parameters<typeof panelToClose>[0]> = {}, open: Partial<typeof panels> = {}) =>
    panelToClose({ key: 'Escape', defaultPrevented: false, targetTag: 'BODY', ...over }, { ...panels, ...open });

  it('closes the upload panel first, then the data notes, never both at once', () => {
    expect(escape()).toBe('upload');
    expect(escape({}, { uploadOpen: false })).toBe('data-notes');
    expect(escape({}, { uploadOpen: false, dataNotesOpen: false })).toBeNull();
  });
  it('ignores other keys, handled events, and a select', () => {
    expect(escape({ key: 'a' })).toBeNull();
    expect(escape({ defaultPrevented: true })).toBeNull();
    expect(escape({ targetTag: 'SELECT' })).toBeNull();
  });
  it('never closes the upload panel while saving; the data notes still close', () => {
    expect(escape({}, { uploadStep: 'saving', dataNotesOpen: false })).toBeNull();
    expect(escape({}, { uploadStep: 'saving' })).toBe('data-notes');
  });
});

describe('the empty screen can upload', () => {
  it('shows the upload button when it is given a way to reload', () => {
    expect(renderToStaticMarkup(<EmptyScreen notes={['Upload campaigns first.']} resetHref="/" />)).toContain('Upload data');
  });
  it('shows none inside the ready shell, which has the header button', () => {
    expect(renderToStaticMarkup(<EmptyScreen notes={[]} />)).not.toContain('Upload data');
  });
});
