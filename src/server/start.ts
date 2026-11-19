import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { cleanExport } from '../core/clean';
import type { CallStore } from '../core/types';
import { readExportFromDir } from '../node/readDataDir';
import { createApp } from './app';
import { ConfigError, parsePort } from './config';

export interface StartOptions {
  /** The export folder. Omitted: DATA_DIR, else the current directory (see readExportFromDir). */
  dataDir?: string;
  /** 0 picks a free port (tests). Omitted: PORT, else 3000. */
  port?: number;
  /** The built web app's folder. */
  webRoot?: string;
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
  const app = createApp(store, { webRoot: options.webRoot });

  const server = serve({ fetch: app.fetch, port: requested, hostname: '127.0.0.1' });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(new ConfigError(`Port ${requested} is already in use. Set PORT to a free port.`));
      } else {
        reject(error);
      }
    });
  });

  const { address: host, port } = server.address() as AddressInfo;
  return {
    host,
    port,
    url: `http://127.0.0.1:${port}`,
    store,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // fetch keeps connections alive; do not wait for them to idle out
        if ('closeAllConnections' in server) server.closeAllConnections();
      }),
  };
}
