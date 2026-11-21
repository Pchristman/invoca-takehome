import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { dataSpan } from '../../src/core/ranges';
import { buildAnswer } from '../../src/core/answer';
import type { AnswerFilter } from '../../src/core/answer';
import type { AnswerResponse, QuestionResponse } from '../../src/server/api';
import { AnswerPage } from '../../src/web/components/AnswerView';
import { AskBoxView } from '../../src/web/components/AskBox';
import { Header } from '../../src/web/components/Header';
import { Nav } from '../../src/web/components/Nav';
import { askModel } from '../../src/web/models/askModel';
import type { RequestState } from '../../src/web/requestState';
import { answerParams, parseUrlState } from '../../src/web/urlState';
import { serverFixture } from '../server/helpers';
import { metaFor, toJson } from './fixtures';

const store = serverFixture();
const span = dataSpan(store.calls)!;
const RANGE = { start: '2026-09-02', end: '2026-09-09', days: 8, clamped: false };
const NAMES = {
  offices: [{ id: 'loc_a', name: 'Office A' }],
  campaigns: [{ id: 'cmp_a', name: 'Alpha' }],
};
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function filter(changes: Partial<AnswerFilter>): AnswerFilter {
  return { view: 'overview', officeIds: [], campaignIds: [], includeUnattributed: false, weekdays: [], hours: [], ...changes };
}
function answer(changes: Partial<AnswerFilter> = {}, edit?: (a: AnswerResponse) => void): AnswerResponse {
  const value = toJson({ ...buildAnswer(store, RANGE, filter(changes)), names: NAMES }) as AnswerResponse;
  edit?.(value);
  return value;
}
function ready(data: AnswerResponse): RequestState<AnswerResponse> {
  return { status: 'ready', key: 'k', data };
}

const box = (aiStatus: 'on' | 'off' | 'budget_reached', request: RequestState<QuestionResponse> | null = null, value = '') =>
  renderToStaticMarkup(<AskBoxView show={askModel({ aiStatus }, request)} value={value} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />);

const page = (request: RequestState<AnswerResponse>, search = '?answer&view=missed-calls&f_office=loc_a&range=last7') =>
  renderToStaticMarkup(
    <AnswerPage request={request} state={parseUrlState(search)} span={span} resetHref="/?answer-reset" onRetry={() => {}} />,
  );

describe('AskBox', () => {
  it('AI off: the note and no form or input', () => {
    const markup = box('off');
    expect(markup).toContain('Ask a question needs AI.');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('<form');
  });

  it('AI on or budget reached: a labelled input and a button', () => {
    for (const status of ['on', 'budget_reached'] as const) {
      const markup = box(status);
      expect(markup).toContain('<form');
      expect(markup).toMatch(/<label[^>]*for="ask-input"/);
      expect(markup).toMatch(/<input[^>]*id="ask-input"/);
      expect(markup).toContain('maxLength="300"');
      expect(markup).toMatch(/<button[^>]*type="submit"/);
    }
  });

  it('a failure shows its message and examples in a status region, never an alert, and keeps the text', () => {
    const failed: RequestState<QuestionResponse> = {
      status: 'ready',
      key: 'k',
      data: { ok: false, reason: 'unanswerable', message: "That isn't a question about these calls." },
    };
    const markup = box('on', failed, 'show me the busy times');
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('role="alert"');
    expect(markup).toContain(escape("That isn't a question about these calls.").replace(/'/g, '&#x27;'));
    expect(markup).toContain('Which office misses the most calls on Fridays?');
    expect(markup).toContain('value="show me the busy times"');
  });

  it('a busy box turns the button into Cancel, a plain button that is never disabled', () => {
    const markup = box('on', { status: 'loading', key: 'k' });
    expect(markup).toMatch(/<button type="button"[^>]*>Cancel<\/button>/);
    expect(markup).not.toContain('type="submit"');
    expect(markup).not.toContain('disabled');
  });

  it('the status region is there before it has text, so its first message is announced', () => {
    expect(box('on')).toMatch(/<div role="status" class="ask-result"><\/div>/);
  });
});

describe('AnswerView', () => {
  it('prints the reading, the sentence, the table, the real-view link and Clear question', () => {
    const markup = page(ready(answer({ view: 'missed-calls', officeIds: ['loc_a'] })));
    expect(markup).toContain('Missed calls');
    expect(markup).toContain('Office A');
    expect(markup).toContain('<table');
    expect(markup).toContain('Open Missed calls');
    expect(markup).toContain('href="/?view=missed-calls&amp;');
    expect(markup).toContain('location=loc_a');
    expect(markup).toContain('Clear question');
    expect(markup).toContain('href="/?range=last7"');
  });

  it('?dev is kept on the links', () => {
    const markup = page(ready(answer({ view: 'missed-calls' })), '?answer&view=missed-calls&range=last7&dev');
    const hrefs = [...markup.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
    const open = hrefs.find((h) => h.includes('view=missed-calls'))!;
    expect(open).toMatch(/&amp;dev$/);
    expect(hrefs.find((h) => h.startsWith('/?range=last7'))!).toMatch(/dev$/);
    expect(markup.match(/dev"/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('shows a blank cell for a null rate', () => {
    const data = answer({ view: 'locations' }, (a) => {
      a.rows[0]!.answerRate = null;
    });
    const markup = page(ready(data));
    expect(markup).not.toContain('NaN');
    expect(markup).toMatch(/<td[^>]*>—<\/td>|<td[^>]*><\/td>/);
  });

  it('names stay text; a long name is whole', () => {
    const long = 'x'.repeat(200);
    const data = answer({ view: 'locations' }, (a) => {
      a.rows[0]!.name = '<b>x</b>';
      a.rows[1]!.name = long;
    });
    const markup = page(ready(data));
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(markup).not.toContain('<b>');
    expect(markup).toContain(long);
  });

  it('a 400 from the server shows its message with a reset link and does not crash', () => {
    const markup = page({
      status: 'failed',
      key: 'k',
      error: { code: 'unknown_location', message: 'No office has the id "nope".', field: 'f_office', status: 400 },
    });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('No office has the id &quot;nope&quot;.');
    expect(markup).toContain('Reset to defaults');
  });

  it('a hand-edited hour (f_hour=abc) is kept in the request and the server 400 message is shown (M8)', () => {
    const state = parseUrlState('?answer&f_hour=abc&range=last7');
    expect(answerParams(state).getAll('f_hour')).toEqual(['abc']);
    const markup = page(
      {
        status: 'failed',
        key: 'k',
        error: { code: 'bad_param', message: 'f_hour must be a whole number from 0 to 23.', field: 'f_hour', status: 400 },
      },
      '?answer&f_hour=abc&range=last7',
    );
    expect(markup).toContain('f_hour must be a whole number from 0 to 23.');
    expect(markup).toContain('role="alert"');
  });

  it('an empty answer says so and shows no table (no misleading empty table)', () => {
    const markup = page(ready(answer({ view: 'locations', weekdays: [6], hours: [3] })));
    expect(markup).toContain('No calls match this question in this range.');
    expect(markup).not.toContain('NaN');
    expect(markup).not.toContain('<table');
  });

  it('an Overview answer with matches shows totals only, no table (M10)', () => {
    const markup = page(ready(answer({ view: 'overview' })));
    expect(markup).not.toContain('<table');
    expect(markup).not.toContain('>Office<');
    expect(markup).toContain('answer-totals');
    expect(markup).not.toContain('No calls match');
  });

  it('an empty missed-calls answer says so and shows no table (M10)', () => {
    const markup = page(ready(answer({ view: 'missed-calls', weekdays: [6], hours: [3] })));
    expect(markup).toContain('No calls match this question in this range.');
    expect(markup).not.toContain('<table');
  });

  it('loading prints a status line', () => {
    expect(page({ status: 'loading', key: 'k' })).toContain('role="status"');
  });
});

describe('routing pieces', () => {
  it('the nav marks no view current on an answer page, and one on a view page', () => {
    expect(renderToStaticMarkup(<Nav state={parseUrlState('?answer&view=missed-calls')} />)).not.toContain('aria-current');
    expect(renderToStaticMarkup(<Nav state={parseUrlState('?view=missed-calls')} />)).toContain('aria-current="page"');
  });

  it('the header carries no ask box', () => {
    const markup = renderToStaticMarkup(
      <Header meta={metaFor(store)} dev={false} dataNotesOpen={false} onToggleDataNotes={() => {}} printLink="/?print" />,
    );
    expect(markup).not.toContain('<form');
  });
});
