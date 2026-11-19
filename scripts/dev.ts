// `npm run dev`: the API server (restarting on change) and Vite together.
// If either one exits, stop the other, so a server that cannot start does not
// leave Vite running next to a dead API.
import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['--import', 'tsx', '--watch', 'src/server/cli.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];

let stopping = false;
function stopAll(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}

for (const child of children) {
  child.on('exit', (code) => stopAll(code ?? 1));
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
