// The real model. This is the only file that imports '@anthropic-ai/sdk'.
import Anthropic from '@anthropic-ai/sdk';
import { MODEL_ID } from './pricing';
import { MODEL_TIMEOUT_MS, ModelError, type ModelReply, type ModelRequest, type TakeawayModel } from './types';

/** The part of the SDK client we use, so tests can pass a stub. */
export interface AnthropicLikeClient {
  messages: { create(params: unknown, options?: unknown): Promise<unknown> };
}

/** What we read from a reply. Anything missing is treated as empty. */
interface RawReply {
  stop_reason?: string | null;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Builds the SDK client: no retries (a retry doubles cost and wait). The caller passes the already trimmed key. */
export function newAnthropicClient(apiKey: string): AnthropicLikeClient {
  return new Anthropic({ apiKey, maxRetries: 0, timeout: MODEL_TIMEOUT_MS });
}

export function createAnthropicModel(client: AnthropicLikeClient): TakeawayModel {
  return {
    id: MODEL_ID,
    async generate(request: ModelRequest): Promise<ModelReply> {
      let reply: RawReply;
      try {
        reply = (await client.messages.create(
          {
            model: MODEL_ID,
            max_tokens: request.maxOutputTokens,
            system: request.system,
            messages: [{ role: 'user', content: request.user }],
            output_config: { effort: 'low', format: { type: 'json_schema', schema: request.schema } },
          },
          { signal: request.signal },
        )) as RawReply;
      } catch (error) {
        throw toModelError(error);
      }
      const usage = {
        inputTokens: reply.usage?.input_tokens ?? 0,
        outputTokens: reply.usage?.output_tokens ?? 0,
      };
      if (reply.stop_reason === 'refusal') return { kind: 'refusal', usage };
      if (reply.stop_reason === 'max_tokens') return { kind: 'truncated', usage };
      const text = (reply.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('');
      return { kind: 'text', text, usage };
    },
  };
}

// Fixed sentences only: the SDK's own message can hold request details.
function toModelError(error: unknown): ModelError {
  if (error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ModelError('timeout', 'The AI service did not answer in time.');
  }
  return new ModelError('api_error', 'The AI service request failed.');
}
