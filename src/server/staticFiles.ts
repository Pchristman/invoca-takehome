import { existsSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { MiddlewareHandler } from 'hono';

const NOT_BUILT = 'The web app is not built yet. The data is available at /api/meta.';

/**
 * Serves the built web app. Registered last, after every /api route.
 * Whether `index.html` exists is decided once, at startup: a build made later is not picked up until a restart.
 */
export function serveWebApp(webRoot: string): MiddlewareHandler {
  const indexPath = join(webRoot, 'index.html');

  if (!existsSync(indexPath)) {
    return async (c) => (c.req.path === '/' ? c.text(NOT_BUILT) : c.text('Not found', 404));
  }

  const indexHtml = readFileSync(indexPath, 'utf-8');
  // serveStatic reads relative to the current directory and refuses paths that leave its root.
  const files = serveStatic({ root: relative(process.cwd(), webRoot) });
  const noop = async () => {};

  return async (c) => {
    const served = await files(c, noop);
    if (served) return served;
    // A path with a file extension is an asset: if it isn't there, say so rather than hide a broken build behind the app.
    if (extname(c.req.path) !== '') return c.text('Not found', 404);
    // Anything else is a view path; the URL holds the view state, so a refresh must return the app.
    return c.html(indexHtml);
  };
}
