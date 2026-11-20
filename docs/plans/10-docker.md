# Phase 10 (Docker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docker compose up --build` builds one image and serves all four views at `http://localhost:3000`, with or without an API key, while `npm start` keeps working unchanged.

**Architecture:** A two-stage `Dockerfile` on Node 24: the first stage builds the web app with Vite; the second installs production dependencies only and runs the same `src/server/cli.ts` that `npm start` runs, with `tsx`. One small code change is needed: the server learns a `HOST` setting (PLAN.md section 6 lists it, the code hard-codes `127.0.0.1`). `docker-compose.yml` has one service: the data folder is mounted read-only, the AI cache and call log live on named volumes, the key is passed in at run time and never built in, and the port is published only on the host's `127.0.0.1`. Static checks on the Docker files run in `npm test`; real Docker checks run with `npm run test:docker`.

**Tech Stack:** Docker with Compose v2, Node 24 (`node:24-slim`), TypeScript, vitest. **No new npm dependency** (no YAML parser: the compose file is checked as text, and by `docker compose config --format json` in the Docker tests).

**Spec:** `PLAN.md` (section 2 non-goals, section 6 "Config" and "Commands", Phase 10 and Phase 11 in section 9, section 10), `docs/BRIEF.md` ("Local only. Docker or plain npm is my call."), `CLAUDE.md` ("Rules that never bend", "AI budget"), `src/server/start.ts`, `src/server/config.ts`, `src/server/cli.ts`, `src/ai/fromEnv.ts` (cache and log paths), `tests/server/start.test.ts` and `tests/server/cli.test.ts` (the style this plan extends).

## Global Constraints

- Work **one task at a time**. After the last task run `npm test`, `npm run typecheck`, `npm run build` and `npm run test:docker`, run the click-through checklist at the end of this file, show the results, then **stop** and wait (CLAUDE.md).
- **Docker Desktop must be running** for Tasks 5 and 6. When this plan was written the daemon was not running (`docker info` failed on the engine pipe). The first build downloads `node:24-slim`.
- No new dependency. `package.json` changes only by moving four web-only packages to `devDependencies` (Task 3) and adding one script, `test:docker` (Task 5).
- `npm start` and `npm run dev` behave exactly as before: with `HOST` unset the server listens on `127.0.0.1` and prints `http://127.0.0.1:<port>`.
- The key is passed at run time only. It is never in the image, a build argument, a layer, a log line, or a file in git. **Never read, print or `git add` `.env`.** Docker tests use `--env-file tests/docker/fixtures/*.env` so the real `.env` is never used or sent.
- **No automated test calls the real API.** A fake key may switch AI "on" in `/api/data-notes`, but no test requests `/api/takeaway/*` with a key set. The with-key check in the final checklist is one real call, run by you.
- Every port is published on `127.0.0.1` only. Nothing in the image depends on a shell script (Windows checkouts, CRLF).
- Commit after each task, small, message says why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage files by name, never `git add -A`. `PLAN.md` and `docs/AI_COST_LOG.md` have uncommitted edits of yours: never stage them. `docs/plans/09-ai-takeaway.md` is untracked and is not part of this phase.
- Do not write to `docs/AI_COST_LOG.md`; do not edit `docs/BRIEF.md`.
- Prefer simple, readable code; a reviewer will walk through all of it.

## Issues found in PLAN.md (decide before or during review)

Each decision is proposed in `docs/DECISIONS.md` (rows dated 2026-11-20, "Phase 10 (proposed)"). The plan follows the proposal until you say otherwise.

1. **`HOST` is in PLAN.md but not in the code.** `start()` hard-codes `127.0.0.1`. Task 1 adds it. One risk: some shells (zsh) define a `HOST` variable holding the machine name. If one were exported, `npm start` would try to listen on that name. The README says so; the name is PLAN.md's, so I kept it.
2. **"A named volume" (singular).** The cache is `.cache/ai-takeaways.json` and the log is `logs/ai-calls.jsonl`, both relative to the working directory. One volume would need a new setting or symlinks (a symlink to a missing folder breaks `mkdir`). Proposed: two named volumes, `ai-cache` and `ai-logs`, mounted at those two folders. No Phase 9 code changes.
3. **"Missing data mount gives the app's own `Cannot start:` line" conflicts with how Docker behaves.** A bind mount whose host folder is missing is **created empty** by Docker (short or long syntax, default settings), so the app then fails with `Cannot start: Cannot read /data/calls.csv ...`. That meets PLAN.md, but a mistyped `DATA_DIR` leaves a stray empty folder on the host. The alternative (`create_host_path: false`) gives Docker's own error, not ours. Proposed: let Docker create it, and say so in the README.
4. **The default `DATA_DIR` is the repo root**, so the default mount shows the container the whole repo folder read-only (including `.env`). The app reads only the three CSVs and the container is local-only. Mounting the three files separately is worse: for a missing file Docker creates a *directory* named `calls.csv`. Kept as a folder mount; stated in the README.
5. **Node as PID 1 ignores `SIGTERM`.** `docker compose stop` would wait 10 s and then kill it. Proposed: `init: true` in Compose (a tiny init process forwards signals) rather than a signal handler in `cli.ts`. Tested.
6. **`docker compose down -v` deletes the call log**, and the spend guard sums spend from that log (PLAN.md section 7), so the guard restarts from $0. Not fixable without changing Phase 9. The README says it: use `docker compose down` (no `-v`) to keep spend and cache.
7. **"With a key (AI on)" needs a real key.** Automated tests use a fake key and check only that AI reports "on". The real call is in the checklist and you run it. A real run costs about $0.0002 per view.
8. **Decided (yours): web-only packages move to `devDependencies`.** `react`, `react-dom`, `recharts` and `@fontsource/ibm-plex-sans` are used only under `src/web` (bundled by Vite), so the runtime image should not install them. Task 3 moves them and checks that no server, core, AI or node code imports them. No package is added or removed.
9. **Decided (your call, "whatever is best"): `docker compose up` stays the documented command and its exit code is not relied on.** Plain `up` may return 0 when the container fails at start, so the README says to read `docker compose logs`, and the test uses `--exit-code-from app` to prove the exit is non-zero.

## Review Focus

Inputs and conditions the spec implies but PLAN.md's edge-case list does not name. Each has a test in the owning task.

1. **A `.env` copied from the `npm start` setup.** It may hold `HOST=127.0.0.1`, `PORT`, and a relative `DATA_DIR`. Inside the container these must not apply (the container listens on 0.0.0.0:3000 and reads `/data`), or the app would be unreachable. `PORT` only picks the host's port; `DATA_DIR` only picks the folder mounted. (Task 5)
2. **A quoted key in `.env`** (`ANTHROPIC_API_KEY="sk-ant-..."`). Compose and `loadDotEnv` parse `.env` separately. A quoted key must still switch AI on in the container. (Task 5)
3. **A volume left root-owned** by an earlier run. The app must still start and serve every view; AI reports "off" (the log is unusable, Phase 9 fails closed), never a crash. (Task 5)
4. **CSVs with CRLF line endings through the mount.** The shipped export is CRLF; the container must read it as 5,000 calls. (Task 5)
5. **`docker compose stop` returns promptly** (under 8 s), not after the 10 s kill timeout. (Task 5)

---

## File Structure

```
src/server/config.ts          modify: parseHost, wildcard check; explainListenError takes the host
package.json, package-lock.json  modify: web-only packages to devDependencies (Task 3)
src/server/start.ts           modify: StartOptions.host; bind to it; url for a wildcard host
.env.example                  modify: document HOST
Dockerfile                    create: two stages, non-root runtime
.dockerignore                 create
docker-compose.yml            create: one service
.gitattributes                modify: keep the Docker files LF
package.json                  modify: "test:docker" script
tests/server/start.test.ts    modify: HOST tests
tests/server/cli.test.ts      modify: bad HOST exits 1
tests/repo-hygiene.test.ts    modify: .env.example lists HOST
tests/snapshot/time-zone-independence.test.ts   create: results do not depend on the process time zone
tests/docker/files.test.ts                      create: static checks on the Docker files (runs in npm test)
tests/docker/docker.integration.test.ts         create: real Docker checks (npm run test:docker only)
tests/docker/fixtures/no-key.env, fake-key.env, tz.override.yml   create
README.md                     modify: Docker section, HOST row
docs/DECISIONS.md             modify: Phase 10 rows (already added with this plan)
```

---

### Task 1: A `HOST` setting for the server

**Files:**
- Modify: `src/server/config.ts`, `src/server/start.ts`, `.env.example`
- Test: `tests/server/start.test.ts`, `tests/server/cli.test.ts`, `tests/repo-hygiene.test.ts`

**Interfaces:**
- Consumes: `parsePort`, `explainListenError(error, port)`, `start(options)`, `RunningServer` as they are today.
- Produces:
  - `parseHost(value: string | undefined): string` in `config.ts`: unset, blank or whitespace gives `'127.0.0.1'`; otherwise the trimmed text.
  - `explainListenError(error: NodeJS.ErrnoException, port: number, host?: string): Error`: `host` defaults to `'127.0.0.1'`. For `EADDRNOTAVAIL`, `ENOTFOUND` or `EINVAL` with a non-default host, the message names `HOST` and the value: `HOST "<host>" is not an address this machine can listen on. Set HOST to 127.0.0.1, or 0.0.0.0 inside a container.` With the default host the existing messages are unchanged.
  - `StartOptions.host?: string`: omitted means `parseHost(process.env.HOST)`.
  - `RunningServer.url`: `http://127.0.0.1:<port>` for the default; for the wildcard hosts `0.0.0.0` and `::`, `http://localhost:<port>` (a wildcard address is not a place a browser can go); for any other host, `http://<host>:<port>`. `RunningServer.host` stays the address the socket really bound.

- [ ] **Step 1: Write the failing tests** in `tests/server/start.test.ts` (inside the existing `describe`, same helpers):

```ts
it('parseHost: unset, blank and whitespace give loopback; a value is trimmed', () => {
  expect(parseHost(undefined)).toBe('127.0.0.1');
  expect(parseHost('')).toBe('127.0.0.1');
  expect(parseHost('   ')).toBe('127.0.0.1');
  expect(parseHost(' 0.0.0.0 ')).toBe('0.0.0.0');
});

it('start({ host: "0.0.0.0" }) listens on all interfaces and prints a browsable url', async () => {
  const server = await startServer(SHIPPED, 0, '0.0.0.0'); // add an optional host parameter to the helper
  expect(server.host).toBe('0.0.0.0');
  expect(server.url).toBe(`http://localhost:${server.port}`);
  expect((await fetch(`http://127.0.0.1:${server.port}/api/meta`)).status).toBe(200);
});

it('HOST in the environment is used when no host option is given', async () => {
  vi.stubEnv('HOST', '0.0.0.0');
  const server = await startServer(SHIPPED);
  expect(server.host).toBe('0.0.0.0');
});

it('a HOST this machine cannot bind is a ConfigError that names HOST', async () => {
  // 203.0.113.0/24 is reserved for documentation (TEST-NET-3): no machine has it.
  await expect(start({ dataDir: SHIPPED, port: 0, host: '203.0.113.7' })).rejects.toThrow(/HOST "203\.0\.113\.7"/);
  await expect(start({ dataDir: SHIPPED, port: 0, host: '203.0.113.7' })).rejects.toBeInstanceOf(ConfigError);
});

it('explainListenError: a non-default host names HOST; the default host keeps the old message', () => {
  const err = Object.assign(new Error('x'), { code: 'EADDRNOTAVAIL' }) as NodeJS.ErrnoException;
  expect(explainListenError(err, 3000, '10.1.2.3').message).toContain('HOST "10.1.2.3"');
  expect(explainListenError(err, 3000).message).toContain('Port 3000 cannot be used');
});
```

In `tests/server/cli.test.ts`:

```ts
it('a HOST this machine cannot bind exits 1 with one Cannot start line naming HOST', () => {
  const result = runCli({ DATA_DIR: 'tests/fixtures/original-export', PORT: '3998', HOST: '203.0.113.7' });
  expect(result.status).toBe(1);
  expect(result.stderr.startsWith('Cannot start: HOST "203.0.113.7"')).toBe(true);
  expect(result.stderr).not.toMatch(/^\s+at /m);
});
```

In `tests/repo-hygiene.test.ts`, add `'HOST'` to the variable list in the `.env.example` test, and assert `/^HOST=127\.0\.0\.1\s*$/m`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/server/start.test.ts tests/server/cli.test.ts tests/repo-hygiene.test.ts`
Expected: FAIL (`parseHost` is not exported; `.env.example` has no `HOST`).

- [ ] **Step 3: Implement** `parseHost` and the `explainListenError` change in `src/server/config.ts`; in `src/server/start.ts` pass `hostname: options.host ?? parseHost(process.env.HOST)` to `serve`, pass the same host to `explainListenError`, and build `url` as described under Produces. Add `HOST=127.0.0.1` to `.env.example` with a comment: leave it alone on your own machine; the Docker image sets 0.0.0.0 inside the container and Compose publishes only on your 127.0.0.1.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/server tests/repo-hygiene.test.ts`
Expected: PASS, including the unchanged "listens on loopback only" test.

- [ ] **Step 5: Commit**

```bash
git add src/server/config.ts src/server/start.ts .env.example tests/server/start.test.ts tests/server/cli.test.ts tests/repo-hygiene.test.ts
git commit -m "feat: HOST setting, so a container can listen on all interfaces while npm start stays on loopback"
```

---

### Task 2: Results do not depend on the process time zone

PLAN.md edge case: "the numbers match `npm start` on the host". The code derives local dates from each office's IANA zone through `Intl`, so the container's `TZ` should not matter. This task proves it without Docker; Task 5 repeats it against a real container.

**Files:**
- Test: `tests/snapshot/time-zone-independence.test.ts` (create)

**Interfaces:**
- Consumes: `readExportFromDir`, `cleanExport`, `createApp(store, { webRoot })` (see `tests/server/helpers.ts` for how tests call `app.request`), the shipped export at `tests/fixtures/original-export` and the extended export at `data/extended`.
- Produces: nothing later tasks need.

- [ ] **Step 1: Write the test.** For each of `['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Phoenix']` (UTC+14, UTC-11, a no-DST zone): set `process.env.TZ`, rebuild the store from each export, and collect the JSON text of `/api/meta`, `/api/overview?range=all`, `/api/campaigns?range=all`, `/api/locations?range=all`, `/api/missed-calls?range=all` and the body of `/api/missed-calls/callbacks.csv?range=all`. Assertions:

```ts
it('the process time zone really changed (so the comparison below is not vacuous)', () => {
  process.env.TZ = 'Pacific/Kiritimati';
  expect(new Date(Date.UTC(2026, 0, 1, 12)).getDate()).toBe(2); // UTC+14: noon UTC is 02:00 the next day
  process.env.TZ = 'UTC';
  expect(new Date(Date.UTC(2026, 0, 1, 12)).getDate()).toBe(1);
});

it.each(['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Phoenix'])(
  'every endpoint returns the same bytes under TZ=%s as under TZ=UTC, on both exports',
  (zone) => { expect(bodiesUnder(zone)).toEqual(bodiesUnder('UTC')); },
);
```

Restore the original `TZ` in `afterAll`. If assigning `process.env.TZ` does not change the zone on Windows, run the same collection in a child process (`spawnSync(process.execPath, ['--import', TSX, script], { env: { ...process.env, TZ } })`, as `tests/server/cli.test.ts` does) and keep the sanity assertion.

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/snapshot/time-zone-independence.test.ts`
Expected: PASS. If a body differs, a code path uses the host's zone: find it (look for `getHours`, `getDate`, `toLocale*`, `getTimezoneOffset`; a search of `src/` found none when this plan was written), fix it in the core, and record the fix in `docs/DECISIONS.md`.

- [ ] **Step 3: Commit**

```bash
git add tests/snapshot/time-zone-independence.test.ts
git commit -m "test: every endpoint returns identical results whatever the process time zone, so a container's TZ cannot change numbers"
```

---

### Task 3: Dockerfile, `.dockerignore`, line-ending rules

**Files:**
- Create: `Dockerfile`, `.dockerignore`
- Modify: `.gitattributes`, `package.json`, `package-lock.json`
- Test: `tests/docker/files.test.ts` (create)

**Interfaces:**
- Consumes: `npm run build` output in `dist/` (the server's default web root is `dist` relative to the working directory); `src/server/cli.ts` as the entry; the image reads `HOST`, `PORT`, `DATA_DIR`, `ANTHROPIC_API_KEY`, `AI_SPEND_LIMIT_USD` from its environment.
- Produces: an image whose working directory is `/app`, listening on `0.0.0.0:3000`, reading CSVs from `/data`, running as the `node` user, with `/app/.cache` and `/app/logs` pre-created and owned by `node` (so a named volume mounted there first inherits that ownership). Task 4 relies on these paths and on port 3000.

- [ ] **Step 1: Write the failing static tests** in `tests/docker/files.test.ts`. They read the files as text; `readText(path)` strips nothing, so a CR is visible:

```ts
it('Dockerfile: two stages on Node 24, the runtime stage is not root', () => {
  expect(froms).toHaveLength(2);                          // lines starting with FROM
  expect(froms.every((l) => /^FROM node:24(-slim)? /.test(l))).toBe(true);
  expect(froms[0]).toMatch(/ AS build$/);
  expect(dockerfile).toMatch(/^USER node$/m);
});
it('Dockerfile: the image itself listens on all interfaces, port 3000, and reads /data', () => {
  expect(dockerfile).toMatch(/^ENV .*\bHOST=0\.0\.0\.0\b/m);
  expect(dockerfile).toMatch(/\bPORT=3000\b/);
  expect(dockerfile).toMatch(/\bDATA_DIR=\/data\b/);
});
it('Dockerfile: CMD is the exec form and no shell script is involved (CRLF-safe on Windows checkouts)', () => {
  expect(dockerfile).toMatch(/^CMD \[".*"\]$/m);
  expect(dockerfile).not.toMatch(/ENTRYPOINT|\.sh\b/);
});
it('Dockerfile: no key, secret or .env reaches the image', () => {
  expect(dockerfile).not.toMatch(/ANTHROPIC|API_KEY|SECRET/i);
  expect(dockerfile).not.toMatch(/^COPY (\.|\*) /m);       // no blanket copy of the context
  expect(dockerfile).not.toMatch(/\.env\b/);
});
it('Dockerfile: the AI cache and log folders exist and belong to the runtime user', () => {
  expect(dockerfile).toMatch(/\.cache/); expect(dockerfile).toMatch(/\blogs\b/); expect(dockerfile).toMatch(/chown/);
});
it('.dockerignore keeps secrets, history, build output, AI state and the data out of the context', () => {
  for (const entry of ['node_modules', '.env', '.env.*', '.git', 'dist', '.cache', 'logs', 'data', '*.csv', 'tests', 'docs']) {
    expect(ignoreLines).toContain(entry);
  }
});
it('nothing the Dockerfile COPYs from the context is excluded by .dockerignore', () => {
  for (const source of copiedFromContext) expect(ignoreLines.some((l) => l === source || source.startsWith(`${l}/`))).toBe(false);
});
it('web-only packages are devDependencies, and nothing the server runs imports them', () => {
  const pkg = JSON.parse(readText('package.json'));
  for (const name of ['react', 'react-dom', 'recharts', '@fontsource/ibm-plex-sans']) {
    expect(pkg.dependencies).not.toHaveProperty(name);
    expect(pkg.devDependencies).toHaveProperty(name);
  }
  // every .ts file under src/server, src/core, src/ai, src/node: no import of those four packages
  expect(serverSideImportsOfWebPackages).toEqual([]);
});
it('no CR in the Docker files, and .gitattributes keeps them LF', () => {
  for (const text of [dockerfile, dockerignore]) expect(text).not.toContain('\r');
  for (const line of ['Dockerfile text eol=lf', '.dockerignore text eol=lf', 'docker-compose.yml text eol=lf', '*.csv -text']) {
    expect(gitattributesLines).toContain(line);
  }
});
```

(`copiedFromContext` is the first path argument of every `COPY` that has no `--from=`.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/docker/files.test.ts`
Expected: FAIL (files do not exist).

- [ ] **Step 3a: Move `react`, `react-dom`, `recharts` and `@fontsource/ibm-plex-sans` from `dependencies` to `devDependencies`** in `package.json`, then run `npm install --package-lock-only` so the lock file agrees. Run `npm run build` and `npm test` to confirm nothing else needed them at run time.

- [ ] **Step 3: Write `Dockerfile`.** Build stage: `FROM node:24-slim AS build`, `WORKDIR /app`, copy `package.json` and `package-lock.json`, `RUN npm ci`, copy `index.html`, `vite.config.ts`, `tsconfig.json`, `src`, then `RUN npx vite build`. Runtime stage: `FROM node:24-slim`, `ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data`, `WORKDIR /app`, copy the two package files, `RUN npm ci --omit=dev`, copy `tsconfig.json` and only `src/ai`, `src/core`, `src/node`, `src/server` (the server imports nothing from `src/web`), `COPY --from=build /app/dist ./dist`, `RUN mkdir -p .cache logs && chown node:node .cache logs`, `USER node`, `EXPOSE 3000`, `CMD ["node", "--import", "tsx", "src/server/cli.ts"]` (the same command `npm start` runs after its build, without `npm` in between).

- [ ] **Step 4: Write `.dockerignore`**: exactly the entries the test lists, one per line, plus `.claude`, `.superpowers`, `NOTES.local.md`, `scripts`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`.

- [ ] **Step 5: Add three lines to `.gitattributes`**: `Dockerfile text eol=lf`, `.dockerignore text eol=lf`, `docker-compose.yml text eol=lf`. Keep the existing `*.csv -text` line and its comment.

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run tests/docker/files.test.ts tests/repo-hygiene.test.ts`
Expected: PASS.

- [ ] **Step 7: Build the image once by hand**

Run: `docker build -t invoca-check .`
Expected: succeeds. Then `docker run --rm --entrypoint sh invoca-check -c "id -un && ls /app && ls -la /app/.cache /app/logs"` prints `node`, shows `dist` and `src`, and shows both folders owned by `node`.

- [ ] **Step 8: Commit**

```bash
git add Dockerfile .dockerignore .gitattributes package.json package-lock.json tests/docker/files.test.ts
git commit -m "feat: multi-stage Dockerfile that runs the same server as npm start, as a non-root user, with no key or .env inside"
```

---

### Task 4: `docker-compose.yml`

**Files:**
- Create: `docker-compose.yml`
- Test: `tests/docker/files.test.ts` (add)

**Interfaces:**
- Consumes: the image from Task 3 (port 3000, `/data`, `/app/.cache`, `/app/logs`).
- Produces: a Compose project named `inbound-calls` with one service `app`; named volumes `ai-cache` and `ai-logs`. Task 5 uses the service name `app`, the project's `PORT`/`DATA_DIR` interpolation, and `--env-file`.

- [ ] **Step 1: Write the failing static tests** (same file; `compose` is the file's text):

```ts
it('compose publishes only on the host loopback, and the container side is fixed at 3000', () => {
  const ports = [...compose.matchAll(/^\s*-\s*"?(\d[^"\s]*:\d+)"?\s*$/gm)].map((m) => m[1]);
  expect(ports).toEqual(['127.0.0.1:${PORT:-3000}:3000']);
  expect(compose).not.toMatch(/0\.0\.0\.0:/);
});
it('compose passes only the key and the spend limit, by interpolation, with no literal key and no env_file', () => {
  expect(compose).toMatch(/ANTHROPIC_API_KEY: \$\{ANTHROPIC_API_KEY:-\}/);
  expect(compose).toMatch(/AI_SPEND_LIMIT_USD: \$\{AI_SPEND_LIMIT_USD:-\}/);
  expect(compose).not.toMatch(/env_file/);
  expect(compose).not.toMatch(/sk-ant-/);
  expect(compose).not.toMatch(/\b(HOST|PORT|DATA_DIR):/);   // these stay the image's, whatever .env says
});
it('compose mounts the data folder read-only and puts the AI cache and log on named volumes', () => {
  expect(compose).toMatch(/source: \$\{DATA_DIR:-\.\}\s+target: \/data\s+read_only: true/);
  expect(compose).toMatch(/- ai-cache:\/app\/\.cache/);
  expect(compose).toMatch(/- ai-logs:\/app\/logs/);
});
it('compose uses an init process so SIGTERM stops the server at once, and does not restart a failed start', () => {
  expect(compose).toMatch(/^\s+init: true$/m);
  expect(compose).not.toMatch(/restart:/);
});
it('compose has no CR and no build argument', () => {
  expect(compose).not.toContain('\r');
  expect(compose).not.toMatch(/\bargs:/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/docker/files.test.ts`
Expected: FAIL (no compose file).

- [ ] **Step 3: Write `docker-compose.yml`.** Top-level `name: inbound-calls`. Service `app`: `build: .`, `init: true`, `ports` with the one string above, `environment` with the two interpolated variables, `volumes` with the long-syntax read-only bind (`type: bind`, `source: ${DATA_DIR:-.}`, `target: /data`, `read_only: true`; long syntax so a Windows path with a colon is not misread) and the two named volumes. Top-level `volumes:` declares `ai-cache` and `ai-logs`. A short comment above each non-obvious line says why (publish on loopback; why `PORT` is only the host side; why the image's `HOST`, `PORT` and `DATA_DIR` are not overridden).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/docker/files.test.ts`
Expected: PASS.

- [ ] **Step 5: Check it parses** (no containers started)

Run: `docker compose --env-file tests/docker/fixtures/no-key.env config` (create the fixture here if Task 5 has not: one line, `ANTHROPIC_API_KEY=`)
Expected: exit 0, no "variable is not set" warning, the port shown as host IP `127.0.0.1`.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml tests/docker/files.test.ts tests/docker/fixtures/no-key.env
git commit -m "feat: compose file, one command to run the app, published on loopback only, data read-only, AI state on volumes"
```

---

### Task 5: Real Docker checks (`npm run test:docker`)

**Files:**
- Create: `tests/docker/docker.integration.test.ts`, `tests/docker/fixtures/fake-key.env`, `tests/docker/fixtures/tz.override.yml`
- Modify: `tests/docker/fixtures/no-key.env`, `package.json`

**Interfaces:**
- Consumes: Task 3 and 4 files; `EXTENDED_TOTALS` from `tests/snapshot/extendedTotals.ts`; `createApp`, `cleanExport`, `readExportFromDir` for the host-side comparison.
- Produces: `npm run test:docker`. The integration file is skipped in `npm test` unless run in mode `docker`.

The file's helpers (names only; bodies are the implementer's): `compose(args, { envFile, files?, env? })` runs `docker compose -p invoca-test --env-file <envFile> ...` with `spawnSync` and returns `{ status, stdout, stderr }`; `freePort()` asks the OS for one; `waitFor200(url, ms)` polls `/api/meta`; `getJson(url)`. `describe.skipIf(import.meta.env.MODE !== 'docker')` wraps everything; `beforeAll` fails with "Docker is not running: start Docker Desktop" if `docker info` fails, then builds once (timeout 10 minutes); `afterEach` runs `compose down -v` and removes temp folders; `afterAll` removes the test images.

Fixtures: `no-key.env` = `ANTHROPIC_API_KEY=` and `HOST=127.0.0.1` (a `.env` copied from the `npm start` setup, Review Focus 1); `fake-key.env` = `ANTHROPIC_API_KEY="sk-ant-test-not-a-real-key-0000"` with quotes (Review Focus 2); `tz.override.yml` sets `services.app.environment.TZ: Pacific/Kiritimati`.

`package.json`: `"test:docker": "vitest run tests/docker/docker.integration.test.ts --mode docker"`. If vitest does not expose the mode through `import.meta.env.MODE`, replace with a four-line `scripts/test-docker.ts` that sets `DOCKER_TESTS=1` and runs vitest, and check that variable instead.

- [ ] **Step 1: Write the tests.** Each is one `it`, named for the PLAN.md edge case or Review Focus it covers. Use `PORT=<freePort()>` from the test's environment (the shell wins over the env file, as with `npm start`).

```ts
it('serves all four views with no key: AI off, shipped export read through the CRLF mount', async () => {
  // up -d with no-key.env, DATA_DIR unset (the repo folder); wait for /api/meta
  // GET /api/meta: callCount === 5000                                    (Review Focus 4)
  // GET /api/overview, /api/campaigns, /api/locations, /api/missed-calls: all 200
  // GET /: 200 and HTML contains the app root element
  // GET /api/data-notes: ai.status === 'off'
  // GET /api/takeaway/overview: { source: 'template', reason: 'ai_off' }
  // the .env's HOST=127.0.0.1 did not stop the container being reachable    (Review Focus 1)
});
it('with a key AI reports on, including a quoted key, and the key is not in the logs', async () => {
  // up -d with fake-key.env; wait; GET /api/data-notes: ai.status === 'on'   (Review Focus 2)
  // `compose logs` does not contain "sk-ant-test-not-a-real-key"
  // does NOT request any /api/takeaway/* (that would call the real API with a fake key)
});
it('no .env at all: compose config succeeds with no warning and an empty key', () => {
  // temp folder holding only a copy of docker-compose.yml, no .env:
  // `docker compose --project-directory <tmp> config --format json` exits 0, stderr has no "is not set",
  // services.app.environment.ANTHROPIC_API_KEY === ''
});
it('publishes only on the host loopback; the container listens on 0.0.0.0', async () => {
  // `compose config --format json`: services.app.ports[0].host_ip === '127.0.0.1', target 3000
  // after up: `docker compose port app 3000` starts with '127.0.0.1:'
  // reachable through the published port (so the in-container server is not loopback-only)
  // if the machine has a non-loopback IPv4 address (os.networkInterfaces), connecting to it on that port is refused
});
it('a missing data folder: Docker makes it empty, the app prints one Cannot start line and exits non-zero', async () => {
  // DATA_DIR=<tmp>/does-not-exist; `compose up --exit-code-from app` exits non-zero
  // `compose logs` contains a line starting "Cannot start: Cannot read /data/calls.csv" and no "    at " stack frame
});
it('a wrong data folder (only campaigns.csv): the Cannot start line names calls.csv', async () => {});
it('the host port is taken: compose fails non-zero, nothing is left running, and PORT=<free> works', async () => {
  // hold a free port with net.createServer on 127.0.0.1; `compose up -d` with PORT=<that> exits non-zero;
  // `compose ps --format json` lists no running container; then PORT=<another free> serves /api/meta
});
it('DATA_DIR=data/extended serves the extended export', async () => {
  // relative path, resolved against the project folder: /api/meta callCount === EXTENDED_TOTALS.calls (6400)
});
it('the numbers match the host, even with the container in UTC+14', async () => {
  // up with `-f docker-compose.yml -f tests/docker/fixtures/tz.override.yml`, DATA_DIR=tests/fixtures/original-export
  // for /api/meta, overview, campaigns, locations, missed-calls (range=all) and callbacks.csv:
  //   the container's response body === createApp(cleanExport(readExportFromDir(original))).request(sameUrl) body
});
it('the AI cache and call log folders are writable by the app user and survive a restart', async () => {
  // `compose run --rm --no-deps app node -e <write .cache/probe and logs/probe>` exits 0 (runs as node)
  // `compose down` (no -v); run again: both probe files still hold their text
});
it('a root-owned volume: the app still serves every view, AI reports off', async () => {
  // run as root once to `chown root:root /app/logs && chmod 755 /app/logs`, then up with fake-key.env:
  // /api/overview is 200; /api/data-notes ai.status === 'off'                (Review Focus 3)
});
it('docker compose stop returns in under 8 seconds', async () => {
  // up -d, wait, time `compose stop`; elapsed < 8000 ms                       (Review Focus 5)
});
it('the image holds no .env, no key and no data', async () => {
  // copy the repo (not node_modules, .git, dist, .cache, logs, .env) to a temp folder and add a .env containing
  // SENTINEL_KEY_9f3a; `docker build` that folder as invoca-secret-test; then:
  //   `docker run --rm --entrypoint sh invoca-secret-test -c 'test ! -e /app/.env && test ! -e /app/calls.csv && test -z "$(ls -A /data)"'` exits 0
  //   `docker history --no-trunc invoca-secret-test` does not contain SENTINEL_KEY_9f3a
  //   a streamed scan of `docker save invoca-secret-test` does not contain SENTINEL_KEY_9f3a
});
```

- [ ] **Step 2: Run them; fix what they find**

Run: `npm run test:docker`
Expected: PASS for all. Each failure is a real finding about the Dockerfile or Compose file; fix it there, not in the test, and add the reason to `docs/DECISIONS.md` if it changes a decision. Report anything you had to change.

- [ ] **Step 3: Run the normal suite**

Run: `npm test`
Expected: PASS; the integration file shows as skipped (say so in the results, do not call it passing).

- [ ] **Step 4: Commit**

```bash
git add tests/docker package.json
git commit -m "test: run the real container end to end (loopback publish, bad mounts, time zone, volumes, no secrets in the image)"
```

---

### Task 6: README, decisions, final run

**Files:**
- Modify: `README.md`, `docs/DECISIONS.md` (only to fix a row that Task 5 proved wrong or to add one it forced)

- [ ] **Step 1: README.** Add `docker compose up --build` and `npm run test:docker` to the Commands table, `HOST` to the config description, and a **Docker** section covering:
  - the one command, and that `.env` is optional (no `.env` means AI off);
  - open `http://localhost:3000`; to use another host port: `PORT=3001 docker compose up --build` (PowerShell: `$env:PORT=3001; docker compose up --build`), or set `PORT` in `.env`; inside the container the server is always on 3000;
  - the extended export: `DATA_DIR=data/extended docker compose up --build`; `DATA_DIR` picks the folder mounted read-only at `/data`; use forward slashes on Windows; a mistyped folder is created empty by Docker and the app then says `Cannot start: ...` (`docker compose logs`);
  - the default mount shows the container the whole repo folder, read-only; the app reads only the three CSVs;
  - the server listens on all interfaces **inside** the container and Compose publishes it only on your machine's `127.0.0.1`, so the callback list is not exposed to the network; never change the port line to `0.0.0.0`;
  - new data means `docker compose restart` (the data is read once at start, like `npm start`);
  - AI cache and call log live on volumes `ai-cache` and `ai-logs`: `docker compose down` keeps them; **`docker compose down -v` deletes the call log, so the spend guard counts from $0 again**; to read the log: `docker compose run --rm app cat logs/ai-calls.jsonl`;
  - the key comes from `.env` at run time and is never in the image; a shell `ANTHROPIC_API_KEY` wins over `.env`, as with `npm start`;
  - `HOST` warning from Issue 1 (a shell that exports `HOST` with the machine name);
  - a failing start: plain `docker compose up` may exit 0, so read `docker compose logs`.

- [ ] **Step 2: Final verification**

Run, and show the output of each:
  - `npm test` (state how many tests ran and how many were skipped)
  - `npm run typecheck`
  - `npm run build`
  - `npm run test:docker`
  - `npm start` in another terminal, `curl http://127.0.0.1:3000/api/meta` returns `callCount` 5000, then stop it (proves `npm start` still works outside Docker)
  - `git status --short` shows only files this phase touched plus your own uncommitted `PLAN.md`, `docs/AI_COST_LOG.md`; no `.env`

- [ ] **Step 3: Commit**

```bash
git add README.md docs/DECISIONS.md
git commit -m "docs: how to run in Docker, the port and data overrides, and that down -v resets the spend count"
```

---

## Click-through checklist (run in the browser, show the results, then stop)

1. On a clean clone with **no `.env`** (note: your shell's exported `ANTHROPIC_API_KEY` beats `.env`, so unset it first, PowerShell: `Remove-Item Env:ANTHROPIC_API_KEY`, or the "template" check will make real API calls): `docker compose up --build`; open `http://localhost:3000`; Overview, Campaigns, Locations and Missed calls all load; takeaways read "template".
2. `DATA_DIR=data/extended docker compose up --build`: Locations flags offices; the header's call total differs from the shipped export.
3. `PORT=3001 docker compose up --build`: the app answers at `http://localhost:3001` and not at 3000.
4. From another device on the same network (or this machine's LAN address), the app is **not** reachable.
5. With your real key in `.env` (you run this; I do not): `docker compose up --build`; open each view once; takeaways read "AI"; reload a view and it is a cache hit; `docker compose run --rm app cat logs/ai-calls.jsonl` has one line per call; `docker compose down` then `up` again keeps the cache. Record the spend in `docs/AI_COST_LOG.md` yourself.
6. `docker compose logs` after a mistyped `DATA_DIR` shows the single `Cannot start:` line.
7. `npm start` outside Docker still serves the app at `http://127.0.0.1:3000`.

## Self-review against PLAN.md Phase 10

- **Delivers:** multi-stage Node 24 `Dockerfile` (Task 3); `docker-compose.yml` with one service (Task 4); `.dockerignore` with at least `node_modules`, `.env`, `.git`, `dist`, cache and log (Task 3); data read-only at `DATA_DIR`, AI state on named volumes (Task 4; two volumes, Issue 2); key at run time (Tasks 3, 4, 5); `npm start` unchanged (Tasks 1, 6).
- **Done when:** serves four views with and without a key (Task 5 automated with a fake key; real key in the checklist); `npm test` passes and `npm start` works (Task 6); no `.env` or key in the image (Tasks 3, 5); README (Task 6).
- **Edge cases, one test each:**
  - loopback publish and 0.0.0.0 inside: Task 1 (`HOST`), Task 4 (static), Task 5 (published host IP, reachable, LAN refused);
  - no `.env`: Task 5 (config in a folder without one; `no-key.env` run);
  - missing or wrong mount: Task 5 (two tests);
  - port 3000 taken, `PORT` override: Task 5;
  - extended export: Task 5;
  - same numbers whatever the time zone: Task 2 (in process), Task 5 (container at UTC+14 against the host);
  - Windows and CRLF: Task 3 (no shell scripts, exec-form `CMD`, `eol=lf`, no CR) and Review Focus 4 (CRLF CSVs through the mount).
- **Type consistency:** `parseHost`, `explainListenError(error, port, host?)` and `StartOptions.host` are defined in Task 1 and used only there.
- **Proportion:** PLAN.md's Phase 10 is about 20 lines; this plan is longer because most of its length is the 13 container tests, listed as comments with their assertions rather than as code.
