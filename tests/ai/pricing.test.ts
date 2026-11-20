import { describe, expect, it } from 'vitest';
import {
  MAX_OUTPUT_TOKENS, MODEL_ID, PRICES, costNanoUsd, nanoToUsd, worstCaseNanoUsd,
} from '../../src/ai/pricing';

describe('pricing', () => {
  it('prices the confirmed rates in whole nano-dollars per token', () => {
    expect(PRICES[MODEL_ID]).toEqual({ inputNanoPerToken: 100, outputNanoPerToken: 500 });
  });

  it('costs a call from its tokens', () => {
    const nano = costNanoUsd(MODEL_ID, { inputTokens: 1500, outputTokens: 300 });
    expect(nano).toBe(300000);
    expect(nanoToUsd(nano)).toBe(0.0003);
  });

  it('costs nothing for zero usage', () => {
    expect(costNanoUsd(MODEL_ID, { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it('throws for a model not in the table, naming it', () => {
    expect(() => costNanoUsd('mystery-model', { inputTokens: 1, outputTokens: 1 }))
      .toThrow(/mystery-model/);
    expect(() => worstCaseNanoUsd('mystery-model', 10)).toThrow(/mystery-model/);
  });

  it('worst case is half the prompt characters as input plus the full output cap', () => {
    expect(MAX_OUTPUT_TOKENS).toBe(1500);
    expect(worstCaseNanoUsd(MODEL_ID, 3000)).toBe(1500 * 100 + 1500 * 500);
  });

  it('rounds input tokens up, so one more character costs one more token', () => {
    const diff = worstCaseNanoUsd(MODEL_ID, 3001) - worstCaseNanoUsd(MODEL_ID, 3000);
    expect(diff).toBe(100);
  });

  it('keeps the worst case for a typical prompt under $0.002', () => {
    expect(nanoToUsd(worstCaseNanoUsd(MODEL_ID, 6000))).toBeLessThan(0.002);
  });
});
