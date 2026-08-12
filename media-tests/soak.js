const {spawnSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const iterations = Number(process.env.ALLCHAT_MEDIA_ITERATIONS || 10);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000) throw new Error('ALLCHAT_MEDIA_ITERATIONS must be between 1 and 1000');
const started = Date.now();
for (let iteration = 1; iteration <= iterations; iteration += 1) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'browser/run.js')], {stdio: 'inherit', env: process.env});
  if (result.status !== 0) {
    const directory = path.resolve(__dirname, '../.dev/media-tests');
    fs.mkdirSync(directory, {recursive: true});
    fs.writeFileSync(path.join(directory, 'soak-failure.json'), JSON.stringify({schema: 'allchat.media.soak/v1', iteration, iterations, elapsedMS: Date.now() - started}, null, 2));
    process.exit(result.status || 1);
  }
  process.stdout.write(`media soak iteration ${iteration}/${iterations}: PASS\n`);
}
