// A fact sheet is a flat record of typed facts. Action templates hold {key} placeholders and one
// function fills them, so template text and, later, AI text read exactly the same facts.
import {
  formatCount, formatHour, formatPercentChange, formatPointsChange, formatRate, formatUsd, formatUsdPerDollar, formatWeekday,
} from './format';

/** Every view, in menu order. The one list the URL parser and the question schema read. */
export const VIEW_NAMES = ['overview', 'campaigns', 'locations', 'missed-calls'] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

export type Fact =
  | { kind: 'name'; value: string } // a campaign, office or channel: becomes an entity
  | { kind: 'word'; value: string } // a plain word the text must use as given, such as 'jumped'; not an entity
  | { kind: 'count'; value: number; noun?: readonly [string, string] }
  | { kind: 'usd'; value: number }
  | { kind: 'usd_per_dollar'; value: number } // revenue per budget dollar, to the cent
  | { kind: 'rate'; value: number } // a fraction, 0 to 1
  | { kind: 'weekday'; value: number } // 0 = Monday
  | { kind: 'hour'; value: number }
  | { kind: 'percent_change'; value: number }
  | { kind: 'points_change'; value: number };

export type Facts = Record<string, Fact>;

export interface FactSheet {
  view: ViewName;
  facts: Facts;
  entities: string[]; // distinct 'name' values, plain character order
}

export function formatFact(fact: Fact): string {
  if (fact.kind === 'name' || fact.kind === 'word') return fact.value;
  if (!Number.isFinite(fact.value)) throw new Error(`Cannot format a non-finite ${fact.kind} fact`);
  switch (fact.kind) {
    case 'count': return formatCount(fact.value, fact.noun);
    case 'usd': return formatUsd(fact.value);
    case 'usd_per_dollar': return formatUsdPerDollar(fact.value);
    case 'rate': return formatRate(fact.value);
    case 'weekday': return formatWeekday(fact.value);
    case 'hour': return formatHour(fact.value);
    case 'percent_change': return formatPercentChange(fact.value);
    case 'points_change': return formatPointsChange(fact.value);
  }
}

/** A {placeholder}: anything between a pair of braces. The AI checker uses the same two patterns. */
export const PLACEHOLDER = /\{([^{}]*)\}/g;
/** What a placeholder key must look like. */
export const PLACEHOLDER_KEY = /^[a-z0-9_.]+$/;

export function fillPlaceholders(template: string, facts: Facts): string {
  const unknown: string[] = [];
  const text = template.replace(PLACEHOLDER, (_match, key: string) => {
    if (!PLACEHOLDER_KEY.test(key)) throw new Error(`Malformed placeholder: {${key}}`);
    const fact = Object.prototype.hasOwnProperty.call(facts, key) ? facts[key] : undefined;
    if (!fact) {
      if (!unknown.includes(key)) unknown.push(key);
      return '';
    }
    return formatFact(fact);
  });
  if (unknown.length > 0) throw new Error(`Unknown placeholder keys: ${unknown.join(', ')}`);
  return text;
}

export function makeFactSheet(view: ViewName, facts: Facts): FactSheet {
  const names = new Set<string>();
  for (const fact of Object.values(facts)) if (fact.kind === 'name') names.add(fact.value);
  const entities = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { view, facts, entities };
}

export type ActionKind =
  | 'shift_budget' | 'fix_attribution' | 'review_office_answer' | 'review_office_booking' | 'call_back'
  | 'no_budget_shift' | 'no_office_stands_out' | 'no_office_worse' | 'no_missed_calls' | 'no_callbacks'
  | 'review_call_changes';

const ACTIONABLE: readonly ActionKind[] = [
  'shift_budget', 'fix_attribution', 'review_office_answer', 'review_office_booking', 'call_back', 'review_call_changes',
];

export interface ActionLink { view: ViewName; locationId?: string }

export interface Action {
  kind: ActionKind;
  actionable: boolean;
  template: string;
  facts: Facts;
  text: string;
  link: ActionLink;
}

export function makeAction(kind: ActionKind, template: string, facts: Facts, link: ActionLink): Action {
  return {
    kind,
    actionable: ACTIONABLE.includes(kind),
    template,
    facts,
    text: fillPlaceholders(template, facts),
    link,
  };
}
