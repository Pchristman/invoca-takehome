import { describe, expect, it } from 'vitest';
import type { TakeawayReason } from '../../src/ai/types';
import type { TakeawayResponse } from '../../src/server/api';
import type { RequestState } from '../../src/web/requestState';
import { takeawayModel } from '../../src/web/models/takeawayModel';

type State = RequestState<TakeawayResponse>;

const ai: State = { status: 'ready', key: 'k', data: { view: 'overview', text: 'Calls rose.', source: 'ai', reason: null } };
const template = (reason: TakeawayReason): State => ({
  status: 'ready',
  key: 'k',
  data: { view: 'overview', text: 'Template text.', source: 'template', reason },
});

// A Record, so a reason added later fails to compile here until it has an expected note.
const NOTES: Record<TakeawayReason, string> = {
  ai_off: 'AI is off: no API key.',
  budget_reached: 'AI budget reached.',
  no_facts: 'There were no facts to write about.',
  timeout: 'The AI took too long to answer.',
  api_error: 'The AI service returned an error.',
  refusal: 'The AI declined to write this one.',
  malformed: 'The AI reply could not be read.',
  check_failed: 'The AI text failed its check.',
  log_unavailable: 'AI is off: the call log could not be used.',
};
const REASONS = Object.keys(NOTES) as TakeawayReason[];

describe('takeawayModel', () => {
  it('is hidden with no state', () => {
    expect(takeawayModel(null, { dev: true })).toEqual({ kind: 'hidden' });
  });

  it('is hidden when the request failed', () => {
    const failed: State = { status: 'failed', key: 'k', error: { code: 'network', message: 'down' } };
    expect(takeawayModel(failed, { dev: true })).toEqual({ kind: 'hidden' });
  });

  it('loading shows the label and no text', () => {
    const show = takeawayModel({ status: 'loading', key: 'k' }, { dev: false });
    expect(show).toEqual({ kind: 'loading', label: 'Loading takeaway...' });
  });

  it('ready AI shows the AI marker and no note, even in dev', () => {
    expect(takeawayModel(ai, { dev: true })).toEqual({ kind: 'ready', text: 'Calls rose.', marker: 'AI', note: null });
  });

  it('ready template without dev has no note', () => {
    expect(takeawayModel(template('ai_off'), { dev: false })).toEqual({
      kind: 'ready', text: 'Template text.', marker: 'template', note: null,
    });
  });

  it.each(REASONS)('ready template with dev explains %s', (reason) => {
    expect(takeawayModel(template(reason), { dev: true })).toEqual({
      kind: 'ready', text: 'Template text.', marker: 'template', note: NOTES[reason],
    });
  });

  it('the nine reasons all have a note', () => {
    expect(REASONS).toHaveLength(9);
    for (const reason of REASONS) {
      const show = takeawayModel(template(reason), { dev: true });
      expect(show.kind === 'ready' && show.note && show.note.length > 0).toBeTruthy();
    }
  });
});
