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
