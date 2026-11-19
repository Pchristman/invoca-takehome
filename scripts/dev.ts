// `npm run dev`: the API server (restarting on change) and Vite together.
// If either one exits, stop the other, so a server that cannot start does not
// leave Vite running next to a dead API.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// Load .env here, as src/node/env.ts does for the server (the shell still wins), so both children
// inherit the same PORT and DATA_DIR: Vite's proxy must point at the server's port.
if (existsSync('.env')) process.loadEnvFile('.env');

// node --watch does not exit when the server fails to start; it prints this and waits.
const SERVER_GAVE_UP = /Failed running/;

const server = spawn(process.execPath, ['--import', 'tsx', '--watch', 'src/server/cli.ts'], {
  stdio: ['inherit', 'pipe', 'pipe'],
});
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' });
const children = [server, vite];

let stopping = false;
function stopAll(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}

// Pass the server's output through, and stop if --watch reports it failed to run.
server.stdout.on('data', (chunk: Buffer) => {
  process.stdout.write(chunk);
  if (SERVER_GAVE_UP.test(chunk.toString())) stopAll(1);
});
server.stderr.on('data', (chunk: Buffer) => {
  process.stderr.write(chunk);
  if (SERVER_GAVE_UP.test(chunk.toString())) stopAll(1);
});

for (const child of children) {
  child.on('exit', (code) => stopAll(code ?? 1));
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
