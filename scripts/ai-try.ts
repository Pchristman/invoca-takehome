// Manual check of the AI takeaways and the question box. Makes REAL API calls that cost real money
// (about $0.0005 a takeaway, about $0.0002 a question).
// Run by hand: npm run ai:try -- all   or   npm run ai:try -- --question "..."
// (a second run is the cache-hit check). Never run by a test.
import { createAiFromEnv } from '../src/ai/fromEnv';
import { dataSpan } from '../src/core/ranges';
import { holdsNothing } from '../src/db/database';
import { loadStore } from '../src/db/prepare';
import { loadDotEnv } from '../src/node/env';
import { createApp } from '../src/server/app';
import { parseDbPath } from '../src/server/config';
import { questionContext, replyToQuery } from '../src/server/questionQuery';
import { formatQuestionResult, formatTryResult, parseTryArgs } from './tryArgs';

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
  // The database the server reads; with none yet, the data folder in memory, so no file is created.
  const dbPath = parseDbPath(process.env.DB_PATH);
  const fromFile = !holdsNothing(dbPath);
  const { store, database } = loadStore({ dbPath: fromFile ? dbPath : ':memory:', dataDir: process.env.DATA_DIR });
  database.close();
  console.log(fromFile ? `Reading ${dbPath}.` : `Reading the CSVs in the data folder (no database at ${dbPath} yet).`);
  const ai = createAiFromEnv(store, process.env);
  const span = dataSpan(store.calls);
  if (args.questions.length > 0) {
    if (span === null) {
      console.error('The export has no calls: nothing was asked.');
      process.exitCode = 1;
      return;
    }
    // The same call the server makes for /api/question: cache, spend guard and call log all apply.
    for (const [i, question] of args.questions.entries()) {
      const before = ai.status().spendUsd;
      const result = await ai.interpret(question, questionContext(store, span), (reply) => replyToQuery(store, span, reply, question));
      const cost = ai.status().spendUsd - before;
      const outcome = result.ok ? { ok: true as const, cached: result.cached, value: result.value } : result;
      console.log(formatQuestionResult(i + 1, outcome, cost));
      if (!result.ok && result.reason !== 'unanswerable') process.exitCode = 1;
    }
    console.log(`  spend so far: $${ai.status().spendUsd.toFixed(6)}`);
    return;
  }
  const app = createApp(store, { ai });
  for (const view of args.views) {
    const response = await app.request(`/api/takeaway/${view}?range=${encodeURIComponent(args.range)}`);
    const result = formatTryResult(view, response.status, await response.json());
    console.log(result.text);
    if (!result.ok) {
      process.exitCode = 1;
      return; // a bad range fails every view the same way
    }
    console.log(`  spend so far: $${ai.status().spendUsd.toFixed(6)}`);
  }
}

await main();
