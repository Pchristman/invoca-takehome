import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { get, serverFixture, tempDir } from './helpers';

let tmp: string;
let webRoot: string;
const SECRET = 'sentinel-7f3a91c2-not-for-the-web';

beforeEach(() => {
  // The web root is <tmp>/web; a secret sits beside it, one level up, where a path escape would find it.
  tmp = tempDir();
  webRoot = join(tmp, 'web');
  mkdirSync(join(webRoot, 'assets'), { recursive: true });
  writeFileSync(join(tmp, 'secret.txt'), SECRET);
  writeFileSync(join(webRoot, 'index.html'), '<html>app</html>');
  writeFileSync(join(webRoot, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(webRoot, 'assets', 'app.css'), 'body{}');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const appWithWeb = () => createApp(serverFixture(), { webRoot });

describe('serving the built web app', () => {
  it('files are served with their content type', async () => {
    const app = appWithWeb();
    const js = await get(app, '/assets/app.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.text).toBe('console.log(1)');
    const css = await get(app, '/assets/app.css');
    expect(css.headers.get('content-type')).toContain('text/css');
    expect((await get(app, '/')).text).toBe('<html>app</html>');
  });

  it('hashed assets are cached for good; the page, its fallback and every API reply are not', async () => {
    const app = appWithWeb();
    expect((await get(app, '/assets/app.js')).headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await get(app, '/')).headers.get('cache-control')).toBe('no-cache');
    expect((await get(app, '/campaigns')).headers.get('cache-control')).toBe('no-cache');
    expect((await get(app, '/api/meta')).headers.get('cache-control')).toBe('no-store');
    expect((await get(app, '/api/nope')).headers.get('cache-control')).toBe('no-store');
    expect((await get(app, '/api/meta', { headers: { Host: 'evil.example' } })).headers.get('cache-control')).toBe('no-store');
  });

  it('a refreshed view path returns the app', async () => {
    const app = appWithWeb();
    expect((await get(app, '/campaigns')).text).toBe('<html>app</html>');
    expect((await get(app, '/campaigns/anything')).text).toBe('<html>app</html>');
  });

  it('a missing asset is a 404, never the app', async () => {
    const result = await get(appWithWeb(), '/assets/missing.js');
    expect(result.status).toBe(404);
    expect(result.text).not.toContain('<html>');
  });

  it('the API never falls back to the app', async () => {
    const app = appWithWeb();
    const missing = await get(app, '/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.json).toMatchObject({ error: { code: 'not_found' } });
    const meta = await get(app, '/api/meta');
    expect(meta.status).toBe(200);
    expect(meta.json).toHaveProperty('hasData');
  });

  it.each(['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/..%5csecret.txt', '/assets/..%2f..%2fsecret.txt', '/..%2f..%2f..%2fpackage.json'])(
    'a path outside the web folder is never served: %s',
    async (path) => {
      const result = await get(appWithWeb(), path);
      expect(result.text).not.toContain(SECRET);
      expect(result.text).not.toContain('"name": "invoca"');
    },
  );

  it('only GET and HEAD get the app; other methods are a 404', async () => {
    const app = appWithWeb();
    const post = await get(app, '/campaigns', { method: 'POST' });
    expect(post.status).toBe(404);
    expect(post.text).not.toContain('<html>');
    expect((await get(app, '/', { method: 'DELETE' })).status).toBe(404);
    const apiPost = await get(app, '/api/meta', { method: 'POST' });
    expect(apiPost.status).toBe(404);
    expect(apiPost.json).toMatchObject({ error: { code: 'not_found' } });
    expect((await get(app, '/campaigns', { method: 'HEAD' })).status).toBe(200);
  });

  it('/api without a trailing slash is the API, not the app', async () => {
    const result = await get(appWithWeb(), '/api');
    expect(result.status).toBe(404);
    expect(result.json).toMatchObject({ error: { code: 'not_found' } });
  });

  it('a rebuilt index.html is served without a restart', async () => {
    const app = appWithWeb();
    expect((await get(app, '/campaigns')).text).toBe('<html>app</html>');
    writeFileSync(join(webRoot, 'index.html'), '<html>rebuilt</html>');
    expect((await get(app, '/campaigns')).text).toBe('<html>rebuilt</html>');
  });

  it('if index.html vanishes after startup, a view path is a plain 404', async () => {
    const app = appWithWeb();
    rmSync(join(webRoot, 'index.html'));
    const result = await get(app, '/campaigns');
    expect(result.status).toBe(404);
    expect(result.headers.get('content-type')).toContain('text/plain');
  });

  it('no build yet', async () => {
    const app = createApp(serverFixture(), { webRoot: join(webRoot, 'does-not-exist') });
    const home = await get(app, '/');
    expect(home.status).toBe(200);
    expect(home.headers.get('content-type')).toContain('text/plain');
    expect(home.text).toContain('/api/meta');
    expect((await get(app, '/campaigns')).status).toBe(404);
    expect((await get(app, '/assets/app.js')).status).toBe(404);
    expect((await get(app, '/api/meta')).status).toBe(200);
  });
});
