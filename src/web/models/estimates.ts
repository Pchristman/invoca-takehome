// The formula behind every estimated column, one click away from the number (PLAN.md 3.3).
import { formatCount } from '../../core/views/format';

export type EstimateKind = 'spend' | 'cost_per_booking' | 'revenue_per_dollar';

/** The three estimates in column order; `days` is the number of days in the selected range. */
export function estimateFormulas(days: number): { kind: EstimateKind; label: string; formula: string }[] {
  return [
    {
      kind: 'spend',
      label: 'Est. spend',
      formula: `Estimated spend = daily budget × ${formatCount(days, ['day', 'days'])} in this range. It assumes the full budget was spent every day. The export has no actual spend, so this is an estimate. Blank when the budget is not given.`,
    },
    {
      kind: 'cost_per_booking',
      label: 'Est. cost per booking',
      formula:
        'Estimated cost per booking = estimated spend ÷ bookings. Blank when the budget is $0 or not given, or there are no bookings.',
    },
    {
      kind: 'revenue_per_dollar',
      label: 'Est. revenue per budget $',
      formula: 'Revenue per budget dollar = revenue ÷ estimated spend. Blank when estimated spend is $0 or the budget is not given.',
    },
  ];
}

/** The three "est." lines the printed page always carries: paper has no "one click away". */
export function printEstimateNotes(days: number): string[] {
  const [spend, , revenuePerDollar] = estimateFormulas(days);
  return [
    spend!.formula,
    revenuePerDollar!.formula,
    "Est. missed-call value = the campaign's booking rate × its average booking value, using rates from the whole export. Missed calls shows the full formula.",
  ];
}
