import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/@shiguredo/rnnoise-wasm/dist/rnnoise.js');
const license = resolve(root, 'node_modules/@shiguredo/rnnoise-wasm/LICENSE');
const targetDirectory = resolve(root, 'internal/instance/web/assets/vendor');

await mkdir(targetDirectory, {recursive: true});
const sourceCode = await readFile(source, 'utf8');
const environmentCheck = 'typeof window == "object" || typeof WorkerGlobalScope < "u"';
if (!sourceCode.includes(environmentCheck)) {
  throw new Error('The pinned RNNoise runtime changed its environment check; review the AudioWorklet compatibility patch.');
}

// AudioWorkletGlobalScope intentionally exposes neither `window` nor
// `WorkerGlobalScope`. The runtime otherwise only needs standard globals that
// AudioWorklet provides, and embeds its Wasm payload in this module.
const workletCompatibleSource = sourceCode.replace(environmentCheck, 'typeof globalThis == "object"');

await Promise.all([
  writeFile(resolve(targetDirectory, 'rnnoise.js'), workletCompatibleSource),
  copyFile(license, resolve(targetDirectory, 'RNNOISE-WASM-LICENSE.txt')),
]);
