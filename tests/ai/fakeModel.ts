// A scripted stand-in for the real model. It never touches the network.
import { MODEL_ID } from '../../src/ai/pricing';
import { ModelError, type ModelReply, type ModelRequest, type TakeawayModel, type Usage } from '../../src/ai/types';

/** What one call does: return a reply, throw an error, or hang until the abort signal fires. */
export type Step = ModelReply | Error | 'hang';

export const USAGE: Usage = { inputTokens: 1500, outputTokens: 300 };

export function textReply(takeaway: string, usage: Usage = USAGE): ModelReply {
  return { kind: 'text', text: JSON.stringify({ takeaway }), usage };
}

/** A text reply holding any value as JSON (used for the question reply shape). */
export function jsonReply(reply: unknown, usage: Usage = USAGE): ModelReply {
  return { kind: 'text', text: JSON.stringify(reply), usage };
}

export class FakeModel implements TakeawayModel {
  readonly id = MODEL_ID;
  calls = 0;
  sawAbort = false;
  requests: ModelRequest[] = [];
  /** When set, every reply waits for this promise first (to hold calls "in flight"). */
  gate: Promise<void> | null = null;
  private readonly steps: Step[];

  /** Steps are used in order; the last one repeats when the script runs out. */
  constructor(...steps: Step[]) {
    this.steps = steps;
  }

  async generate(request: ModelRequest): Promise<ModelReply> {
    const step = this.steps[Math.min(this.calls, this.steps.length - 1)];
    if (step === undefined) throw new Error('FakeModel has no steps');
    this.calls++;
    this.requests.push(request);
    if (this.gate) await this.gate;
    if (step === 'hang') {
      await new Promise<void>((resolve) => {
        request.signal.addEventListener('abort', () => resolve());
        if (request.signal.aborted) resolve();
      });
      this.sawAbort = true;
      throw new ModelError('timeout', 'The model call timed out.');
    }
    if (step instanceof Error) throw step;
    return step;
  }
}
