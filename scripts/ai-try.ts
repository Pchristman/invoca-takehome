// Manual check of the AI takeaways. Makes REAL API calls that cost real money (about $0.0005 a view).
// Run by hand: npm run ai:try -- all   (a second run is the cache-hit check). Never run by a test.
import { createAiFromEnv } from '../src/ai/fromEnv';
import { cleanExport } from '../src/core/clean';
import { loadDotEnv } from '../src/node/env';
import { readExportFromDir } from '../src/node/readDataDir';
import { createApp } from '../src/server/app';
import type { TakeawayResponse } from '../src/server/api';
import { parseTryArgs } from './tryArgs';

async function main(): Promise<void> {
  loadDotEnv(); // the shell still wins
  let args;
  try {
    args = parseTryArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error('No ANTHROPIC_API_KEY is set: nothing was called.');
    process.exitCode = 1;
    return;
  }
  const store = cleanExport(readExportFromDir());
  const ai = createAiFromEnv(store, process.env);
  const app = createApp(store, { ai });
  for (const view of args.views) {
    const response = await app.request(`/api/takeaway/${view}?range=${encodeURIComponent(args.range)}`);
    const body = (await response.json()) as TakeawayResponse;
    console.log(`\n${view}: source=${body.source} reason=${body.reason ?? '-'}\n${body.text}`);
    console.log(`  spend so far: $${ai.status().spendUsd.toFixed(6)}`);
  }
}

await main();
