import type { DatabaseSync } from 'node:sqlite';
import { openExistingDatabase } from './database';

/** How the server reaches the database it was started with. */
export interface DatabaseHandle {
  /** The file behind the handle, when there is one; lets a caller keep it out of a message. */
  readonly location?: string;
  /** Run `fn` with an open connection. The connection is not kept past a file handle's call. */
  use<T>(fn: (db: DatabaseSync) => T): T;
  /** Release whatever is held open. Safe to call twice. */
  close(): void;
}

/**
 * A database file, opened for each use and closed right after, so the file is never held open between
 * uploads (on Windows an open file cannot be moved or deleted). A missing or bad file throws the same LoadError as at start.
 */
export function createFileHandle(path: string): DatabaseHandle {
  return {
    location: path,
    use: (fn) => {
      const db = openExistingDatabase(path);
      try {
        return fn(db);
      } finally {
        db.close();
      }
    },
    close: () => undefined,
  };
}

/** One connection kept open: an in-memory database lives only as long as its connection. */
export function createMemoryHandle(db: DatabaseSync): DatabaseHandle {
  let open = true;
  return {
    use: (fn) => fn(db),
    close: () => {
      if (!open) return;
      open = false;
      db.close();
    },
  };
}
