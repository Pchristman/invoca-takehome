import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Shared helpers: tests for the Docker files read them as plain text, so a CR is visible.
// Task 4 appends the docker-compose.yml tests below, using the same helpers.
function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function lines(text: string): string[] {
  return text.split('\n').map((l) => l.trim());
}

/** A .dockerignore pattern as a regex over a path relative to the context: "**" crosses folders, "*" and "?" do not. */
function ignoreRegex(pattern: string): RegExp {
  const body = pattern
    .replace(/^\//, '')
    .replace(/[.+^$(){}|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*');
  return new RegExp(`^${body}$`);
}

/** True when .dockerignore would leave out this COPY source: the path itself or any folder above it matches a pattern. */
function isIgnored(source: string, patterns: string[]): boolean {
  const parts = source.replace(/^\.\//, '').replace(/\/$/, '').split('/');
  const prefixes = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  return patterns.some((pattern) => prefixes.some((prefix) => ignoreRegex(pattern).test(prefix)));
}

/** Every source argument of every COPY from the build context (all words after COPY, flags and the destination dropped). */
function contextCopySources(dockerfile: string): string[] {
  return dockerfile
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('COPY ') && !l.includes('--from='))
    .flatMap((l) => l.split(/\s+/).slice(1).filter((word) => !word.startsWith('--')).slice(0, -1));
}

function tsFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? tsFilesUnder(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('Dockerfile and .dockerignore', () => {
  const dockerfile = readText('Dockerfile');
  const dockerignore = readText('.dockerignore');
  const ignoreLines = lines(dockerignore).filter((l) => l !== '' && !l.startsWith('#'));
  const froms = dockerfile.split('\n').filter((l) => l.startsWith('FROM '));
  const copiedFromContext = contextCopySources(dockerfile);
  const gitattributesLines = lines(readText('.gitattributes'));

  it('Dockerfile: two stages on Node 24, the runtime stage is not root', () => {
    expect(froms).toHaveLength(2);
    expect(froms.every((l) => /^FROM node:24(-slim)? /.test(l) || /^FROM node:24(-slim)?$/.test(l))).toBe(true);
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
    expect(dockerfile).not.toMatch(/^COPY (\.|\*) /m);
    expect(dockerfile).not.toMatch(/\.env\b/);
  });

  it('Dockerfile: the AI cache and log folders exist and belong to the runtime user', () => {
    expect(lines(dockerfile)).toContain('RUN mkdir -p .cache logs && chown node:node .cache logs');
  });

  it('.dockerignore keeps secrets, history, build output, AI state and the data out of the context', () => {
    for (const entry of ['node_modules', '.env', '.env.*', '**/.env', '**/.env.*', '.git', 'dist', '.cache', 'logs', 'data', '*.csv', '**/*.csv', 'tests', 'docs']) {
      expect(ignoreLines).toContain(entry);
    }
  });

  it('nothing the Dockerfile COPYs from the context is excluded by .dockerignore', () => {
    expect(copiedFromContext.length).toBeGreaterThan(0);
    for (const source of copiedFromContext) {
      expect(isIgnored(source, ignoreLines), source).toBe(false);
    }
  });

  it('the ignore matcher itself: folders, "**/" and "*.ext" patterns, every COPY source', () => {
    expect(isIgnored('src/x.csv', ['**/*.csv'])).toBe(true);
    expect(isIgnored('x.csv', ['**/*.csv'])).toBe(true);
    expect(isIgnored('src/x.csv', ['*.csv'])).toBe(false); // "*" does not cross folders
    expect(isIgnored('x.csv', ['*.csv'])).toBe(true);
    expect(isIgnored('src/a/.env', ['**/.env'])).toBe(true);
    expect(isIgnored('src/ai', ['src'])).toBe(true);
    expect(isIgnored('src/ai', ['src/core'])).toBe(false);
    expect(contextCopySources('COPY --chown=a b c ./\nCOPY --from=build /x ./y')).toEqual(['b', 'c']);
  });

  it('web-only packages are devDependencies, and nothing the server runs imports them', () => {
    const pkg = JSON.parse(readText('package.json'));
    const webOnly = ['react', 'react-dom', 'recharts', '@fontsource/ibm-plex-sans'];
    for (const name of webOnly) {
      expect(pkg.dependencies).not.toHaveProperty(name);
      expect(pkg.devDependencies).toHaveProperty(name);
    }
    const serverSideImportsOfWebPackages = ['src/server', 'src/core', 'src/ai', 'src/node']
      .flatMap(tsFilesUnder)
      .filter((file) => {
        const text = readText(file);
        return webOnly.some((name) => new RegExp(`from\\s+['"]${name}(/[^'"]*)?['"]|import\\s+['"]${name}(/[^'"]*)?['"]`).test(text));
      });
    expect(serverSideImportsOfWebPackages).toEqual([]);
  });

  it('no CR in the Docker files, and .gitattributes keeps them LF', () => {
    expect(dockerfile).not.toBe('');
    for (const text of [dockerfile, dockerignore]) expect(text).not.toContain('\r');
    for (const line of ['Dockerfile text eol=lf', '.dockerignore text eol=lf', 'docker-compose.yml text eol=lf', '*.csv -text']) {
      expect(gitattributesLines).toContain(line);
    }
  });
});

describe('docker-compose.yml', () => {
  const compose = readText('docker-compose.yml');

  it('compose publishes only on the host loopback, and the container side is fixed at 3000', () => {
    expect(compose).not.toBe('');
    // Every entry under `ports:` counts: short ("- 3000", "- 8080:3000") and long syntax ("- target: 3000").
    const all = compose.split('\n');
    const start = all.findIndex((l) => /^\s*ports:\s*$/.test(l));
    expect(start).toBeGreaterThanOrEqual(0);
    const depth = (l: string) => l.match(/^\s*/)![0].length;
    const entries: string[] = [];
    for (const line of all.slice(start + 1)) {
      const text = line.trim();
      if (text === '' || text.startsWith('#')) continue;
      if (depth(line) < depth(all[start]!) || (depth(line) === depth(all[start]!) && !text.startsWith('-'))) break;
      if (text.startsWith('-')) entries.push(text.replace(/^-\s*/, '').replace(/^"|"$/g, ''));
    }
    expect(entries).toEqual(['127.0.0.1:${PORT:-3000}:3000']);
    expect(compose).not.toMatch(/0\.0\.0\.0:/);
  });

  it('compose passes only the key and the spend limit, by interpolation, with no literal key and no env_file', () => {
    expect(compose).toMatch(/ANTHROPIC_API_KEY: \$\{ANTHROPIC_API_KEY:-\}/);
    expect(compose).toMatch(/AI_SPEND_LIMIT_USD: \$\{AI_SPEND_LIMIT_USD:-\}/);
    expect(compose).not.toMatch(/env_file/);
    expect(compose).not.toMatch(/sk-ant-/);
    // these stay the image's, whatever .env says (comments may name them, so look at YAML keys only)
    expect(compose).not.toMatch(/^\s*(HOST|PORT|DATA_DIR):/m);
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

  it('Dockerfile copies src/db and creates a db folder owned by the runtime user', () => {
    const dockerfile = readText('Dockerfile');
    expect(lines(dockerfile)).toContain('COPY src/db ./src/db');
    expect(lines(dockerfile)).toContain('RUN mkdir -p db && chown node:node db');
  });

  it('Dockerfile sets DB_PATH inside the volume folder, and compose mounts a named volume there', () => {
    expect(readText('Dockerfile')).toMatch(/\bDB_PATH=\/app\/db\/calls\.db\b/);
    expect(compose).toMatch(/- calls-db:\/app\/db/);
    expect(compose).toMatch(/^volumes:[\s\S]*^\s+calls-db:\s*$/m);
  });

  it('compose does not pass DB_PATH through', () => {
    expect(compose).not.toMatch(/^\s*DB_PATH:/m);
    expect(compose).not.toMatch(/\$\{DB_PATH/);
  });

  it('.dockerignore still excludes data (the database file never enters the image)', () => {
    const ignore = lines(readText('.dockerignore')).filter((l) => l !== '' && !l.startsWith('#'));
    expect(ignore).toContain('data');
    expect(isIgnored(['data', 'calls.db'].join('/'), ignore)).toBe(true);
  });

  it('compose has no CR and no build argument', () => {
    expect(compose).not.toContain('\r');
    expect(compose).not.toMatch(/\bargs:/);
  });

  it('the image already holds what uploads need', () => {
    const dockerfile = lines(readText('Dockerfile'));
    expect(dockerfile).toContain('COPY src/db ./src/db');
    expect(dockerfile).toContain('COPY src/server ./src/server');
    const dbFolder = dockerfile.indexOf('RUN mkdir -p db && chown node:node db');
    expect(dbFolder).toBeGreaterThan(-1);
    expect(dbFolder).toBeLessThan(dockerfile.indexOf('USER node'));
    expect(compose).toMatch(/source: \$\{DATA_DIR:-\.\}\s+target: \/data\s+read_only: true/);
    // The database volume is not read-only, so an upload can write to it.
    expect(compose).toMatch(/^\s+- calls-db:\/app\/db$/m);
    expect(compose).not.toMatch(/calls-db:\/app\/db:ro/);
  });
});
