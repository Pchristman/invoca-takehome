/** Escape closes the data notes, unless something else (an open select, a date picker) is using the key. */
export function shouldCloseDataNotes(event: { key: string; defaultPrevented: boolean; targetTag: string }): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented) return false;
  return !['SELECT', 'INPUT', 'TEXTAREA'].includes(event.targetTag.toUpperCase());
}

/** Escape closes the upload panel on the same terms, but not while a file is being written: closing then would lose the result. */
export function shouldCloseUpload(event: { key: string; defaultPrevented: boolean; targetTag: string; step: string }): boolean {
  return event.step !== 'saving' && shouldCloseDataNotes(event);
}
