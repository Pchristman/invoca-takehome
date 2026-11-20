import { THRESHOLDS } from './thresholds';

export interface AlertOptions {
  z?: number;
  minCalls?: number;
}

export interface CountAlert {
  eligible: boolean;
  z: number | null;
  flagged: boolean;
  direction: 'jump' | 'drop' | null;
}

function isCount(n: number): boolean {
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0;
}

/**
 * Two-sample Poisson z for counts with equal exposure: (current - previous) / sqrt(current + previous).
 * Null unless both are whole numbers >= 0 and at least one call exists.
 */
export function poissonZ(current: number, previous: number): number | null {
  if (!isCount(current) || !isCount(previous) || current + previous === 0) return null;
  return (current - previous) / Math.sqrt(current + previous);
}

/**
 * Is this campaign's call count a jump or drop against the previous period?
 * The caller guarantees the two periods are the same length; this function cannot check that.
 */
export function countAlert(current: number, previous: number, options: AlertOptions = {}): CountAlert {
  const threshold = options.z ?? THRESHOLDS.ALERT_Z;
  const minCalls = options.minCalls ?? THRESHOLDS.MIN_CALLS_ALERT;

  const eligible = isCount(current) && isCount(previous) && current + previous >= Math.max(minCalls, 1);
  const z = eligible ? poissonZ(current, previous) : null;
  const direction = z !== null && Math.abs(z) >= threshold ? (z > 0 ? 'jump' : 'drop') : null;
  return { eligible, z, flagged: direction !== null, direction };
}
