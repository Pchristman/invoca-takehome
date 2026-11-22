/** Escape may close a panel, unless something else (an open select, a date picker) is using the key. */
export function escapeMayClose(event: { key: string; defaultPrevented: boolean; targetTag: string }): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented) return false;
  return !['SELECT', 'INPUT', 'TEXTAREA'].includes(event.targetTag.toUpperCase());
}

/** While a file is being written the upload panel stays open (Close, Escape and the header toggle), so the result is never lost. */
export function uploadLocked(step: string): boolean {
  return step === 'saving';
}

