import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {capturePages} from './capture-pages.mjs';
import {captureDesktop} from './capture-desktop.mjs';
import {populateFixture} from './populate-fixture.mjs';
import {captureVector} from './capture-vector.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '../..');
const directory = process.argv.includes('--rich') ? path.join(scriptDirectory, 'populated') : scriptDirectory;
await fs.mkdir(directory, {recursive: true});
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'allchat-design-'));
const port = 4187;
const baseURL = `http://127.0.0.1:${port}`;
const log = await fs.open(path.join(temporary, 'instance.log'), 'w');
// A disposable instance: never connect this capture script to real member data.
const server = spawn('go', ['run', '-buildvcs=false', './cmd/allchat', '--data-dir', temporary, '--listen', `127.0.0.1:${port}`], {
  cwd: root, detached: true, stdio: ['ignore', log.fd, log.fd],
  env: {...process.env, GOCACHE: process.env.GOCACHE || '/tmp/allchat-playwright-gocache'},
});
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`Fixture instance exited; inspect ${temporary}/instance.log`);
    if (attempt === 120) throw new Error(`Fixture instance timed out; inspect ${temporary}/instance.log`);
    try { if ((await fetch(`${baseURL}/login`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({baseURL, viewport: {width: 1280, height: 720}, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC'});
  const request = context.request;
  async function post(url, data) {
    const csrf = (await context.cookies()).find(cookie => cookie.name === 'allchat_csrf')?.value || '';
    const response = await request.post(url, {data, headers: {'X-CSRF-Token': csrf}});
    if (!response.ok()) throw new Error(`Fixture request ${url} failed: HTTP ${response.status()}`);
    return response.json();
  }
  const setupToken = (await fs.readFile(path.join(temporary, 'setup.token'), 'utf8')).trim();
  await post('/api/v1/auth/setup', {token: setupToken, username: 'visual-owner', password: 'visual regression password'});
  const category = await post('/api/v1/categories', {name: 'Community', position: 1});
  const channel = await post('/api/v1/channels', {category_id: category.id, name: 'general', type: 'text', position: 1});
  await post('/api/v1/channels', {category_id: category.id, name: 'Lounge', type: 'voice', position: 2});
  await post(`/api/v1/channels/${channel.id}/messages`, {body: 'Welcome to the deterministic visual fixture.'});
  await post(`/api/v1/channels/${channel.id}/messages`, {body: 'Desktop and mobile layouts should stay stable.'});
  if (process.argv.includes('--rich')) await populateFixture(browser, context, baseURL, root, channel, post);
  const page = await context.newPage();
  await page.goto(`/channels/${channel.id}`);
  await page.locator('.channel-content').waitFor();
  await page.waitForFunction(() => Boolean(window.allchatConversationWindow));
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});
  await page.locator('.message-time').evaluateAll(elements => elements.forEach(element => { element.textContent = '12:00'; }));
  await page.screenshot({path: path.join(directory, 'reference.png'), animations: 'disabled'});

  const captured = await captureVector(page);
  await fs.writeFile(path.join(directory, 'text-channel.svg'), captured.svg);
  await fs.writeFile(path.join(directory, 'computed-styles.json'), JSON.stringify(captured.primitives, null, 2) + '\n');
  const tokens = {};
  for (const [name, value] of Object.entries(captured.variables).sort(([a], [b]) => a.localeCompare(b))) {
    if (name.startsWith('--allchat-visual-')) continue;
    if (/^#[\da-f]{3,8}$/i.test(value) || /^(rgb|hsl)a?\(/.test(value)) tokens[name.slice(2)] = {$type: 'color', $value: value};
    else if (/^\d+(\.\d+)?px$/.test(value)) tokens[name.slice(2)] = {$type: 'dimension', $value: value};
  }
  tokens.typography = Object.fromEntries([...new Set(captured.primitives.map(item => item.fontSize))].sort((a, b) => parseFloat(a) - parseFloat(b)).map(size => [`size-${parseFloat(size).toString().replace('.', '-')}`, {$type: 'dimension', $value: size}]));
  tokens.spacing = Object.fromEntries([...new Set(captured.primitives.flatMap(item => `${item.padding} ${item.gap}`.split(' ')).filter(value => /^\d+(\.\d+)?px$/.test(value)))].sort((a, b) => parseFloat(a) - parseFloat(b)).map(size => [`space-${parseFloat(size).toString().replace('.', '-')}`, {$type: 'dimension', $value: size}]));
  await fs.writeFile(path.join(directory, 'tokens.json'), JSON.stringify({AllChat: tokens}, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'capture.json'), JSON.stringify({status: 'draft', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(), viewport: {width: 1280, height: 720}, browser: browser.version(), screen: 'text-channel', theme: 'dark', fixture: 'disposable instance, visual-owner, general', limitations: ['SVG is an editable starting point; verify text baselines, clipping, shadows and icons in Penpot.', 'Native Penpot components and token bindings require the connected-file import step.']}, null, 2) + '\n');
  if (process.argv.includes('--desktop')) await captureDesktop(root, directory, baseURL);
  if (process.argv.includes('--catalog')) await capturePages(context, directory);
  console.log('Captured draft reference, editable SVG, computed styles and tokens in design/penpot/.');
  if (process.argv.includes('--serve')) {
    console.log(`Disposable capture fixture ready at ${baseURL}; stop with Ctrl+C when captures finish.`);
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
} finally {
  await browser?.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  await log.close();
  await fs.rm(temporary, {recursive: true, force: true});
}
