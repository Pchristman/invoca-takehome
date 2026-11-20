// Real Docker checks. Run with `npm run test:docker` (mode "docker"); `npm test` skips this file.
// Safety: the developer's shell may hold a REAL API key, and the shell beats `--env-file`. So every docker
// call gets an environment built by `dockerEnv` below, which sets or removes the key and the other settings.
// Nothing here reads `.env`, prints the environment, or requests /api/takeaway/* while a key is set.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { readExportFromDir } from '../../src/node/readDataDir';
import { createApp } from '../../src/server/app';
import { EXTENDED_TOTALS } from '../snapshot/extendedTotals';

const PROJECT = 'invoca-test';
const SECRET_IMAGE = 'invoca-secret-test';
const NO_KEY = 'tests/docker/fixtures/no-key.env';
const EXTENDED_ENV = 'tests/docker/fixtures/extended.env'; // DATA_DIR=data/extended (relative), HOST, PORT lines
const FAKE_KEY ='tests/docker/fixtures/fake-key.env';
const TZ_OVERRIDE = 'tests/docker/fixtures/tz.override.yml';
const FAKE_KEY_VALUE = 'sk-ant-test-not-a-real-key-0000'; // the same text as in fake-key.env, minus its quotes
const ORIGINAL = 'tests/fixtures/original-export';

const SETTINGS_WE_CONTROL = ['AI_SPEND_LIMIT_USD', 'HOST', 'DATA_DIR', 'PORT', 'TZ'];

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Options {
  envFile?: string;
  files?: string[];
  /** Settings for this run (PORT, DATA_DIR, ...). Everything else we control is removed. */
  env?: Record<string, string>;
  /** The key for this run. A string sets it ('' is no key). `null` removes it, so the env file's key is used. */
  key?: string | null;
  cwd?: string;
  timeout?: number;
}

/** The docker CLI's environment: the host's, minus anything that could change a run, plus what the test sets. */
function dockerEnv(options: Options): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of SETTINGS_WE_CONTROL) delete env[name];
  if (options.key === null) delete env.ANTHROPIC_API_KEY;
  else env.ANTHROPIC_API_KEY = options.key ?? '';
  return { ...env, ...options.env };
}

function compose(args: string[], options: Options = {}): Run {
  const files = (options.files ?? []).flatMap((f) => ['-f', f]);
  const envFile = options.envFile ? ['--env-file', options.envFile] : [];
  const result = spawnSync('docker', ['compose', '-p', PROJECT, ...files, ...envFile, ...args], {
    encoding: 'utf8',
    env: dockerEnv(options),
    cwd: options.cwd,
    timeout: options.timeout ?? 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function docker(args: string[], timeout = 180_000): Run {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    env: dockerEnv({ key: '' }),
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** `compose up -d`, with a free host port unless the test chose one. Returns the port. */
function up(options: Options, port: number = freePort()): { run: Run; port: number } {
  const env = { PORT: String(port), ...options.env };
  return { run: compose(['up', '-d'], { ...options, env }), port };
}

/** An unused port. (Found synchronously by asking a child process, to keep the helpers simple.) */
function freePort(): number {
  const script =
    "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})";
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  return Number(result.stdout.trim());
}

async function waitFor200(url: string, ms = 90_000): Promise<void> {
  const deadline = Date.now() + ms;
  let last = 'no answer';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
      last = `status ${response.status}`;
    } catch {
      last = 'connection failed';
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not answer 200 within ${ms} ms (${last})`);
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
}

async function getText(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url);
  return { status: response.status, body: await response.text() };
}

const base = (port: number) => `http://127.0.0.1:${port}`;

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'invoca-docker-'));
  tempDirs.push(dir);
  return dir;
}

function dockerRunning(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 30_000 }).status === 0;
}

/** Streams `docker save` and reports whether `needle` appears anywhere in the image archive. */
function archiveContains(image: string, needle: string): Promise<boolean> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', ['save', image], { env: dockerEnv({ key: '' }), stdio: ['ignore', 'pipe', 'pipe'] });
    const wanted = Buffer.from(needle);
    let tail: Buffer = Buffer.alloc(0);
    let found = false;
    let scanned = 0;
    let errors = '';
    child.stdout.on('data', (chunk: Buffer) => {
      scanned += chunk.length;
      if (found) return;
      const window = Buffer.concat([tail, chunk]);
      if (window.includes(wanted)) found = true;
      tail = window.subarray(Math.max(0, window.length - wanted.length));
    });
    child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      // A failed or empty save must not look like "the key is not in the image".
      if (code !== 0) reject(new Error(`docker save exited ${code}: ${errors.trim()}`));
      else if (scanned === 0) reject(new Error('docker save produced no bytes to scan'));
      else resolvePromise(found);
    });
  });
}

describe.skipIf(import.meta.env.MODE !== 'docker')('real container', () => {
  beforeAll(() => {
    if (!dockerRunning()) throw new Error('Docker is not running: start Docker Desktop');
    // Clear anything an earlier aborted run left behind, then build once.
    compose(['down', '-v'], { envFile: NO_KEY });
    const build = compose(['build'], { envFile: NO_KEY, timeout: 600_000 });
    if (build.status !== 0) throw new Error(`docker compose build failed:\n${build.stderr}`);
  }, 600_000);

  afterEach(() => {
    compose(['down', '-v'], { envFile: NO_KEY });
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  afterAll(() => {
    compose(['down', '-v', '--rmi', 'local'], { envFile: NO_KEY });
    // `--rmi local` leaves the built image when the project is already down, so remove both images by name.
    docker(['rmi', '-f', SECRET_IMAGE, `${PROJECT}-app`]);
  });

  it('the test helper never lets the host key through: config shows the intended key only', () => {
    const noKey = compose(['config', '--format', 'json'], { envFile: NO_KEY });
    expect(noKey.status).toBe(0);
    // Compared as booleans so a failure can never print a key.
    expect(JSON.parse(noKey.stdout).services.app.environment.ANTHROPIC_API_KEY === '').toBe(true);

    const fake = compose(['config', '--format', 'json'], { envFile: FAKE_KEY, key: null });
    expect(fake.status).toBe(0);
    expect(JSON.parse(fake.stdout).services.app.environment.ANTHROPIC_API_KEY === FAKE_KEY_VALUE).toBe(true);

    // Even if the host had a key, the helper replaces it.
    const env = dockerEnv({ key: '' });
    expect(env.ANTHROPIC_API_KEY === '').toBe(true);
    expect(SETTINGS_WE_CONTROL.every((name) => env[name] === undefined)).toBe(true);
  });

  it('serves all four views with no key: AI off, shipped export read through the CRLF mount', async () => {
    const { run, port } = up({ envFile: NO_KEY });
    expect(run.status).toBe(0);
    const url = base(port);
    await waitFor200(`${url}/api/meta`);
    expect((await getJson(`${url}/api/meta`)).body.callCount).toBe(5000);
    for (const view of ['overview', 'campaigns', 'locations', 'missed-calls']) {
      expect((await getJson(`${url}/api/${view}`)).status).toBe(200);
    }
    const page = await getText(`${url}/`);
    expect(page.status).toBe(200);
    expect(page.body).toContain('id="root"');
    expect((await getJson(`${url}/api/data-notes`)).body.ai.status).toBe('off');
    const takeaway = (await getJson(`${url}/api/takeaway/overview`)).body;
    expect(takeaway.source).toBe('template');
    expect(takeaway.reason).toBe('ai_off');
  }, 180_000);

  it('with a key AI reports on, including a quoted key, and the key is not in the logs', async () => {
    const { run, port } = up({ envFile: FAKE_KEY, key: null });
    expect(run.status).toBe(0);
    await waitFor200(`${base(port)}/api/meta`);
    // No /api/takeaway/* here: with a key set that would call the real API.
    expect((await getJson(`${base(port)}/api/data-notes`)).body.ai.status).toBe('on');
    const logs = compose(['logs'], { envFile: FAKE_KEY, key: null });
    expect(logs.stdout + logs.stderr).not.toContain('sk-ant-test-not-a-real-key');
  }, 180_000);

  it('no .env at all: compose config succeeds with no warning and an empty key', () => {
    const dir = tempDir();
    cpSync('docker-compose.yml', join(dir, 'docker-compose.yml'));
    const result = spawnSync(
      'docker',
      ['compose', '-p', PROJECT, '--project-directory', dir, '-f', join(dir, 'docker-compose.yml'), 'config', '--format', 'json'],
      { encoding: 'utf8', env: dockerEnv({ key: '' }) },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('is not set');
    expect(JSON.parse(result.stdout).services.app.environment.ANTHROPIC_API_KEY === '').toBe(true);
  });

  it('no .env at all: compose up starts the app with AI off', async () => {
    // A project folder with no .env: the compose file (its build pointed at this repo) and a copy of the shipped export.
    const dir = tempDir();
    const repo = resolve('.').replace(/\\/g, '/');
    const text = readFileSync('docker-compose.yml', 'utf8').replace(/^(\s*)build: \.\s*$/m, `$1build: "${repo}"`);
    expect(text).toContain(`build: "${repo}"`);
    writeFileSync(join(dir, 'docker-compose.yml'), text);
    cpSync(ORIGINAL, dir, { recursive: true });
    expect(existsSync(join(dir, '.env'))).toBe(false);

    const port = freePort();
    const env = { ...dockerEnv({ key: '' }), PORT: String(port) };
    const up = spawnSync('docker', ['compose', '-p', PROJECT, '--project-directory', dir, '-f', join(dir, 'docker-compose.yml'), 'up', '-d'], {
      encoding: 'utf8',
      env,
      timeout: 300_000,
    });
    expect(up.status).toBe(0);
    await waitFor200(`${base(port)}/api/meta`);
    expect((await getJson(`${base(port)}/api/meta`)).body.callCount).toBe(5000);
    expect((await getJson(`${base(port)}/api/data-notes`)).body.ai.status).toBe('off');
  }, 300_000);

  it('a relative DATA_DIR in the env file is read from the project folder', async () => {
    const { run, port } = up({ envFile: EXTENDED_ENV });
    expect(run.status).toBe(0);
    await waitFor200(`${base(port)}/api/meta`);
    expect((await getJson(`${base(port)}/api/meta`)).body.callCount).toBe(EXTENDED_TOTALS.calls);
  }, 180_000);

  it('publishes only on the host loopback; the container listens on 0.0.0.0', async () => {
    const config = compose(['config', '--format', 'json'], { envFile: NO_KEY });
    const ports = JSON.parse(config.stdout).services.app.ports;
    expect(ports).toHaveLength(1);
    expect(ports[0].host_ip).toBe('127.0.0.1');
    expect(Number(ports[0].target)).toBe(3000);

    const { run, port } = up({ envFile: NO_KEY });
    expect(run.status).toBe(0);
    const published = compose(['port', 'app', '3000'], { envFile: NO_KEY, env: { PORT: String(port) } });
    expect(published.stdout.trim().startsWith('127.0.0.1:')).toBe(true);
    await waitFor200(`${base(port)}/api/meta`); // reachable, so the server inside is not loopback-only

    const external = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal);
    if (external) {
      const reached = await new Promise<boolean>((done) => {
        const socket = connect({ host: external.address, port, timeout: 2000 });
        socket.on('connect', () => (socket.destroy(), done(true)));
        socket.on('timeout', () => (socket.destroy(), done(false)));
        socket.on('error', () => done(false));
      });
      expect(reached).toBe(false);
    }
  }, 180_000);

  it('a missing data folder: Docker makes it empty, the app prints one Cannot start line and exits non-zero', () => {
    const missing = join(tempDir(), 'does-not-exist');
    const env = { PORT: String(freePort()), DATA_DIR: missing };
    const run = compose(['up', '--exit-code-from', 'app'], { envFile: NO_KEY, env });
    expect(run.status).not.toBe(0);
    const logs = compose(['logs'], { envFile: NO_KEY, env });
    const text = logs.stdout + logs.stderr;
    expect(text).toMatch(/Cannot start: Cannot read \/data\/calls\.csv/);
    expect(text).not.toMatch(/ {4}at /);
  }, 180_000);

  it('a wrong data folder (only campaigns.csv): the Cannot start line names calls.csv', () => {
    const wrong = tempDir();
    cpSync('campaigns.csv', join(wrong, 'campaigns.csv'));
    const env = { PORT: String(freePort()), DATA_DIR: wrong };
    const run = compose(['up', '--exit-code-from', 'app'], { envFile: NO_KEY, env });
    expect(run.status).not.toBe(0);
    const logs = compose(['logs'], { envFile: NO_KEY, env });
    expect(logs.stdout + logs.stderr).toMatch(/Cannot start: .*calls\.csv/);
  }, 180_000);

  it('the host port is taken: compose fails non-zero, nothing is left running, and PORT=<free> works', async () => {
    const holder = createServer();
    await new Promise<void>((done) => holder.listen(0, '127.0.0.1', done));
    try {
      const taken = (holder.address() as { port: number }).port;
      const blocked = up({ envFile: NO_KEY }, taken);
      expect(blocked.run.status).not.toBe(0);
      const ps = compose(['ps', '--format', 'json'], { envFile: NO_KEY, env: { PORT: String(taken) } });
      const running = ps.stdout
        .split('\n')
        .filter((l) => l.trim().startsWith('{'))
        .map((l) => JSON.parse(l))
        .filter((c) => c.State === 'running');
      expect(running).toHaveLength(0);
    } finally {
      await new Promise<void>((done) => holder.close(() => done()));
    }
    const { run, port } = up({ envFile: NO_KEY });
    expect(run.status).toBe(0);
    await waitFor200(`${base(port)}/api/meta`);
  }, 180_000);

  it('DATA_DIR=data/extended serves the extended export', async () => {
    const { run, port } = up({ envFile: NO_KEY, env: { DATA_DIR: 'data/extended' } });
    expect(run.status).toBe(0);
    await waitFor200(`${base(port)}/api/meta`);
    expect((await getJson(`${base(port)}/api/meta`)).body.callCount).toBe(EXTENDED_TOTALS.calls);
  }, 180_000);

  it('the numbers match the host, even with the container in UTC+14', async () => {
    const { run, port } = up({
      envFile: NO_KEY,
      files: ['docker-compose.yml', TZ_OVERRIDE],
      env: { DATA_DIR: ORIGINAL },
    });
    expect(run.status).toBe(0);
    await waitFor200(`${base(port)}/api/meta`);
    const hostApp = createApp(cleanExport(readExportFromDir(ORIGINAL)));
    const paths = [
      '/api/meta',
      '/api/overview?range=all',
      '/api/campaigns?range=all',
      '/api/locations?range=all',
      '/api/missed-calls?range=all',
      '/api/missed-calls/callbacks.csv?range=all',
    ];
    for (const path of paths) {
      const fromContainer = await getText(`${base(port)}${path}`);
      const fromHost = await hostApp.request(path);
      expect(fromContainer.status, path).toBe(200);
      expect(fromHost.status, path).toBe(200);
      expect(fromContainer.body === (await fromHost.text()), path).toBe(true);
    }
  }, 180_000);

  it('the AI cache and call log folders are writable by the app user and survive a restart', () => {
    const write =
      "const fs=require('fs');fs.writeFileSync('.cache/probe','cache-ok');fs.writeFileSync('logs/probe','log-ok')";
    const read = "const fs=require('fs');console.log(fs.readFileSync('.cache/probe','utf8')+'|'+fs.readFileSync('logs/probe','utf8'))";
    const options = { envFile: NO_KEY, env: { PORT: String(freePort()) } };
    const first = compose(['run', '--rm', '--no-deps', 'app', 'node', '-e', write], options);
    expect(first.status).toBe(0);
    expect(compose(['down'], options).status).toBe(0); // no -v: the volumes stay
    const second = compose(['run', '--rm', '--no-deps', 'app', 'node', '-e', read], options);
    expect(second.status).toBe(0);
    expect(second.stdout.trim()).toBe('cache-ok|log-ok');
  }, 180_000);

  // A volume left root-owned by an earlier run. Docker re-applies the image's ownership to an EMPTY volume at every
  // mount, so a root-owned folder only persists when it holds a file: a root-owned log, mode 644 (readable, not
  // writable). The app must then switch AI off at start, so no paid call can go unlogged (Phase 9 fails closed).
  it('a root-owned volume: the app still serves every view, AI reports off', async () => {
    const options = { envFile: FAKE_KEY, key: null as null, env: { PORT: String(freePort()) } };
    const setup =
      'chown root:root /app/logs && chmod 755 /app/logs && touch /app/logs/ai-calls.jsonl && chown root:root /app/logs/ai-calls.jsonl && chmod 644 /app/logs/ai-calls.jsonl';
    const chown = compose(['run', '--rm', '--no-deps', '--user', 'root', '--entrypoint', 'sh', 'app', '-c', setup], options);
    expect(chown.status).toBe(0);
    const { run, port } = up(options, Number(options.env.PORT));
    expect(run.status).toBe(0);
    await waitFor200(`${base(port)}/api/meta`);
    expect((await getJson(`${base(port)}/api/overview`)).status).toBe(200);
    expect((await getJson(`${base(port)}/api/data-notes`)).body.ai.status).toBe('off');
  }, 180_000);

  it('docker compose stop returns in under 8 seconds', async () => {
    const { run, port } = up({ envFile: NO_KEY });
    expect(run.status).toBe(0);
    await waitFor200(`${base(port)}/api/meta`);
    const started = Date.now();
    const stop = compose(['stop'], { envFile: NO_KEY, env: { PORT: String(port) } });
    const elapsed = Date.now() - started;
    expect(stop.status).toBe(0);
    expect(elapsed).toBeLessThan(8000);
  }, 180_000);

  it('the image holds no .env, no key and no data', async () => {
    const copy = tempDir();
    const root = resolve('.');
    const skip = new Set(['node_modules', '.git', 'dist', '.cache', 'logs', '.env']);
    cpSync(root, copy, {
      recursive: true,
      filter: (source) => {
        const rel = source.slice(root.length).replace(/^[\\/]/, '');
        return !rel.split(/[\\/]/).some((part) => skip.has(part));
      },
    });
    writeFileSync(join(copy, '.env'), 'ANTHROPIC_API_KEY=SENTINEL_KEY_9f3a\n');
    expect(existsSync(join(copy, 'calls.csv'))).toBe(true); // the data is in the context, so .dockerignore must keep it out
    mkdirSync(join(copy, 'logs'), { recursive: true });

    const build = docker(['build', '-t', SECRET_IMAGE, copy], 600_000);
    expect(build.status).toBe(0);

    const check = docker([
      'run', '--rm', '--entrypoint', 'sh', SECRET_IMAGE, '-c',
      'test ! -e /app/.env && test ! -e /app/calls.csv && test -z "$(ls -A /data)"',
    ]);
    expect(check.status).toBe(0);
    const history = docker(['history', '--no-trunc', SECRET_IMAGE]);
    expect(history.status).toBe(0);
    expect(history.stdout).toContain('COPY'); // history really listed the layers
    expect(history.stdout + history.stderr).not.toContain('SENTINEL_KEY_9f3a');
    expect(await archiveContains(SECRET_IMAGE, 'SENTINEL_KEY_9f3a')).toBe(false);
  }, 600_000);
});
