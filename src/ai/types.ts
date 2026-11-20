// Shared types for the AI takeaway code. Everything in src/ai/ talks through these.

/** Why a takeaway is template text instead of AI text. */
export type TakeawayReason =
  | 'ai_off' | 'budget_reached' | 'no_facts' | 'timeout' | 'api_error'
  | 'refusal' | 'malformed' | 'check_failed' | 'log_unavailable';

/** Why a question did not become a filter. */
export type QuestionReason =
  | 'ai_off' | 'budget_reached' | 'timeout' | 'api_error' | 'refusal' | 'malformed'
  | 'log_unavailable' | 'unanswerable' | 'invalid_filter';

export interface TakeawayResult {
  /** Filled in, ready to show. */
  text: string;
  source: 'ai' | 'template';
  /** null exactly when source is 'ai'. */
  reason: TakeawayReason | null;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelRequest {
  system: string;
  user: string;
  maxOutputTokens: number;
  signal: AbortSignal;
}

export type ModelReply =
  | { kind: 'text'; text: string; usage: Usage } // the raw reply text (JSON)
  | { kind: 'refusal'; usage: Usage };

/** The only error a model may throw. The message must never hold request details or the key. */
export class ModelError extends Error {
  readonly code: 'timeout' | 'api_error';
  constructor(code: 'timeout' | 'api_error', message: string) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
  }
}

export interface TakeawayModel {
  readonly id: string;
  /** Throws ModelError. */
  generate(request: ModelRequest): Promise<ModelReply>;
}
