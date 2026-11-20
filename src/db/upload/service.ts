import { LoadError } from '../../core/errors';
import type { DatabaseHandle } from '../handle';
import { commitUpload, withoutPath, type UploadCommit } from './commit';
import { readUpload } from './detect';
import { planUpload } from './plan';
import { UploadFailed, type UploadPreview } from './types';

export interface UploadService {
  /** Read-only: what the file would add. Throws UploadRejected, or UploadFailed when the database cannot be read. */
  preview(fileName: string, text: string): UploadPreview;
  /** Writes in one transaction. Throws UploadRejected, or UploadFailed when the write rolled back or the database cannot be opened. */
  commit(fileName: string, text: string): UploadCommit;
}

export function createUploadService(handle: DatabaseHandle): UploadService {
  /** A database that cannot be opened is an upload failure with the reason, not a server crash; the path stays out of it. */
  const unopenable = (error: unknown, lead: string): never => {
    if (!(error instanceof LoadError)) throw error;
    throw new UploadFailed(`${lead}${withoutPath(error.message, handle.location)}`);
  };
  return {
    preview: (fileName, text) => {
      const upload = readUpload(fileName, text);
      try {
        return handle.use((db) => planUpload(db, upload).preview);
      } catch (error) {
        return unopenable(error, 'The upload could not be checked: ');
      }
    },
    commit: (fileName, text) => {
      const upload = readUpload(fileName, text);
      try {
        return handle.use((db) => commitUpload(db, upload));
      } catch (error) {
        return unopenable(error, 'The upload failed and nothing was stored: ');
      }
    },
  };
}
