import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/@shiguredo/rnnoise-wasm/dist/rnnoise.js');
const license = resolve(root, 'node_modules/@shiguredo/rnnoise-wasm/LICENSE');
const webpDirectory = resolve(root, 'node_modules/wasm-webp/dist/esm');
const webpLicense = resolve(root, 'node_modules/wasm-webp/LICENSE');
const targetDirectory = resolve(root, 'internal/instance/web/assets/vendor');

await mkdir(targetDirectory, {recursive: true});
const sourceCode = await readFile(source, 'utf8');
const environmentCheck = 'typeof window == "object" || typeof WorkerGlobalScope < "u"';
const fileURICheck = '(A) => A.startsWith("file://")';
if (!sourceCode.includes(environmentCheck)) {
  throw new Error('The pinned RNNoise runtime changed its environment check; review the AudioWorklet compatibility patch.');
}
if (!sourceCode.includes(fileURICheck)) {
  throw new Error('The pinned RNNoise runtime changed its file-URI check; review the embedded-Wasm error patch.');
}

// AudioWorkletGlobalScope intentionally exposes neither `window` nor
// `WorkerGlobalScope`. The runtime otherwise only needs standard globals that
// AudioWorklet provides, and embeds its Wasm payload in this module.
const workletCompatibleSource = sourceCode
  .replace(environmentCheck, 'typeof globalThis == "object"')
  // The embedded Wasm payload is a Uint8Array. If instantiation fails,
  // Emscripten passes that payload through this warning path; checking it as
  // a string masks the original WebAssembly error with `.startsWith`.
  .replace(fileURICheck, '(A) => typeof A === "string" && A.startsWith("file://")');
const webpIndex = (await readFile(resolve(webpDirectory, 'index.js'), 'utf8'))
  .replace("from './webp-wasm'", "from './webp-wasm.js'");

await Promise.all([
  writeFile(resolve(targetDirectory, 'rnnoise.js'), workletCompatibleSource),
  copyFile(license, resolve(targetDirectory, 'RNNOISE-WASM-LICENSE.txt')),
  writeFile(resolve(targetDirectory, 'webp.js'), webpIndex),
  copyFile(resolve(webpDirectory, 'webp-wasm.js'), resolve(targetDirectory, 'webp-wasm.js')),
  copyFile(resolve(webpDirectory, 'webp-wasm.wasm'), resolve(targetDirectory, 'webp-wasm.wasm')),
  copyFile(webpLicense, resolve(targetDirectory, 'WEBP-WASM-LICENSE.txt')),
]);
