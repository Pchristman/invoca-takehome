import type { DatabaseHandle } from '../handle';
import { commitUpload, type UploadCommit } from './commit';
import { readUpload } from './detect';
import { planUpload } from './plan';
import type { UploadPreview } from './types';

export interface UploadService {
  /** Read-only: what the file would add. Throws UploadRejected. */
  preview(fileName: string, text: string): UploadPreview;
  /** Writes in one transaction. Throws UploadRejected, or UploadFailed when the write rolled back. */
  commit(fileName: string, text: string): UploadCommit;
}

export function createUploadService(handle: DatabaseHandle): UploadService {
  return {
    preview: (fileName, text) => {
      const upload = readUpload(fileName, text);
      return handle.use((db) => planUpload(db, upload).preview);
    },
    commit: (fileName, text) => {
      const upload = readUpload(fileName, text);
      return handle.use((db) => commitUpload(db, upload));
    },
  };
}
