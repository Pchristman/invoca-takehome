/** Escape closes the data notes, unless something else (an open select, a date picker) is using the key. */
export function shouldCloseDataNotes(event: { key: string; defaultPrevented: boolean; targetTag: string }): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented) return false;
  return !['SELECT', 'INPUT', 'TEXTAREA'].includes(event.targetTag.toUpperCase());
}
