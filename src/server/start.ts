import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { cleanExport } from '../core/clean';
import type { CallStore } from '../core/types';
import { readExportFromDir } from '../node/readDataDir';
import { createAiFromEnv } from '../ai/fromEnv';
import type { TakeawayService } from '../ai/service';
import { createApp } from './app';
import { explainListenError, parseHost, parsePort } from './config';

export interface StartOptions {
  /** The export folder. Omitted: DATA_DIR, else the current directory (see readExportFromDir). */
  dataDir?: string;
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
  store: CallStore;
  close(): Promise<void>;
}

/** The only code that reads the export, opens a port or reads PORT. It does not read .env (cli.ts does). Throws LoadError (data) or ConfigError (port). */
export async function start(options: StartOptions = {}): Promise<RunningServer> {
  const requested = options.port ?? parsePort(process.env.PORT);
  const store = cleanExport(readExportFromDir(options.dataDir));
  const app = createApp(store, { webRoot: options.webRoot, ai: options.ai ?? createAiFromEnv(store, process.env) });

  const requestedHost = options.host ?? parseHost(process.env.HOST);
  const server = serve({ fetch: app.fetch, port: requested, hostname: requestedHost });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', (error: NodeJS.ErrnoException) => reject(explainListenError(error, requested, requestedHost)));
  });

  const { address: host, port } = server.address() as AddressInfo;
  // A wildcard address is not a place a browser can go.
  const wildcard = requestedHost === '0.0.0.0' || requestedHost === '::';
  const urlHost = wildcard ? 'localhost' : requestedHost.includes(':') && !requestedHost.startsWith('[') ? `[${requestedHost}]` : requestedHost;
  return {
    host,
    port,
    url: `http://${urlHost}:${port}`,
    store,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // fetch keeps connections alive; do not wait for them to idle out
        if ('closeAllConnections' in server) server.closeAllConnections();
      }),
  };
}
