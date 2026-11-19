import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load variables from a `.env` file into process.env. A variable that is already set
 * (for example exported in the shell) is never overridden. A missing file is fine.
 */
export function loadDotEnv(path: string = join(process.cwd(), '.env')): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
