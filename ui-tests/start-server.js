const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'allchat-playwright-'));
fs.writeFileSync(path.join(os.tmpdir(), 'allchat-playwright-data-path'), dataDirectory);

const child = spawn('go', ['run', '-buildvcs=false', './cmd/allchat', '--data-dir', dataDirectory, '--listen', '127.0.0.1:4173'], {
  cwd: path.resolve(__dirname, '..'),
  env: {...process.env, GOCACHE: '/tmp/allchat-playwright-gocache'},
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 0));
