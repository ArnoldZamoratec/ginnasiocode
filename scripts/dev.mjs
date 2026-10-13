// Levanta API (3001) y web (5173) juntos. Ctrl+C detiene ambos.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../server/.env', import.meta.url))) {
  await import('./setup.mjs');
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  ['api', ['run', 'dev', '-w', 'server'], '\x1b[33m'],
  ['web', ['run', 'dev', '-w', 'web'], '\x1b[36m'],
].map(([name, args, color]) => {
  const p = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = `${color}[${name}]\x1b[0m `;
  const pipe = (s) => s.on('data', (d) => process.stdout.write(d.toString().replace(/^(?=.)/gm, tag)));
  pipe(p.stdout);
  pipe(p.stderr);
  p.on('exit', (code) => { console.log(`${tag}terminó (${code})`); shutdown(); });
  return p;
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  for (const p of procs) p.kill();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
