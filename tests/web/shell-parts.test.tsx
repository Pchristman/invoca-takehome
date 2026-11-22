// The app shell and shared parts: the upload lock, the empty screen's live region, the content error boundary,
// the shared table parts, the shared question limit.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Meta } from '../../src/server/api';
import { QUESTION_MAX_CHARS } from '../../src/server/questionQuery';
import { EmptyScreen } from '../../src/web/App';
import { ASK_MAX_CHARS } from '../../src/web/components/AskBox';
import { ContentErrorFallback, ErrorBoundary, ErrorFallback } from '../../src/web/components/ErrorBoundary';
import { Header, UPLOAD_BUTTON_ID } from '../../src/web/components/Header';
import { CellText, SortHeader } from '../../src/web/components/TableParts';
import { uploadLocked } from '../../src/web/models/escapeKey';
import { printEstimateNotes, estimateFormulas } from '../../src/web/models/estimates';

const noop = () => undefined;
const meta: Meta = {
  hasData: true,
  callCount: 10,
  span: { start: '2026-09-01', end: '2026-10-29' },
  campaigns: [],
  locations: [],
  presets: ['last7', 'last28', 'all'],
  defaultPreset: 'last28',
  skippedRows: 0,
  notes: [],
  aiStatus: 'off',
};

/** The opening tag of the element with this id. */
function tagWithId(html: string, id: string): string {
  return new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? '';
}

describe('upload lock', () => {
  it('is on only while a file is being written', () => {
    expect(uploadLocked('saving')).toBe(true);
    for (const step of ['choose', 'checking', 'preview', 'done', 'error']) expect(uploadLocked(step)).toBe(false);
  });

  it('the header toggle is disabled while locked, like the panel Close button', () => {
    const header = (uploadLocked: boolean) =>
      renderToStaticMarkup(
        <Header meta={meta} printLink="/?print" uploadOpen uploadLocked={uploadLocked} onToggleUpload={noop} />,
      );
    expect(tagWithId(header(true), UPLOAD_BUTTON_ID)).toContain('disabled');
    expect(tagWithId(header(false), UPLOAD_BUTTON_ID)).not.toContain('disabled');
  });
});

describe('empty screen live region', () => {
  it('announces only the message, not the upload control or panel', () => {
    const html = renderToStaticMarkup(<EmptyScreen notes={['A note.']} resetHref="/" />);
    const live = /<div role="status">(.*?)<\/div>/.exec(html)?.[1] ?? '';
    expect(live).toContain('This export has no calls');
    expect(live).toContain('A note.');
    expect(live).not.toContain('Upload data');
    expect(html).not.toMatch(/<section[^>]*role="status"/);
  });
});

describe('content error boundary', () => {
  it('offers Reset to defaults, not only a reload', () => {
    const html = renderToStaticMarkup(<ContentErrorFallback resetHref="/?view=campaigns" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('href="/?view=campaigns"');
    expect(html).toContain('Reset to defaults');
  });

  it('shows its fallback once a child has thrown, and the plain one when it has none', () => {
    const fallback = <ContentErrorFallback resetHref="/" />;
    const boundary = new ErrorBoundary({ children: 'content', fallback });
    expect(boundary.render()).toBe('content');
    boundary.state = ErrorBoundary.getDerivedStateFromError();
    expect(boundary.render()).toBe(fallback);
    const root = new ErrorBoundary({ children: 'content' });
    root.state = ErrorBoundary.getDerivedStateFromError();
    expect(renderToStaticMarkup(<>{root.render()}</>)).toBe(renderToStaticMarkup(<ErrorFallback />));
  });
});

describe('shared table parts', () => {
  it('SortHeader marks the sorted column and only that one', () => {
    const sort = { key: 'calls', dir: 'asc' } as const;
    const head = (key: 'calls' | 'name') =>
      renderToStaticMarkup(
        <table>
          <thead>
            <tr>
              <SortHeader columnKey={key} numeric={key === 'calls'} sort={sort} onSort={noop}>
                {key}
              </SortHeader>
            </tr>
          </thead>
        </table>,
      );
    expect(head('calls')).toContain('aria-sort="ascending"');
    expect(head('calls')).toContain('class="num"');
    expect(head('name')).not.toContain('aria-sort');
    expect(head('name')).toContain('class="sort-button"');
  });

  it('CellText reads out why a cell is blank', () => {
    expect(renderToStaticMarkup(<CellText cell={{ text: '1' }} />)).toBe('1');
    expect(renderToStaticMarkup(<CellText cell={{ text: '-', note: 'No budget' }} />)).toContain('visually-hidden');
  });
});

describe('small cleanups', () => {
  it('the ask box limit is the server limit', () => {
    expect(ASK_MAX_CHARS).toBe(QUESTION_MAX_CHARS);
  });

  it('the print notes are the spend and revenue-per-dollar formulas', () => {
    const formulas = estimateFormulas(7);
    expect(printEstimateNotes(7).slice(0, 2)).toEqual([formulas[0]!.formula, formulas[2]!.formula]);
  });
});
