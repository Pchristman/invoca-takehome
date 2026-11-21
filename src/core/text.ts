/** Plain character (UTF-16 code unit) order, so a sort never depends on the machine's locale. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The name shown for calls with an empty campaign_id. */
export const UNATTRIBUTED_NAME = 'Unattributed';
