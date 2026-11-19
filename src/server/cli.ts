import { LoadError } from '../core/errors';
import { dataSpan } from '../core/ranges';
import { ConfigError } from './config';
import { start } from './start';

/** The `npm start` entry: print where it is serving, or one "Cannot start" line and exit 1. */
async function main(): Promise<void> {
  try {
    const server = await start();
    const { calls, dataNotes } = server.store;
    const span = dataSpan(calls);
    const parts = [`Serving ${calls.length} calls`];
    if (span) parts.push(`data as of ${span.end}`);
    parts.push(`at ${server.url}`);
    let line = parts.join(', ');
    if (dataNotes.badRows > 0) line += `, ${dataNotes.badRows} rows skipped`;
    console.log([line, ...dataNotes.notes].join('\n'));
  } catch (error) {
    if (error instanceof LoadError || error instanceof ConfigError) {
      console.error(`Cannot start: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

await main();
