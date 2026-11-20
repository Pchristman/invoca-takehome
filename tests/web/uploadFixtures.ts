import type { UploadKind, UploadPreview } from '../../src/db/upload/types';

export const noExamples = (): UploadPreview['examples'] => ({ new: [], new_version: [], duplicate: [], conflict: [], bad: [] });

/** A preview with the given counts; rowsRead defaults to the sum of the five classes. */
export function previewOf(kind: UploadKind, counts: Partial<UploadPreview['counts']> = {}, rest: Partial<UploadPreview> = {}): UploadPreview {
  const full = { rowsRead: 0, newRows: 0, newVersions: 0, duplicates: 0, conflicts: 0, bad: 0, ...counts };
  if (counts.rowsRead === undefined) full.rowsRead = full.newRows + full.newVersions + full.duplicates + full.conflicts + full.bad;
  return { kind, fileName: 'f.csv', counts: full, examples: noExamples(), badByReason: {}, hints: [], ...rest };
}
