import { bodyLimit } from 'hono/body-limit';
import type { Context, Hono } from 'hono';
import type { UploadCommit } from '../db/upload/commit';
import type { UploadService } from '../db/upload/service';
import { UploadFailed, UploadRejected } from '../db/upload/types';
import { statusFor } from './api';
import type { ApiError, Meta, UploadCommitResponse, UploadPreviewResponse } from './api';
import { UPLOAD_MAX_BYTES } from './config';

const FILE_NAME_MAX_CHARS = 100;

export interface UploadRoutesDeps {
  /** Absent when the server has no database to write to. */
  uploads: UploadService | undefined;
  /** The cross-site rule the paid routes use: a refusal to return, or null to go on. */
  crossSite: (c: Context) => Response | null;
  /** Called with a commit that wrote rows: the app swaps in the new store, then the fresh /api/meta body comes back. */
  adopt: (commit: UploadCommit) => Meta;
  /** The current /api/meta body. */
  meta: () => Meta;
}

const fail = (c: Context, error: ApiError) => c.json({ error }, statusFor(error.code));
const badFile = (c: Context, message: string) => fail(c, { code: 'bad_upload', message, field: 'file' });

/** The one file in the form field `file`, as its (shortened) name and its text; or the error response to return. */
async function readFileField(c: Context): Promise<{ fileName: string; text: string } | Response> {
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody({ all: true });
  } catch {
    return badFile(c, 'The request is not a file upload. Choose one CSV file.');
  }
  const field = body.file;
  const files = Array.isArray(field) ? field : field === undefined ? [] : [field];
  if (files.length === 0) return badFile(c, 'No file was sent. Choose one CSV file.');
  const file = files[0];
  if (files.length > 1 || !(file instanceof File)) return badFile(c, 'Send exactly one file.');
  // The name is text from the user: cut, shown escaped by the page, and never used as a path.
  return { fileName: file.name.slice(0, FILE_NAME_MAX_CHARS), text: await file.text() };
}

/** POST /api/upload/preview and /api/upload/commit: cross-site check, size limit, one multipart file, then the service. */
export function mountUploadRoutes(app: Hono, deps: UploadRoutesDeps): void {
  const route = (path: string, run: (uploads: UploadService, fileName: string, text: string) => object) =>
    app.post(
      path,
      async (c, next) => deps.crossSite(c) ?? next(),
      bodyLimit({ maxSize: UPLOAD_MAX_BYTES, onError: (c) => fail(c, { code: 'too_large', message: 'The file is larger than 10 MB.', field: 'file' }) }),
      async (c) => {
        const { uploads } = deps;
        if (!uploads) return fail(c, { code: 'upload_unavailable', message: 'This server has no database to store uploads in.' });
        const read = await readFileField(c);
        if (read instanceof Response) return read;
        try {
          return c.json(run(uploads, read.fileName, read.text));
        } catch (error) {
          if (error instanceof UploadRejected) return badFile(c, error.message);
          if (error instanceof UploadFailed) return fail(c, { code: 'upload_failed', message: error.message });
          throw error;
        }
      },
    );

  route('/api/upload/preview', (uploads, name, text): UploadPreviewResponse => ({ preview: uploads.preview(name, text) }));
  route('/api/upload/commit', (uploads, name, text): UploadCommitResponse => {
    const result = uploads.commit(name, text);
    const meta = result.store === null ? deps.meta() : deps.adopt(result);
    return { preview: result.preview, written: result.written, meta };
  });
}
