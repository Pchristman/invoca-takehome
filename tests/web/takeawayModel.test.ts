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

describe('takeawayModel', () => {
  it('is hidden with no state', () => {
    expect(takeawayModel(null)).toEqual({ kind: 'hidden' });
  });

  it('is hidden when the request failed', () => {
    const failed: State = { status: 'failed', key: 'k', error: { code: 'network', message: 'down' } };
    expect(takeawayModel(failed)).toEqual({ kind: 'hidden' });
  });

  it('loading shows the label and no text', () => {
    const show = takeawayModel({ status: 'loading', key: 'k' });
    expect(show).toEqual({ kind: 'loading', label: 'Loading takeaway...' });
  });

  it('ready AI shows the AI marker', () => {
    expect(takeawayModel(ai)).toEqual({ kind: 'ready', text: 'Calls rose.', marker: 'AI' });
  });

  it('ready template shows the template marker', () => {
    expect(takeawayModel(template('ai_off'))).toEqual({
      kind: 'ready', text: 'Template text.', marker: 'template',
    });
  });
});
