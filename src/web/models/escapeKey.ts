/** Escape may close a panel, unless something else (an open select, a date picker) is using the key. */
export function escapeMayClose(event: { key: string; defaultPrevented: boolean; targetTag: string }): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented) return false;
  return !['SELECT', 'INPUT', 'TEXTAREA'].includes(event.targetTag.toUpperCase());
}

/** While a file is being written the upload panel stays open (Close, Escape and the header toggle), so the result is never lost. */
export function uploadLocked(step: string): boolean {
  return step === 'saving';
}

/** The one panel an Escape closes: the upload panel unless a file is being written, otherwise the data notes. */
export function panelToClose(
  event: { key: string; defaultPrevented: boolean; targetTag: string },
  panels: { uploadOpen: boolean; uploadStep: string; dataNotesOpen: boolean },
): 'upload' | 'data-notes' | null {
  if (!escapeMayClose(event)) return null;
  if (panels.uploadOpen && !uploadLocked(panels.uploadStep)) return 'upload';
  return panels.dataNotesOpen ? 'data-notes' : null;
}
