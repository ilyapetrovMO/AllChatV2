import { spawn } from 'node:child_process';
import path from 'node:path';

const packageDirectory = path.resolve(import.meta.dirname, '..', 'out', `AllChat-${process.platform}-${process.arch}`);
const executable = process.platform === 'win32'
  ? path.join(packageDirectory, 'AllChat.exe')
  : process.platform === 'darwin'
    ? path.join(packageDirectory, 'AllChat.app', 'Contents', 'MacOS', 'AllChat')
    : path.join(packageDirectory, 'AllChat');
const command = process.platform === 'linux' ? 'xvfb-run' : executable;
const args = process.platform === 'linux' ? ['-a', executable] : [];
const child = spawn(command, args, {
  env: { ...process.env, ALLCHAT_DESKTOP_SMOKE_TEST: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });

const timeout = setTimeout(() => {
  child.kill('SIGKILL');
  console.error(`Packaged desktop startup timed out: ${executable}`);
}, 30_000);

child.once('error', (error) => {
  clearTimeout(timeout);
  console.error(`Could not launch packaged desktop application ${executable}:`, error);
  process.exitCode = 1;
});
child.once('close', (code) => {
  clearTimeout(timeout);
  if (code !== 0 || !output.includes('AllChat desktop packaged startup: PASS')) {
    console.error(`Packaged desktop startup failed with exit code ${code}: ${executable}`);
    process.exitCode = 1;
  }
});
