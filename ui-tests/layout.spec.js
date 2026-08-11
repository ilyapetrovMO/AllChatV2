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

async function uploadFile(context, name, mimeType, buffer) {
  const response = await context.post('/api/v1/attachments', {data: buffer, headers: {'X-CSRF-Token': await csrf(context), 'X-AllChat-Filename': name, 'Content-Type': mimeType}});
  if (!response.ok()) throw new Error(`attachment upload: ${response.status()} ${await response.text()}`);
  return response.json();
}

function wavFixture() {
  const samples = 800, rate = 8000, data = Buffer.alloc(samples, 128), value = Buffer.alloc(44 + samples);
  value.write('RIFF', 0); value.writeUInt32LE(36 + samples, 4); value.write('WAVEfmt ', 8);
  value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22);
  value.writeUInt32LE(rate, 24); value.writeUInt32LE(rate, 28); value.writeUInt16LE(1, 32); value.writeUInt16LE(8, 34);
  value.write('data', 36); value.writeUInt32LE(samples, 40); data.copy(value, 44);
  return value;
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
  await page.locator('[data-notification-bell]').waitFor();
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
    await page.locator('[data-notification-bell]').waitFor();
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
    await page.locator('[data-notification-bell]').waitFor();
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
  for (let index = 0; index < 78; index++) {
    await post(owner, `/api/v1/channels/${fixture.textChannel.id}/messages`, {body: `Scroll fixture ${String(index + 1).padStart(2, '0')}`});
  }
  await authenticate(page);
  await page.goto('/');
  await page.locator(`a[href="/channels/${fixture.textChannel.id}"]`).click();
  await page.locator('#messages').waitFor();
  const remoteBody = `Remote before local input ${Date.now()}`;
  await post(second, `/api/v1/channels/${fixture.textChannel.id}/messages`, {body: remoteBody});
  await expect(page.locator('#messages')).toContainText(remoteBody);
  await page.evaluate(() => { window.replacedRealtimeSocket = window.allchatSocket; window.allchatSocket.close(); });
  await expect.poll(() => page.evaluate(() => window.allchatSocket !== window.replacedRealtimeSocket && window.allchatSocket?.readyState === WebSocket.OPEN)).toBe(true);
  const recoveredBody = `Remote after realtime recovery ${Date.now()}`;
  await post(second, `/api/v1/channels/${fixture.textChannel.id}/messages`, {body: recoveredBody});
  await expect(page.locator('#messages')).toContainText(recoveredBody);
  await expect.poll(() => page.locator('#messages').evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(3);
  await page.locator('#messages').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('#messages')).toContainText('Scroll fixture 01');
  await owner.dispose();
  await second.dispose();
});

test('Community Member rail appears outside DMs, settings, and Voice Room grids', async ({page}) => {
  await authenticate(page);
  await page.goto('/');
  const homeRail = page.locator('.content-shell > .participant-sidebar');
  await expect(homeRail).toBeVisible();
  await expect(homeRail.locator('[data-participant-id]')).toHaveCount(2);

  await page.locator(`a[href="/channels/${fixture.textChannel.id}"]`).click();
  await expect(page.locator('.channel-content .participant-sidebar')).toBeVisible();

  await page.goto(`/channels/${fixture.dm.id}`);
  await expect(page.locator('.participant-sidebar .dm-profile-card')).toBeVisible();
  await expect(page.locator('.participant-sidebar .participant-list')).toHaveCount(0);

  await page.goto(`/channels/${fixture.voiceChannel.id}`);
  await expect(page.locator('[data-media-stage-grid]')).toBeVisible();
  await expect(page.locator('.content-shell > .participant-sidebar')).toHaveCount(0);

  await page.goto('/profile');
  await expect(page.locator('.content-shell > .participant-sidebar')).toHaveCount(0);
});

test('notification bell persists Community and conversation overrides', async ({page}) => {
  const owner = await request.newContext({baseURL, storageState: fixture.ownerState});
  const token = await csrf(owner);
  let response = await owner.put('/api/v1/notification-settings', {data: {level: 'mentions_only', muted: false, sound_enabled: false}, headers: {'X-CSRF-Token': token}});
  expect(response.status()).toBe(204);
  response = await owner.put(`/api/v1/channels/${fixture.textChannel.id}/notification-settings`, {data: {level: 'all_messages', muted: true}, headers: {'X-CSRF-Token': token}});
  expect(response.status()).toBe(204);
  const settings = await (await owner.get('/api/v1/notification-settings')).json();
  expect(settings.community).toEqual({level: 'mentions_only', muted: false, sound_enabled: false});
  expect(settings.channels[fixture.textChannel.id]).toEqual({level: 'all_messages', muted: true});

  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await page.locator('[data-notification-bell]').click();
  const popover = page.locator('.notification-popover');
  await expect(popover).toBeVisible();
  await expect(popover.locator('label').filter({hasText: 'Community'}).locator('select')).toHaveValue('mentions_only');
  await expect(popover.locator('label').filter({hasText: 'This conversation'}).locator('select')).toHaveValue('all_messages');
  await expect(popover.getByText('Mute conversation').locator('input')).toBeChecked();
  await owner.put('/api/v1/notification-settings', {data: {level: 'all_messages', muted: false, sound_enabled: true}, headers: {'X-CSRF-Token': token}});
  await owner.put(`/api/v1/channels/${fixture.textChannel.id}/notification-settings`, {data: {level: 'default', muted: false}, headers: {'X-CSRF-Token': token}});
  await owner.dispose();
});

test('notification bell opens with defaults when settings are temporarily unavailable', async ({page}) => {
  await authenticate(page);
  await page.route('**/api/v1/notification-settings', route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'temporarily unavailable'})}));
  await page.goto(`/channels/${fixture.textChannel.id}`);
  const bell = page.locator('[data-notification-bell]');
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.locator('.notification-popover')).toBeVisible();
});

test('mobile Direct Messages always provide a route back to the Community', async ({page}) => {
  await page.setViewportSize({width: 412, height: 915});
  await authenticate(page);
  await page.goto('/dms');
  const headerReturn = page.locator('.content-header [data-community-return]');
  await expect(headerReturn).toBeVisible();
  await expect(headerReturn).toHaveAttribute('href', '/');
  await page.locator('[data-sidebar-toggle]').click();
  const drawerReturn = page.locator('.channel-sidebar [data-community-return]');
  await expect(drawerReturn).toBeVisible();
  await expect(drawerReturn).toHaveAttribute('href', '/');
});

test('realtime Messages notify for another conversation but not the focused conversation', async ({page}) => {
  await page.addInitScript(() => {
    window.desktopNotices = [];
    window.Notification = class {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
      constructor(title, options) { window.desktopNotices.push({title, body: options.body}); }
      close() {}
    };
  });
  const sender = await request.newContext({baseURL, storageState: fixture.secondState});
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await expect.poll(() => page.evaluate(() => window.allchatNotifications && window.allchatSocket?.readyState === WebSocket.OPEN)).toBeTruthy();
  await post(sender, `/api/v1/dms/${fixture.dm.id}/messages`, {body: 'A notification from another conversation'});
  await expect.poll(() => page.evaluate(() => window.desktopNotices.length)).toBe(1);
  await post(sender, `/api/v1/channels/${fixture.textChannel.id}/messages`, {body: 'Visible without a desktop toast'});
  await expect(page.locator('#messages')).toContainText('Visible without a desktop toast');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.desktopNotices.length)).toBe(1);
  await sender.dispose();
});

test('soundboard upload works when administration is opened in the settings overlay', async ({page}) => {
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await page.locator('[data-community-menu-toggle]').click();
  await page.locator('[data-community-menu] a[href="/admin/soundboard"]').click();
  const upload = page.locator('[data-app-overlay] #sound-upload');
  await upload.locator('[name="name"]').fill('Example tone');
  await upload.locator('[name="emoji"]').fill('🔔');
  await upload.locator('[name="file"]').setInputFiles({name: 'example-tone.wav', mimeType: 'audio/wav', buffer: wavFixture()});
  const request = page.waitForRequest(value => value.method() === 'POST' && value.url().endsWith('/api/v1/soundboard'));
  await upload.locator('button').click();
  await request;
  await expect(page.locator('[data-app-overlay] #sound-status')).toHaveText('Sound uploaded.');
  const card = page.locator('[data-app-overlay] .sound-card').filter({hasText: 'Example tone'});
  await expect(card).toContainText('0.1s');
  expect(page.url()).not.toContain('csrf_token=');
  await page.locator('[data-app-overlay] #sound-settings [name="seconds"]').fill('12');
  await page.locator('[data-app-overlay] #sound-settings button').click();
  await expect(page.locator('[data-app-overlay] #sound-status')).toHaveText('Sound duration limit saved.');
  await card.locator('.button-danger').click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('[data-app-overlay] .soundboard-empty')).toBeVisible();
});

test('composer aligns controls, fills the member rail, and previews removable attachments', async ({page}) => {
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  const input = page.locator('#attachment');
  await input.setInputFiles([
    {name: 'example-image.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')},
    {name: 'example-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Example attachment')},
  ]);
  const previews = page.locator('[data-attachment-preview]');
  await expect(previews).toHaveCount(2);
  await expect(previews.filter({hasText: 'example-image.png'}).locator('img')).toBeVisible();
  await expect(previews.filter({hasText: 'example-notes.txt'}).locator('.attachment-file-icon')).toHaveText('📄');
  await previews.filter({hasText: 'example-notes.txt'}).getByRole('button', {name: 'Remove attachment'}).click();
  await expect(previews).toHaveCount(1);
  await expect(previews).not.toContainText('example-notes.txt');
  const geometry = await page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect();
    const memberRail = box('.participant-sidebar'), add = box('.attachment-button'), send = box('#composer-submit'), body = box('#message-body');
    const center = value => value.top + value.height / 2;
    return {viewportBottom: innerHeight, viewportRight: innerWidth, memberRailBottom: memberRail.bottom, memberRailRight: memberRail.right, addCenter: center(add), sendCenter: center(send), bodyCenter: center(body)};
  });
  expect(Math.abs(geometry.viewportBottom - geometry.memberRailBottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.viewportRight - geometry.memberRailRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.addCenter - geometry.bodyCenter)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.sendCenter - geometry.bodyCenter)).toBeLessThanOrEqual(1);
  await stabilize(page);
  await expect(page.locator('#attachment-previews')).toHaveScreenshot('composer-attachment-preview.png', {animations: 'disabled', caret: 'hide'});
  let attachmentUploads = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/attachments')) attachmentUploads++; });
  await page.locator('#message-body').fill('Message with a selected image');
  await page.locator('#composer-submit').click();
  await expect(page.locator('#messages')).toContainText('Message with a selected image');
  await expect(page.locator('#attachment-previews')).toBeHidden();
  expect(attachmentUploads).toBe(1);
});

test('incoming audio and video attachments render as players and survive reload', async ({page}) => {
  const sender = await request.newContext({baseURL, storageState: fixture.secondState});
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await expect.poll(() => page.evaluate(() => window.allchatSocket?.readyState === WebSocket.OPEN)).toBe(true);
  const video = await uploadFile(sender, 'example-video.webm', 'video/webm', Buffer.from('example video payload'));
  const audio = await uploadFile(sender, 'example-audio.ogg', 'audio/ogg', Buffer.from('example audio payload'));
  await post(sender, `/api/v1/channels/${fixture.textChannel.id}/messages`, {body: 'Playable media examples', attachment_ids: [video.id, audio.id]});
  const message = page.locator('.message').filter({hasText: 'Playable media examples'});
  await expect(message.locator('video.message-video[controls]')).toHaveCount(1);
  await expect(message.locator('audio.message-audio[controls]')).toHaveCount(1);
  await expect(message.locator('video source')).toHaveAttribute('type', 'video/webm');
  await expect(message.locator('audio source')).toHaveAttribute('type', 'audio/ogg');
  await page.reload();
  const persisted = page.locator('.message').filter({hasText: 'Playable media examples'});
  await expect(persisted.locator('video.message-video[controls]')).toHaveCount(1);
  await expect(persisted.locator('audio.message-audio[controls]')).toHaveCount(1);
  await sender.dispose();
});

test('message authors open the member popover and replies retain their target', async ({page}) => {
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);

  const message = page.locator('#messages .message').first();
  await message.locator('strong').click();
  await expect(page.locator('.member-popover')).toBeVisible();

  await page.locator('#message-body').click();
  await message.hover();
  await message.locator('[data-reply-message]').click();
  await expect(page.locator('.composer-wrap .editing-banner[role="status"]')).toContainText('Replying to');

  const sent = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith(`/api/v1/channels/${fixture.textChannel.id}/messages`));
  await page.locator('#message-body').fill(`Reply UI fixture ${Date.now()}`);
  await page.locator('#composer-submit').click();
  const request = await sent;
  expect(request.postDataJSON().reply_to).toBe(await message.getAttribute('id').then(id => id.replace('message-', '')));
  await expect(page.locator('#messages .message').last().locator('.reply-preview')).toContainText('Reply to');
  await expect(page.locator('.composer-wrap .editing-banner[role="status"]')).toBeHidden();
});

test('voice sidebar participants support profile and context interactions', async ({page}) => {
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await addVoiceState(page);

  const participant = page.locator('[data-voice-participants] [data-participant-id]').first();
  await participant.click();
  await expect(page.locator('.member-popover')).toBeVisible();
  await page.locator('#message-body').click();

  await participant.click({button: 'right'});
  const menu = page.locator('.voice-member-context');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Profile');
  await expect(menu).toContainText('Copy User ID');
});

test('member settings expose avatar upload and removal', async ({page}) => {
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await page.locator('.member-settings').click();
  await expect(page.locator('[data-app-overlay]')).toBeVisible();
  await expect(page.locator('[data-avatar-control] input[type="file"]')).toBeAttached();
  await expect(page.locator('[data-avatar-save]')).toHaveText('Upload avatar');
  await expect(page.locator('[data-avatar-remove]')).toHaveText('Remove avatar');
  await page.locator('[data-avatar-control] input[type="file"]').setInputFiles({name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')});
  await page.locator('[data-avatar-save]').click();
  await expect(page.locator('[data-avatar-status]')).toHaveText('Avatar updated.');
  await expect(page.locator('[data-avatar-control] img')).toBeVisible();
  await expect(page.locator('[data-avatar-control] .member-avatar-fallback')).toBeHidden();
  const avatarLayout = await page.locator('[data-avatar-control]').evaluate(control => {
    const box = selector => control.querySelector(selector).getBoundingClientRect();
    const preview = box('.profile-avatar-preview'), file = box('input[type="file"]'), upload = box('[data-avatar-save]'), remove = box('[data-avatar-remove]');
    return {previewRight: preview.right, fileLeft: file.left, fileBottom: file.bottom, uploadTop: upload.top, uploadBottom: upload.bottom, removeTop: remove.top, removeBottom: remove.bottom};
  });
  expect(avatarLayout.previewRight).toBeLessThan(avatarLayout.fileLeft);
  expect(avatarLayout.uploadTop).toBeGreaterThanOrEqual(avatarLayout.fileBottom);
  expect(avatarLayout.removeTop).toBe(avatarLayout.uploadTop);
  expect(avatarLayout.removeBottom).toBe(avatarLayout.uploadBottom);
  await stabilize(page);
  await shot(page, 'avatar-editor-uploaded.png');
  await page.goto('/profile');
  await expect(page.locator('[data-avatar-control] img')).toBeVisible();
  await expect(page.locator('[data-avatar-control] img')).toHaveAttribute('src', /\/api\/v1\/members\/.+\/avatar/);
  await expect(page.locator('[data-avatar-control] .member-avatar-fallback')).toBeHidden();
  await page.locator('[data-avatar-remove]').click();
  await expect(page.locator('[data-avatar-status]')).toHaveText('Avatar removed.');
  await expect(page.locator('[data-avatar-control] img')).toBeHidden();
  await expect(page.locator('[data-avatar-control] .member-avatar-fallback')).toBeVisible();
});

test('returning from a directly opened settings page installs Community styles', async ({page}) => {
  await authenticate(page);
  await page.goto('/profile');
  await expect(page.locator('link[href="/assets/channel.css"]')).toHaveCount(0);
  await page.locator('.settings-nav a[href="/"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('link[href="/assets/channel.css"]')).toHaveCount(1);
  await expect(page.locator('.channel-link').first()).toHaveCSS('display', 'flex');
});

test('community mark closes settings without rebuilding the underlying conversation', async ({page}) => {
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await page.locator('.member-settings').click();
  await expect(page.locator('[data-app-overlay]')).toBeVisible();
  await page.locator('[data-app-overlay] .community-mark[href="/"]').click();
  await expect(page.locator('[data-app-overlay]')).toHaveCount(0);
  await expect(page.locator('.channel-content')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/channels/${fixture.textChannel.id}$`));
});

test('incoming one-to-one calls surface outside the DM and can be declined', async ({page}) => {
  const owner = await request.newContext({baseURL, storageState: fixture.ownerState});
  await authenticate(page);
  await page.context().clearCookies();
  await page.context().addCookies(fixture.secondState.cookies);
  await page.goto(`/channels/${fixture.textChannel.id}`);

  const started = await post(owner, `/api/v1/dms/${fixture.dm.id}/calls`, {});
  const banner = page.locator('.call-banner');
  await expect(banner).toContainText('Incoming Direct Call', {timeout: 3000});
  await expect(banner.getByRole('button', {name: 'Accept'})).toBeVisible();
  await banner.getByRole('button', {name: 'Decline'}).click();
  await expect(banner).toBeHidden();
  const current = await owner.get('/api/v1/calls/current');
  expect(current.status()).toBe(204);
  expect(started.state).toBe('ringing');
  await owner.dispose();
});
