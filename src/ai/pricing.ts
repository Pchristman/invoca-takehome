// What a model call costs. Money is whole nano-dollars (a billionth of a dollar),
// so $0.10 per million tokens is exactly 100 per token and sums never drift.

import type { Usage } from './types';

export const MODEL_ID = 'claude-haiku-5-5';

/** Covers any thinking plus a short answer. */
export const MAX_OUTPUT_TOKENS = 1500;

/** Confirmed: $0.10 in, $0.50 out per million tokens (prompts up to 100K tokens). */
export const PRICES: Record<string, { inputNanoPerToken: number; outputNanoPerToken: number }> = {
  [MODEL_ID]: { inputNanoPerToken: 100, outputNanoPerToken: 500 },
};

function priceFor(model: string) {
  const price = PRICES[model];
  if (!price) throw new Error(`No price known for model "${model}"`);
  return price;
}

/** The cost of a finished call, in whole nano-dollars. Throws on an unknown model. */
export function costNanoUsd(model: string, usage: Usage): number {
  const price = priceFor(model);
  return usage.inputTokens * price.inputNanoPerToken + usage.outputTokens * price.outputNanoPerToken;
}

/** The most a call could cost: 2 characters per input token (rounded up) plus the full output cap. */
export function worstCaseNanoUsd(model: string, promptChars: number): number {
  return costNanoUsd(model, {
    inputTokens: Math.ceil(promptChars / 2),
    outputTokens: MAX_OUTPUT_TOKENS,
  });
}

export function nanoToUsd(nano: number): number {
  return nano / 1e9;
}
