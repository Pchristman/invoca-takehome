import type { ViewName } from '../src/core/views';

export const TRY_VIEWS: readonly ViewName[] = ['overview', 'campaigns', 'locations', 'missed-calls'];
export const TRY_USAGE = 'Usage: npm run ai:try -- <view|all> [range]   (range: last7, last28 or all; default all)';

/** `npm run ai:try -- <view|all> [range]`: which views to ask about, and over which range. */
export function parseTryArgs(argv: string[]): { views: ViewName[]; range: string } {
  const [target, range = 'all'] = argv;
  if (!target) throw new Error(TRY_USAGE);
  if (target === 'all') return { views: [...TRY_VIEWS], range };
  const view = TRY_VIEWS.find((v) => v === target);
  if (!view) throw new Error(`Unknown view "${target.slice(0, 40)}". Use one of: ${TRY_VIEWS.join(', ')}, all.`);
  return { views: [view], range };
}
