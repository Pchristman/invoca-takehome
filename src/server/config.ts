import { shorten } from './api';

/** A problem with how the server was set up (for example a bad PORT), not with the data. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULT_PORT = 3000;

/** PORT from the environment: unset or blank gives the default; otherwise a whole number from 1 to 65535. */
export function parsePort(value: string | undefined): number {
  const text = value?.trim() ?? '';
  if (text === '') return DEFAULT_PORT;
  const port = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be a whole number from 1 to 65535, not "${shorten(text)}".`);
  }
  return port;
}

const DEFAULT_DB_PATH = 'data/calls.db';

/** DB_PATH from the environment: unset or blank gives data/calls.db; otherwise the trimmed text (":memory:" is allowed). */
export function parseDbPath(value: string | undefined): string {
  const text = value?.trim() ?? '';
  return text === '' ? DEFAULT_DB_PATH : text;
}

const DEFAULT_HOST = '127.0.0.1';

/** HOST from the environment: unset or blank gives loopback; otherwise the trimmed text. */
export function parseHost(value: string | undefined): string {
  const text = value?.trim() ?? '';
  return text === '' ? DEFAULT_HOST : text;
}

/** Turn a listen() failure into a ConfigError the user can act on; anything else is returned unchanged. */
export function explainListenError(error: NodeJS.ErrnoException, port: number, host: string = DEFAULT_HOST): Error {
  if (error.code === 'EADDRINUSE') {
    return new ConfigError(`Port ${port} is already in use. Set PORT to a free port.`);
  }
  if (host !== DEFAULT_HOST && ['EADDRNOTAVAIL', 'ENOTFOUND', 'EINVAL', 'EAI_AGAIN', 'EAFNOSUPPORT'].includes(error.code ?? '')) {
    return new ConfigError(
      `HOST "${shorten(host)}" is not an address this machine can listen on. Set HOST to 127.0.0.1, or 0.0.0.0 inside a container.`,
    );
  }
  if (error.code === 'EACCES' || error.code === 'EADDRNOTAVAIL') {
    return new ConfigError(`Port ${port} cannot be used (reserved or not permitted). Set PORT to another port.`);
  }
  return error;
}

/** True for 127.0.0.0/8 and ::1 (with or without brackets): the addresses only this machine can reach. */
export function isLoopbackHost(host: string): boolean {
  const text = host.replace(/^\[|\]$/g, '');
  return text === '::1' || /^127\.\d+\.\d+\.\d+$/.test(text);
}

/** One line to print when the server really bound a non-loopback address; empty for loopback. */
export function nonLoopbackWarning(boundHost: string): string {
  if (isLoopbackHost(boundHost)) return '';
  return `Listening on a non-loopback address (${boundHost}): other devices on the network can reach this app.`;
}
