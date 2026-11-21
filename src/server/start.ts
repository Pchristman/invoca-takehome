import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import type { CallStore } from '../core/types';
import { loadStore } from '../db/prepare';
import { createUploadService } from '../db/upload/service';
import { createAiFromEnv, knownNamesFrom, snapshotId } from '../ai/fromEnv';
import type { TakeawayService } from '../ai/service';
import { createApp } from './app';
import { allowedHostFor, explainListenError, parseDbPath, parseHost, parsePort } from './config';

export interface StartOptions {
  /** The export folder. Omitted: DATA_DIR, else the current directory (see readExportFromDir). */
  dataDir?: string;
  /** The SQLite file. Omitted: a private in-memory database when dataDir is given, else DB_PATH, else data/calls.db. */
  dbPath?: string;
  /** 0 picks a free port (tests). Omitted: PORT, else 3000. */
  port?: number;
  /** The address to listen on. Omitted: HOST, else 127.0.0.1 (loopback only). */
  host?: string;
  /** The built web app's folder. */
  webRoot?: string;
  /** The takeaway service. Omitted: built from the environment (AI off without ANTHROPIC_API_KEY). */
  ai?: TakeawayService;
}

export interface RunningServer {
  /** The address the socket really bound to (not the requested one). */
  host: string;
  port: number;
  url: string;
  /** The store as loaded at start-up: it does not follow uploads (only cli.ts reads it, once, at start). */
  store: CallStore;
  /** One-line messages for the person starting the app: what was seeded, a data folder that is not what the database holds. */
  notices: string[];
  close(): Promise<void>;
}

/** An explicit dataDir with no dbPath means "seed a private in-memory database from that folder" (tests, one-off runs). */
function resolveDbPath(options: StartOptions): string {
  if (options.dbPath !== undefined) return options.dbPath;
  if (options.dataDir?.trim()) return ':memory:';
  return parseDbPath(process.env.DB_PATH);
}

/** The only code that opens the database, opens a port or reads PORT and DB_PATH. It does not read .env (cli.ts does). Throws LoadError (data) or ConfigError (port). */
export async function start(options: StartOptions = {}): Promise<RunningServer> {
  const requested = options.port ?? parsePort(process.env.PORT);
  const { store, notices, database } = loadStore({ dbPath: resolveDbPath(options), dataDir: options.dataDir });
  const requestedHost = options.host ?? parseHost(process.env.HOST);
  let server: ReturnType<typeof serve>;
  try {
    // An injected service is kept as it is (it is not ours to rebuild). Our own shares its spend ledger with each rebuild.
    const ai = options.ai ?? createAiFromEnv(store, process.env);
    const app = createApp(store, {
      webRoot: options.webRoot,
      ai,
      uploads: createUploadService(database),
      rebuildAi: options.ai ? undefined : (rebuilt) => ai.withData(knownNamesFrom(rebuilt), snapshotId(rebuilt)),
      allowedHosts: [allowedHostFor(requestedHost)],
    });
    server = serve({ fetch: app.fetch, port: requested, hostname: requestedHost });
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', (error: NodeJS.ErrnoException) => reject(explainListenError(error, requested, requestedHost)));
    });
  } catch (error) {
    database.close(); // an in-memory connection or a file must not outlive a server that never started
    throw error;
  }

  const { address: host, port } = server.address() as AddressInfo;
  // A wildcard address is not a place a browser can go.
  const wildcard = requestedHost === '0.0.0.0' || requestedHost === '::';
  const urlHost = wildcard ? 'localhost' : requestedHost.includes(':') && !requestedHost.startsWith('[') ? `[${requestedHost}]` : requestedHost;
  return {
    host,
    port,
    url: `http://${urlHost}:${port}`,
    store,
    notices,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          database.close();
          return error ? reject(error) : resolve();
        });
        // fetch keeps connections alive; do not wait for them to idle out
        if ('closeAllConnections' in server) server.closeAllConnections();
      }),
  };
}
