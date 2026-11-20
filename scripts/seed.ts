// `npm run seed [folder]`: load or top up the database from a folder of CSVs. The logic is in src/db/seedCommand.ts.
import { runSeed } from '../src/db/seedCommand';
import { loadDotEnv } from '../src/node/env';

loadDotEnv(); // the shell still wins
const result = runSeed(process.argv.slice(2), process.env);
for (const line of result.lines) (result.exitCode === 0 ? console.log : console.error)(line);
process.exitCode = result.exitCode;
