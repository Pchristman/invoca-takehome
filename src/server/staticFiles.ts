import { existsSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { MiddlewareHandler } from 'hono';

const NOT_BUILT = 'The web app is not built yet. The data is available at /api/meta.';

/**
 * Serves the built web app. Registered last, after every /api route.
 * Whether a build exists is decided once, at startup: a build made after that is not picked up until a restart,
 * and deleting the build later also needs a restart. Once there is a build, `index.html` is read on every
 * request, like the assets, so a rebuild shows up at once.
 */
export function serveWebApp(webRoot: string): MiddlewareHandler {
  const indexPath = join(webRoot, 'index.html');

  if (!existsSync(indexPath)) {
    return async (c) => (c.req.path === '/' ? c.text(NOT_BUILT) : c.text('Not found', 404));
  }

  // serveStatic reads relative to the current directory and refuses paths that leave its root.
  const files = serveStatic({ root: relative(process.cwd(), webRoot) });
  const noop = async () => {};

  return async (c) => {
    const served = await files(c, noop);
    if (served) {
      // Built assets have a content hash in their name, so they never change; everything else is checked on each load.
      served.headers.set('Cache-Control', c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      return served;
    }
    // A path with a file extension is an asset: if it isn't there, say so rather than hide a broken build behind the app.
    if (extname(c.req.path) !== '') return c.text('Not found', 404);
    // Anything else is a view path; the URL holds the view state, so a refresh must return the app.
    try {
      return c.html(readFileSync(indexPath, 'utf-8'), 200, { 'Cache-Control': 'no-cache' });
    } catch {
      // The build was removed after startup.
      return c.text('Not found', 404);
    }
  };
}
