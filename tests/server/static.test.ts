import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { get, serverFixture, tempDir } from './helpers';

let webRoot: string;

beforeEach(() => {
  webRoot = tempDir();
  mkdirSync(join(webRoot, 'assets'));
  writeFileSync(join(webRoot, 'index.html'), '<html>app</html>');
  writeFileSync(join(webRoot, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(webRoot, 'assets', 'app.css'), 'body{}');
});

afterEach(() => {
  rmSync(webRoot, { recursive: true, force: true });
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

  it.each(['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/..%5cpackage.json', '/assets/../../package.json'])(
    'a path outside the web folder is never served: %s',
    async (path) => {
      const result = await get(appWithWeb(), path);
      expect(result.text).not.toContain('"name": "invoca"');
    },
  );

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
