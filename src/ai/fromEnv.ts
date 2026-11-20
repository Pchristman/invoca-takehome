// Reads the AI settings from the environment and builds the takeaway service.
// Without an API key the service is the "off" one: every takeaway is the template text.
import { createHash } from 'node:crypto';
import { CHANNELS, type CallStore } from '../core/types';
import { ConfigError } from '../server/config';
import { createAnthropicModel, newAnthropicClient } from './anthropicModel';
import type { KnownNames } from './checker';
import { createTakeawayService, offService, type TakeawayService } from './service';
import type { TakeawayModel } from './types';

const DEFAULT_SPEND_LIMIT_USD = 5;
const DEFAULT_CACHE_PATH = '.cache/ai-takeaways.json';
const DEFAULT_LOG_PATH = 'logs/ai-calls.jsonl';

/** Dollars. Unset or blank is the default; anything that is not a finite number of 0 or more is a ConfigError. */
export function parseSpendLimit(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_SPEND_LIMIT_USD;
  const limit = Number(value.trim());
  if (!Number.isFinite(limit) || limit < 0) {
    throw new ConfigError('AI_SPEND_LIMIT_USD must be a number of dollars, 0 or more.');
  }
  return limit;
}

/**
 * Identifies the data a takeaway was written for: a hash of each call's id, outcome, revenue and
 * localized date. The store keeps calls in file order, which is stable, so the order is part of the hash.
 */
export function snapshotId(store: CallStore): string {
  const hash = createHash('sha256');
  for (const call of store.calls) {
    hash.update(JSON.stringify([call.callId, call.outcome, call.revenueUsd, call.localDate]));
    hash.update('\n');
  }
  return hash.digest('hex');
}

/** The names the checker lets a takeaway mention. */
export function knownNamesFrom(store: CallStore): KnownNames {
  return {
    campaigns: store.campaigns.map((campaign) => campaign.name),
    offices: store.locations.map((location) => location.name),
    channels: CHANNELS,
  };
}

export function createAiFromEnv(
  store: CallStore,
  env: NodeJS.ProcessEnv,
  overrides: { model?: TakeawayModel; cachePath?: string | null; logPath?: string | null } = {},
): TakeawayService {
  const key = env.ANTHROPIC_API_KEY;
  if (key === undefined || key.trim() === '') return offService();

  const limitUsd = parseSpendLimit(env.AI_SPEND_LIMIT_USD);
  // The trimmed key goes straight to the SDK client; it is never logged or put in a message.
  const model = overrides.model ?? createAnthropicModel(newAnthropicClient(key.trim()));
  return createTakeawayService({
    model,
    known: knownNamesFrom(store),
    snapshotId: snapshotId(store),
    limitUsd,
    cachePath: overrides.cachePath === undefined ? DEFAULT_CACHE_PATH : overrides.cachePath,
    logPath: overrides.logPath === undefined ? DEFAULT_LOG_PATH : overrides.logPath,
  });
}
