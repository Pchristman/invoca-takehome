import { describe, it, expect } from 'vitest';
import type { QuestionReason } from '../../src/ai/types';
import type { QuestionResponse } from '../../src/server/api';
import { AI_OFF_NOTE, EXAMPLE_QUESTIONS, askModel, replyWanted } from '../../src/web/models/askModel';
import type { RequestState } from '../../src/web/requestState';
import { metaFor } from './fixtures';
import { serverFixture } from '../server/helpers';

function failed(reason: QuestionReason, message = ''): RequestState<QuestionResponse> {
  return { status: 'ready', key: 'k', data: { ok: false, reason, message } };
}

describe('askModel', () => {
  it('hides the box with a note when AI is off, shows it when on or budget reached', () => {
    expect(askModel({ aiStatus: 'off' }, null)).toEqual({ box: 'hidden', note: AI_OFF_NOTE });
    expect(AI_OFF_NOTE).toBe(
      'Ask a question needs AI. Set ANTHROPIC_API_KEY, make sure the logs folder is writable, and restart.',
    );
    for (const aiStatus of ['on', 'budget_reached'] as const) {
      expect(askModel({ aiStatus }, null)).toEqual({ box: 'shown', busy: false, message: null, examples: null });
    }
  });

  it('every failure reason shows the server text (never a client copy); examples only for the four rewording reasons', () => {
    const reasons: QuestionReason[] = [
      'ai_off', 'budget_reached', 'timeout', 'api_error', 'refusal', 'malformed',
      'unanswerable', 'log_unavailable', 'invalid_filter',
    ];
    const withExamples = ['invalid_filter', 'malformed', 'refusal', 'unanswerable'];
    for (const reason of reasons) {
      const message = `server says ${reason} zzz`; // matches no text the client could have copied
      const show = askModel({ aiStatus: 'on' }, failed(reason, message));
      expect(show).toMatchObject({ box: 'shown', busy: false, message });
      expect('examples' in show && show.examples !== null).toBe(withExamples.includes(reason));
    }
    // An empty message still gets a plain fallback, not a blank box.
    const empty = askModel({ aiStatus: 'on' }, failed('timeout', ''));
    expect('message' in empty && empty.message).toBeTruthy();
    const detail = `Couldn't turn that into a filter: No office is called "X".`;
    expect(askModel({ aiStatus: 'on' }, failed('invalid_filter', detail))).toMatchObject({
      message: detail,
      examples: EXAMPLE_QUESTIONS,
    });
  });

  it('a client-side failure keeps its own sentence; a success shows nothing', () => {
    expect(askModel({ aiStatus: 'on' }, failed('api_error', "Can't reach the data."))).toMatchObject({
      message: "Can't reach the data.",
    });
    const ok: RequestState<QuestionResponse> = {
      status: 'ready',
      key: 'k',
      data: { ok: true, source: 'ai', cached: false, query: 'view=overview' },
    };
    expect(askModel({ aiStatus: 'on' }, ok)).toMatchObject({ message: null, busy: false });
  });

  it('a reply is wanted only from the latest submit that was not aborted (M9)', () => {
    expect(replyWanted({ submitId: 2, latestId: 2, aborted: false })).toBe(true);
    expect(replyWanted({ submitId: 1, latestId: 2, aborted: false })).toBe(false); // a newer submit exists
    expect(replyWanted({ submitId: 2, latestId: 2, aborted: true })).toBe(false); // unmounted or cancelled
  });

  it('loading is busy', () => {
    expect(askModel({ aiStatus: 'on' }, { status: 'loading', key: 'k' })).toMatchObject({ busy: true });
  });

  it('examples carry no digits and none of the data names', () => {
    expect(EXAMPLE_QUESTIONS).toHaveLength(3);
    const meta = metaFor(serverFixture());
    const names = [...meta.locations, ...meta.campaigns].map((x) => x.name.toLowerCase());
    for (const example of EXAMPLE_QUESTIONS) {
      expect(example).not.toMatch(/\d/);
      for (const name of names) expect(example.toLowerCase()).not.toContain(name);
    }
  });
});
