import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createAnthropicModel, newAnthropicClient } from '../../src/ai/anthropicModel';
import { MODEL_ID } from '../../src/ai/pricing';
import { REPLY_SCHEMA } from '../../src/ai/prompt';
import { FILTER_SCHEMA } from '../../src/ai/question';
import { ModelError } from '../../src/ai/types';

type Params = Record<string, unknown>;

function stubClient(reply: unknown) {
  const calls: { params: Params; options: Params | undefined }[] = [];
  const client = {
    messages: {
      create: async (params: unknown, options?: unknown) => {
        calls.push({ params: params as Params, options: options as Params | undefined });
        return reply;
      },
    },
  };
  return { client, calls };
}

function throwingClient(error: unknown) {
  return { messages: { create: async () => { throw error; } } };
}

const usage = { input_tokens: 10, output_tokens: 5 };
const request = () => ({
  system: 'sys', user: 'usr', schema: REPLY_SCHEMA, maxOutputTokens: 300, signal: new AbortController().signal,
});

describe('anthropicModel', () => {
  it('maps a text reply', async () => {
    const { client } = stubClient({
      stop_reason: 'end_turn', content: [{ type: 'text', text: '{"takeaway":"x"}' }], usage,
    });
    const model = createAnthropicModel(client);
    expect(model.id).toBe(MODEL_ID);
    expect(await model.generate(request())).toEqual({
      kind: 'text', text: '{"takeaway":"x"}', usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it('maps a refusal stop reason, keeping the usage', async () => {
    const { client } = stubClient({ stop_reason: 'refusal', content: [], usage });
    expect(await createAnthropicModel(client).generate(request())).toEqual({
      kind: 'refusal', usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it('reports a max_tokens stop as truncated, keeping the usage and never the cut-off text', async () => {
    const { client } = stubClient({
      stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"takeaw' }], usage,
    });
    expect(await createAnthropicModel(client).generate(request())).toEqual({
      kind: 'truncated', usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it('returns empty text when the reply has no text block', async () => {
    const { client } = stubClient({ stop_reason: 'end_turn', content: [], usage });
    expect(await createAnthropicModel(client).generate(request())).toEqual({
      kind: 'text', text: '', usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it('sends the model, max_tokens, signal and low effort, and no sampling or thinking settings', async () => {
    const { client, calls } = stubClient({ stop_reason: 'end_turn', content: [], usage });
    const req = request();
    await createAnthropicModel(client).generate(req);
    const { params, options } = calls[0]!;
    expect(params.model).toBe(MODEL_ID);
    expect(params.max_tokens).toBe(300);
    expect(params.system).toBe('sys');
    expect(params.messages).toEqual([{ role: 'user', content: 'usr' }]);
    expect(params.output_config).toEqual({
      effort: 'low', format: { type: 'json_schema', schema: REPLY_SCHEMA },
    });
    expect(options).toEqual({ signal: req.signal });
    for (const key of ['temperature', 'top_p', 'top_k', 'thinking']) {
      expect(params).not.toHaveProperty(key);
    }
  });

  it('sends the schema the request carries, not a fixed one', async () => {
    const { client, calls } = stubClient({ stop_reason: 'end_turn', content: [], usage });
    await createAnthropicModel(client).generate({ ...request(), schema: FILTER_SCHEMA });
    expect(calls[0]!.params.output_config).toEqual({
      effort: 'low', format: { type: 'json_schema', schema: FILTER_SCHEMA },
    });
  });

  it('turns an abort or timeout error into ModelError timeout', async () => {
    for (const error of [new Anthropic.APIUserAbortError(), new Anthropic.APIConnectionTimeoutError()]) {
      const err = await createAnthropicModel(throwingClient(error)).generate(request()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ModelError);
      expect((err as ModelError).code).toBe('timeout');
    }
  });

  it('turns any other error into ModelError api_error with a fixed sentence', async () => {
    const secret = 'sk-ant-secret-key and request body';
    const err = await createAnthropicModel(throwingClient(new Error(secret))).generate(request())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).code).toBe('api_error');
    expect((err as ModelError).message).not.toContain('sk-ant');
    expect((err as ModelError).message).toBe('The AI service request failed.');
  });
});

describe('newAnthropicClient', () => {
  it('uses the key it is given, not the environment', () => {
    const client = newAnthropicClient('sk-ant-test-key') as unknown as { apiKey: string };
    expect(client.apiKey).toBe('sk-ant-test-key');
  });
});
