const {test, expect, request} = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const baseURL = 'http://127.0.0.1:4173';
const password = 'visual regression password';
let fixture;
test.describe.configure({mode: 'serial'});

async function csrf(context) {
  const state = await context.storageState();
  return state.cookies.find(cookie => cookie.name === 'allchat_csrf')?.value || '';
}

async function post(context, url, data) {
  const response = await context.post(url, {data, headers: {'X-CSRF-Token': await csrf(context)}});
  if (!response.ok()) throw new Error(`${url}: ${response.status()} ${await response.text()}`);
  return response.json();
}

test.beforeAll(async () => {
  const dataDirectory = fs.readFileSync(path.join(os.tmpdir(), 'allchat-playwright-data-path'), 'utf8').trim();
  const setupToken = fs.readFileSync(path.join(dataDirectory, 'setup.token'), 'utf8').trim();
  const owner = await request.newContext({baseURL});
  let response = await owner.post('/api/v1/auth/setup', {data: {token: setupToken, username: 'visual-owner', password}});
  expect(response.status()).toBe(201);
  const ownerMember = await response.json();
  const category = await post(owner, '/api/v1/categories', {name: 'Community', position: 1});
  const textChannel = await post(owner, '/api/v1/channels', {category_id: category.id, name: 'general', type: 'text', position: 1});
  const voiceChannel = await post(owner, '/api/v1/channels', {category_id: category.id, name: 'Lounge', type: 'voice', position: 2});
  const invitation = await post(owner, '/api/v1/invitations', {expires_in_minutes: 60, max_uses: 1});
  const second = await request.newContext({baseURL});
  response = await second.post('/api/v1/auth/register', {data: {token: invitation.token, username: 'visual-member', password}});
  expect(response.status()).toBe(201);
  const secondMember = await response.json();
  await post(owner, `/api/v1/channels/${textChannel.id}/messages`, {body: 'Welcome to the deterministic visual fixture.'});
  await post(second, `/api/v1/channels/${textChannel.id}/messages`, {body: 'Desktop and mobile layouts should stay stable.'});
  const dm = await post(owner, '/api/v1/dms', {member_id: secondMember.id});
  await post(owner, `/api/v1/dms/${dm.id}/messages`, {body: 'This is a private conversation.'});
  await post(second, `/api/v1/dms/${dm.id}/messages`, {body: 'The participant pane belongs on the right.'});
  fixture = {ownerState: await owner.storageState(), secondState: await second.storageState(), ownerMember, secondMember, textChannel, voiceChannel, dm};
  await owner.dispose();
  await second.dispose();
});

async function authenticate(page) {
  await page.context().addCookies(fixture.ownerState.cookies);
}

async function stabilize(page) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.addStyleTag({content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});
}

async function shot(page, name) {
  await expect(page).toHaveScreenshot(name, {animations: 'disabled', caret: 'hide'});
}

async function openCommunity(page, mobile) {
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await page.locator('.channel-content').waitFor();
  await expect(page.locator('.channel-sidebar .dm-link')).toHaveCount(1);
  expect(await page.locator('.channel-sidebar .dm-link').count()).toBeLessThan(6);
  await expect(page.locator('.channel-sidebar .dm-category-link')).toHaveAttribute('href', '/dms');
  await expect(page.locator('[data-dm-button]')).toBeVisible();
  if (mobile) await expect(page.locator('[data-dm-unread]')).toBeAttached();
  else await expect(page.locator('[data-dm-unread]')).toBeVisible();
  await stabilize(page);
  if (mobile) await page.locator('[data-sidebar-toggle]').click();
}

async function addVoiceState(page) {
  await page.evaluate(({voiceID, ownerID, memberID}) => {
    const link = document.querySelector(`a[href="/channels/${voiceID}"]`);
    link.classList.add('voice-link');
    const list = document.createElement('ul');
    list.className = 'voice-channel-members participant-list';
    list.dataset.voiceParticipants = voiceID;
    list.innerHTML = `<li class="speaking" data-participant-id="${ownerID}"><span class="voice-member-fallback">V</span><span>Visual Owner</span><span class="voice-member-screen" title="Sharing screen">▣</span></li><li data-participant-id="${memberID}"><span class="voice-member-fallback">M</span><span>Visual Member</span></li>`;
    link.after(list);
    const panel = document.createElement('section');
    panel.className = 'voice-connection-panel';
    panel.dataset.voiceConnection = voiceID;
    panel.innerHTML = '<div><strong>Voice Connected</strong><span>Lounge</span></div><div class="voice-connection-actions"><button aria-label="Open soundboard">♫</button><button class="voice-screen active" aria-label="Share screen">▣</button><button class="voice-mute" aria-label="Mute microphone">●</button><button class="voice-hangup" aria-label="Disconnect voice">☎</button></div>';
    document.querySelector('.member-panel').before(panel);
  }, {voiceID: fixture.voiceChannel.id, ownerID: fixture.ownerMember.id, memberID: fixture.secondMember.id});
}

for (const viewport of [{name: 'desktop', width: 1280, height: 720, mobile: false}, {name: 'mobile', width: 412, height: 915, mobile: true}]) {
  test(`authenticated layout baselines — ${viewport.name}`, async ({page}) => {
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await authenticate(page);

    await openCommunity(page, viewport.mobile);
    await shot(page, `community-channel-${viewport.name}.png`);

    await addVoiceState(page);
    await shot(page, `active-voice-${viewport.name}.png`);

    await page.goto(`/channels/${fixture.voiceChannel.id}`);
    await page.locator('[data-media-stage-grid]').waitFor();
    await page.evaluate(() => {
      const grid = document.querySelector('[data-media-stage-grid]');
	  grid.dataset.tileCount = '2';
      grid.innerHTML = '<article class="media-stage-tile participant-tile speaking"><span class="media-stage-avatar-fallback">V</span><strong>Visual Owner</strong><span class="screen-sharing-badge">Sharing screen</span></article><article class="media-stage-tile participant-tile"><span class="media-stage-avatar-fallback">M</span><strong>Visual Member</strong></article>';
    });
    await stabilize(page);
    await shot(page, `voice-stage-${viewport.name}.png`);

    await openCommunity(page, viewport.mobile);

    await page.locator('[data-community-menu-toggle]').click();
    await shot(page, `community-menu-${viewport.name}.png`);
    await page.locator('[data-community-menu-toggle]').click();

    await page.locator('#member-menu-toggle').click();
    await shot(page, `member-menu-${viewport.name}.png`);
    await page.locator('#member-menu-toggle').click();

    await page.goto(`/channels/${fixture.dm.id}`);
    await expect.poll(() => page.evaluate(async () => (await (await fetch('/api/v1/dms')).json()).direct_messages.reduce((total, item) => total + item.unread, 0))).toBe(0);
    await expect(page.locator('[data-dm-unread]')).toBeHidden();
    await stabilize(page);
    await shot(page, `dm-conversation-${viewport.name}.png`);

    if (viewport.mobile) await page.locator('.member-settings').evaluate(link => link.click());
    else await page.locator('.member-settings').click();
    await page.locator('[data-app-overlay] #profile-settings, [data-app-overlay] .content').first().waitFor();
    await stabilize(page);
    await shot(page, `user-settings-${viewport.name}.png`);
    await page.locator('[data-overlay-close]').click();

    await page.goto(`/channels/${fixture.textChannel.id}`);
    await stabilize(page);
    if (viewport.mobile) await page.locator('[data-sidebar-toggle]').click();
    await page.locator('[data-community-menu-toggle]').click();
    await page.locator('[data-community-menu] a[href="/admin/channels"]').first().click();
    await page.locator('[data-app-overlay] .content').waitFor();
    await stabilize(page);
    await shot(page, `community-settings-${viewport.name}.png`);

    await page.locator('[data-overlay-close]').click();
    await page.goto('/admin/soundboard');
    await page.locator('.soundboard-admin').waitFor();
    await stabilize(page);
    await shot(page, `soundboard-settings-${viewport.name}.png`);
  });
}

test('SPA-opened channel receives remote messages before local input and starts at present', async ({page}) => {
  const owner = await request.newContext({baseURL, storageState: fixture.ownerState});
  const second = await request.newContext({baseURL, storageState: fixture.secondState});
  for (let index = 0; index < 28; index++) {
    await post(owner, `/api/v1/channels/${fixture.textChannel.id}/messages`, {body: `Scroll fixture ${String(index + 1).padStart(2, '0')}`});
  }
  await authenticate(page);
  await page.goto('/');
  await page.locator(`a[href="/channels/${fixture.textChannel.id}"]`).click();
  await page.locator('#messages').waitFor();
  const remoteBody = `Remote before local input ${Date.now()}`;
  await post(second, `/api/v1/channels/${fixture.textChannel.id}/messages`, {body: remoteBody});
  await expect(page.locator('#messages')).toContainText(remoteBody);
  await expect.poll(() => page.locator('#messages').evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(3);
  await owner.dispose();
  await second.dispose();
});
