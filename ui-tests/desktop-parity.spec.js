const { test, expect, request } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const baseURL = 'http://127.0.0.1:4173';
const password = 'desktop parity password';
let fixture;

test.describe.configure({ mode: 'serial' });

function parityScenario(id) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'ui-parity', 'manifest.yaml'), 'utf8');
  const automation = source.match(/\nautomation:\n([\s\S]*)$/)?.[1];
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = automation?.match(new RegExp(`^  ${escaped}:\\n([\\s\\S]*?)(?=^  [a-z0-9-]+:\\n|(?![\\s\\S]))`, 'm'))?.[1];
  if (!block) throw new Error(`No ui-parity automation scenario named ${id}`);
  const value = key => block.match(new RegExp(`^    ${key}: (.+)$`, 'm'))?.[1];
  return {
    screen: value('screen'),
    state: value('state'),
    webPath: value('web_path'),
    width: Number(value('width')),
    height: Number(value('height')),
    maxDifference: Number(value('max_meaningful_pixel_difference')),
    evidenceDirectory: value('evidence_directory'),
  };
}

const channelDefault = parityScenario('desktop-channel-default');
const directMessageDefault = parityScenario('desktop-direct-message-default');
const communityHomeDefault = parityScenario('desktop-community-home-default');
const directMessagesHomeDefault = parityScenario('desktop-direct-messages-home-default');
const adminDashboardHealthy = parityScenario('desktop-admin-dashboard-healthy');

async function csrf(context) {
  const state = await context.storageState();
  return state.cookies.find(cookie => cookie.name === 'allchat_csrf')?.value || '';
}

async function post(context, url, data) {
  const response = await context.post(url, { data, headers: { 'X-CSRF-Token': await csrf(context) } });
  if (!response.ok()) throw new Error(`${url}: ${response.status()} ${await response.text()}`);
  return response.json();
}

test.beforeAll(async () => {
  const dataDirectory = fs.readFileSync(path.join(os.tmpdir(), 'allchat-playwright-data-path'), 'utf8').trim();
  const setupToken = fs.readFileSync(path.join(dataDirectory, 'setup.token'), 'utf8').trim();
  const owner = await request.newContext({ baseURL });
  let response = await owner.post('/api/v1/auth/setup', { data: { token: setupToken, username: 'parity-owner', password } });
  expect(response.status()).toBe(201);
  const category = await post(owner, '/api/v1/categories', { name: 'Community', position: 1 });
  const channel = await post(owner, '/api/v1/channels', { category_id: category.id, name: 'general', type: 'text', position: 1 });
  const invitation = await post(owner, '/api/v1/invitations', { expires_in_minutes: 60, max_uses: 1 });
  const member = await request.newContext({ baseURL });
  response = await member.post('/api/v1/auth/register', { data: { token: invitation.token, username: 'parity-member', password } });
  expect(response.status()).toBe(201);
  const membersResponse = await owner.get('/api/v1/members');
  expect(membersResponse.ok()).toBeTruthy();
  const membersBody = await membersResponse.json();
  const parityMember = membersBody.members.find(item => item.username === 'parity-member');
  const dm = await post(owner, '/api/v1/dms', { member_id: parityMember.id });
  await post(owner, `/api/v1/channels/${channel.id}/messages`, { body: 'Web and Desktop share one visual language. https://preview-does-not-exist.invalid/' });
  await post(member, `/api/v1/channels/${channel.id}/messages`, { body: 'This deterministic fixture detects visual drift.' });
  await post(owner, `/api/v1/dms/${dm.id}/messages`, { body: 'Direct Messages use the same canonical layout.' });
  await post(member, `/api/v1/dms/${dm.id}/messages`, { body: 'DM parity includes calls, policy, and blocking.' });
  fixture = { channel, dm, ownerState: await owner.storageState() };
  await owner.dispose();
  await member.dispose();
});

function executablePath() {
  const root = path.resolve(__dirname, '..', 'desktop', 'out');
  if (process.platform === 'win32') return path.join(root, '@allchat-desktop-win32-x64', 'AllChat.exe');
  if (process.platform === 'darwin') return path.join(root, '@allchat-desktop-darwin-x64', 'AllChat.app', 'Contents', 'MacOS', 'AllChat');
  return path.join(root, '@allchat-desktop-linux-x64', 'AllChat');
}

function collectElectronErrors(app, page) {
  const errors = [];
  const inspect = chunk => {
    const text = String(chunk);
    if (/Error occurred in handler|UnhandledPromiseRejection|Uncaught Exception/.test(text)) errors.push(text.trim());
  };
  app.process().stderr?.on('data', inspect);
  app.process().stdout?.on('data', inspect);
  page.on('pageerror', error => errors.push(`Renderer page error: ${error.message}`));
  return () => expect(errors, 'packaged Electron emitted application errors').toEqual([]);
}

async function compareScreenshots(page, web, desktop) {
  return page.evaluate(async ({ webBase64, desktopBase64 }) => {
    const load = source => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = `data:image/png;base64,${source}`;
    });
    const [left, right] = await Promise.all([load(webBase64), load(desktopBase64)]);
    const width = Math.min(left.width, right.width), height = Math.min(left.height, right.height);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(left, 0, 0); const a = context.getImageData(0, 0, width, height);
    context.clearRect(0, 0, width, height); context.drawImage(right, 0, 0); const b = context.getImageData(0, 0, width, height);
    const diff = context.createImageData(width, height); let changed = 0;
    for (let index = 0; index < a.data.length; index += 4) {
      const delta = Math.max(Math.abs(a.data[index] - b.data[index]), Math.abs(a.data[index + 1] - b.data[index + 1]), Math.abs(a.data[index + 2] - b.data[index + 2]));
      if (delta > 20) { changed += 1; diff.data.set([242, 63, 66, 255], index); }
      else diff.data.set([a.data[index] / 3, a.data[index + 1] / 3, a.data[index + 2] / 3, 255], index);
    }
    context.putImageData(diff, 0, 0);
    return { ratio: changed / (width * height), diff: canvas.toDataURL('image/png').split(',')[1] };
  }, { webBase64: web.toString('base64'), desktopBase64: desktop.toString('base64') });
}

async function launchSignedInDesktop(scenario, profilePrefix) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), profilePrefix));
  const app = await electron.launch({ executablePath: executablePath(), args: [`--user-data-dir=${profile}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] });
  const desktopPage = await app.firstWindow();
  const assertNoErrors = collectElectronErrors(app, desktopPage);
  await desktopPage.setViewportSize({ width: scenario.width, height: scenario.height });
  await desktopPage.getByLabel('Instance name').fill('Parity');
  await desktopPage.getByLabel('Instance address').fill(baseURL);
  await desktopPage.getByRole('button', { name: 'Add Instance' }).click();
  await desktopPage.getByLabel('Username').fill('parity-owner');
  await desktopPage.getByLabel('Password').fill(password);
  await desktopPage.locator('form').getByRole('button', { name: 'Sign in' }).click();
  return { app, desktopPage, assertNoErrors };
}

async function recordComparison(page, testInfo, scenario, label, web, desktop) {
  const comparison = await compareScreenshots(page, web, desktop);
  const diff = Buffer.from(comparison.diff, 'base64');
  const artifactDirectory = path.resolve(__dirname, '..', scenario.evidenceDirectory);
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.writeFileSync(path.join(artifactDirectory, 'web.png'), web);
  fs.writeFileSync(path.join(artifactDirectory, 'desktop.png'), desktop);
  fs.writeFileSync(path.join(artifactDirectory, 'diff.png'), diff);
  fs.writeFileSync(path.join(artifactDirectory, 'comparison.json'), `${JSON.stringify({ meaningful_pixel_difference: comparison.ratio }, null, 2)}\n`);
  console.log(`Desktop/web ${label} meaningful pixel difference: ${(comparison.ratio * 100).toFixed(2)}%`);
  await Promise.all([
    testInfo.attach(`${label}-web.png`, { body: web, contentType: 'image/png' }),
    testInfo.attach(`${label}-desktop.png`, { body: desktop, contentType: 'image/png' }),
    testInfo.attach(`${label}-diff.png`, { body: diff, contentType: 'image/png' }),
  ]);
  expect(comparison.ratio, `meaningful ${label} cross-client pixel difference`).toBeLessThan(scenario.maxDifference);
}

test('packaged Desktop Community Home remains visually aligned with web', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: communityHomeDefault.width, height: communityHomeDefault.height });
  await page.context().addCookies(fixture.ownerState.cookies);
  await page.goto(communityHomeDefault.webPath);
  await page.locator('.content-shell').waitFor();
  const web = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const { app, desktopPage, assertNoErrors } = await launchSignedInDesktop(communityHomeDefault, 'allchat-desktop-parity-home-');
  try {
    await desktopPage.locator('.welcome').waitFor();
    const desktop = await desktopPage.locator('.shell').screenshot({ animations: 'disabled', caret: 'hide' });
    await recordComparison(page, testInfo, communityHomeDefault, 'Community Home', web, desktop);
    assertNoErrors();
  } finally { await app.close(); }
});

test('packaged Desktop Admin Dashboard remains visually aligned with web', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: adminDashboardHealthy.width, height: adminDashboardHealthy.height });
  await page.context().addCookies(fixture.ownerState.cookies);
  await page.goto(adminDashboardHealthy.webPath);
  await page.locator('[data-admin-dashboard] .dashboard-stat').first().waitFor();
  const web = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const { app, desktopPage, assertNoErrors } = await launchSignedInDesktop(adminDashboardHealthy, 'allchat-desktop-parity-dashboard-');
  try {
    await desktopPage.locator('.community-header').click();
    await desktopPage.getByRole('menuitem', { name: 'Community Settings' }).click();
    await desktopPage.getByRole('navigation', { name: 'Community settings' }).getByRole('button', { name: 'Dashboard' }).click();
    await desktopPage.locator('[data-admin-dashboard] .dashboard-stat').first().waitFor();
    await expect(desktopPage.locator('.dashboard-stat')).toHaveCount(8);
    await expect(desktopPage.getByRole('heading', { name: 'Admin Dashboard', level: 1 })).toBeVisible();
    const desktop = await desktopPage.locator('.shell').screenshot({ animations: 'disabled', caret: 'hide' });
    await recordComparison(page, testInfo, adminDashboardHealthy, 'Admin Dashboard', web, desktop);
    assertNoErrors();
  } finally { await app.close(); }
});

test('packaged Desktop Direct Messages Home remains visually aligned with web', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: directMessagesHomeDefault.width, height: directMessagesHomeDefault.height });
  await page.context().addCookies(fixture.ownerState.cookies);
  await page.goto(directMessagesHomeDefault.webPath);
  await page.locator('.content-shell').waitFor();
  const web = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const { app, desktopPage, assertNoErrors } = await launchSignedInDesktop(directMessagesHomeDefault, 'allchat-desktop-parity-dms-');
  try {
    await desktopPage.getByRole('button', { name: 'Direct Messages' }).click();
    await desktopPage.locator('.dm-home').waitFor();
    const desktop = await desktopPage.locator('.shell').screenshot({ animations: 'disabled', caret: 'hide' });
    await recordComparison(page, testInfo, directMessagesHomeDefault, 'Direct Messages Home', web, desktop);
    assertNoErrors();
  } finally { await app.close(); }
});

test('packaged Desktop remains visually aligned with web', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: channelDefault.width, height: channelDefault.height });
  await page.context().addCookies(fixture.ownerState.cookies);
  await page.goto(channelDefault.webPath.replace('{channelID}', fixture.channel.id));
  await page.locator('.channel-content').waitFor();
  const web = await page.screenshot({ animations: 'disabled', caret: 'hide' });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'allchat-desktop-parity-'));
  const app = await electron.launch({ executablePath: executablePath(), args: [`--user-data-dir=${profile}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] });
  try {
    const desktopPage = await app.firstWindow();
    const assertNoErrors = collectElectronErrors(app, desktopPage);
    await desktopPage.setViewportSize({ width: channelDefault.width, height: channelDefault.height });
    await desktopPage.getByLabel('Instance name').fill('Parity');
    await desktopPage.getByLabel('Instance address').fill(baseURL);
    await desktopPage.getByRole('button', { name: 'Add Instance' }).click();
    await desktopPage.getByLabel('Username').fill('parity-owner');
    await desktopPage.getByLabel('Password').fill(password);
    await desktopPage.locator('form').getByRole('button', { name: 'Sign in' }).click();
    await desktopPage.getByRole('button', { name: 'general' }).click();
    await desktopPage.locator('.message').first().waitFor();
    await expect(desktopPage.locator('.community-header')).toHaveCSS('cursor', 'pointer');
    await expect(desktopPage.getByRole('button', { name: 'general' })).toHaveCSS('cursor', 'pointer');
    await expect(desktopPage.getByRole('button', { name: 'Home' })).toHaveCSS('cursor', 'pointer');
    await expect(desktopPage.getByRole('button', { name: 'Direct Messages' })).toHaveCSS('cursor', 'pointer');
    await expect(desktopPage.locator('.conversation-sidebar')).toHaveCSS('width', '240px');
    await expect(desktopPage.locator('.conversation-nav')).toHaveCSS('overflow-x', 'hidden');
    const controlsWithoutPointer = await desktopPage
      .locator('button:not(:disabled), a[href], [role="button"], [role="menuitem"], label[for], .attach-button')
      .evaluateAll((controls) => controls
        .filter((control) => {
          const style = getComputedStyle(control);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.cursor !== 'pointer';
        })
        .map((control) => control.getAttribute('aria-label') || control.textContent?.trim() || control.tagName));
    expect(controlsWithoutPointer, 'enabled visible controls without pointer cursor').toEqual([]);
    const desktop = await desktopPage.locator('.shell').screenshot({ animations: 'disabled', caret: 'hide' });
    const comparison = await compareScreenshots(page, web, desktop);
    const diff = Buffer.from(comparison.diff, 'base64');
    const artifactDirectory = path.resolve(__dirname, '..', channelDefault.evidenceDirectory);
    fs.mkdirSync(artifactDirectory, { recursive: true });
    fs.writeFileSync(path.join(artifactDirectory, 'web.png'), web);
    fs.writeFileSync(path.join(artifactDirectory, 'desktop.png'), desktop);
    fs.writeFileSync(path.join(artifactDirectory, 'diff.png'), diff);
    fs.writeFileSync(path.join(artifactDirectory, 'comparison.json'), `${JSON.stringify({ meaningful_pixel_difference: comparison.ratio }, null, 2)}\n`);
    console.log(`Desktop/web meaningful pixel difference: ${(comparison.ratio * 100).toFixed(2)}%`);
    await Promise.all([
      testInfo.attach('web.png', { body: web, contentType: 'image/png' }),
      testInfo.attach('desktop.png', { body: desktop, contentType: 'image/png' }),
      testInfo.attach('diff.png', { body: diff, contentType: 'image/png' }),
    ]);
    expect(comparison.ratio, 'meaningful cross-client pixel difference').toBeLessThan(channelDefault.maxDifference);
    assertNoErrors();
  } finally {
    await app.close();
  }
});

test('packaged Desktop Direct Message remains visually aligned with web', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: directMessageDefault.width, height: directMessageDefault.height });
  await page.context().addCookies(fixture.ownerState.cookies);
  await page.goto(directMessageDefault.webPath.replace('{dmID}', fixture.dm.id));
  await page.locator('.channel-content').waitFor();
  const web = await page.screenshot({ animations: 'disabled', caret: 'hide' });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'allchat-desktop-parity-dm-'));
  const app = await electron.launch({ executablePath: executablePath(), args: [`--user-data-dir=${profile}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] });
  try {
    const desktopPage = await app.firstWindow();
    const assertNoErrors = collectElectronErrors(app, desktopPage);
    await desktopPage.setViewportSize({ width: directMessageDefault.width, height: directMessageDefault.height });
    await desktopPage.getByLabel('Instance name').fill('Parity');
    await desktopPage.getByLabel('Instance address').fill(baseURL);
    await desktopPage.getByRole('button', { name: 'Add Instance' }).click();
    await desktopPage.getByLabel('Username').fill('parity-owner');
    await desktopPage.getByLabel('Password').fill(password);
    await desktopPage.locator('form').getByRole('button', { name: 'Sign in' }).click();
    await desktopPage.getByRole('button', { name: 'parity-member', exact: true }).click();
    await desktopPage.locator('.message').first().waitFor();
    await expect(desktopPage.getByRole('complementary', { name: 'Members' })).toHaveCount(0);
    await expect(desktopPage.getByRole('button', { name: 'Start Call' })).toBeVisible();
    const desktop = await desktopPage.locator('.shell').screenshot({ animations: 'disabled', caret: 'hide' });
    const comparison = await compareScreenshots(page, web, desktop);
    const diff = Buffer.from(comparison.diff, 'base64');
    const artifactDirectory = path.resolve(__dirname, '..', directMessageDefault.evidenceDirectory);
    fs.mkdirSync(artifactDirectory, { recursive: true });
    fs.writeFileSync(path.join(artifactDirectory, 'web.png'), web);
    fs.writeFileSync(path.join(artifactDirectory, 'desktop.png'), desktop);
    fs.writeFileSync(path.join(artifactDirectory, 'diff.png'), diff);
    fs.writeFileSync(path.join(artifactDirectory, 'comparison.json'), `${JSON.stringify({ meaningful_pixel_difference: comparison.ratio }, null, 2)}\n`);
    console.log(`Desktop/web Direct Message meaningful pixel difference: ${(comparison.ratio * 100).toFixed(2)}%`);
    await Promise.all([
      testInfo.attach('dm-web.png', { body: web, contentType: 'image/png' }),
      testInfo.attach('dm-desktop.png', { body: desktop, contentType: 'image/png' }),
      testInfo.attach('dm-diff.png', { body: diff, contentType: 'image/png' }),
    ]);
    expect(comparison.ratio, 'meaningful Direct Message cross-client pixel difference').toBeLessThan(directMessageDefault.maxDifference);
    assertNoErrors();
  } finally {
    await app.close();
  }
});
