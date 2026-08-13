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
  await page.addStyleTag({content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.message-time{color:transparent!important}'});
}

async function shot(page, name) {
  await expect(page).toHaveScreenshot(name, {animations: 'disabled', caret: 'hide'});
}

async function openCommunity(page, mobile) {
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await expect.poll(() => page.evaluate(() => Boolean(window.allchatConversationWindow)), {timeout: 30_000}).toBe(true);
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

test('Voice and Video settings persist processing and volume preferences per Member', async ({page}) => {
  await authenticate(page);
  await page.goto('/voice-video');
  await expect.poll(() => page.evaluate(() => Boolean(window.AllChatRNNoise))).toBe(true);
  await expect(page.getByRole('heading', {name: 'Voice & Video'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Voice', exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Input processing'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Camera'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Advanced'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Mic Test'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Test Video'})).toBeVisible();
  await stabilize(page);
  await expect(page).toHaveScreenshot('voice-video-settings.png', {animations: 'disabled', caret: 'hide', fullPage: true});
  await page.locator('a[href="#advanced"]').click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.getByRole('heading', {name: 'Advanced'})).toBeInViewport();
  await page.getByLabel('Automatic gain control').check();
  await page.locator('input[name="inputGain"]').fill('1.5');
  await page.reload();
  await expect(page.getByLabel('Automatic gain control')).toBeChecked();
  await expect(page.locator('input[name="inputGain"]')).toHaveValue('1.5');
  await expect(page.getByLabel('Noise gate')).toBeChecked();
});

test('Voice and Video settings save when opened inside the settings overlay', async ({page}) => {
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await page.locator('.member-settings').click();
  await page.locator('[data-app-overlay] a[href="/voice-video"]').click();
  await expect(page.locator('[data-app-overlay] [data-voice-settings]')).toBeVisible();
  await page.locator('[data-app-overlay] a[href="#processing"]').click();
  await expect.poll(() => page.locator('[data-app-overlay]').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole('heading', {name: 'Input processing'})).toBeInViewport();
  await page.getByLabel('Automatic gain control').check();
  await page.locator('[data-overlay-close]').click();
  await page.locator('.member-settings').click();
  await page.locator('[data-app-overlay] a[href="/voice-video"]').click();
  await expect(page.getByLabel('Automatic gain control')).toBeChecked();
});

test('enhanced suppression initializes the local RNNoise AudioWorklet', async ({page}) => {
  await authenticate(page);
  await page.goto('/voice-video');
  await expect.poll(() => page.evaluate(() => Boolean(window.AllChatRNNoise))).toBe(true);
  const result = await page.evaluate(async () => {
    const context = new AudioContext();
    try {
      const node = await window.AllChatRNNoise.createNode(context);
      node.port.postMessage({type: 'destroy'});
      return {ready: true, state: context.state};
    } finally { await context.close(); }
  });
  expect(result.ready).toBe(true);
});

test('enhanced suppression keeps echo cancellation but does not stack browser suppression', async ({page}) => {
  await authenticate(page);
  await page.goto('/voice-video');
  await expect.poll(() => page.evaluate(() => Boolean(window.AllChatVoiceSettings))).toBe(true);
  const constraints = await page.evaluate(() => window.AllChatVoiceSettings.constraints({
    ...window.AllChatVoiceSettings.defaults,
    noiseSuppressionMode: 'enhanced',
  }));
  expect(constraints.echoCancellation).toBe(true);
  expect(constraints.noiseSuppression).toBe(false);
});

test('voice processing fallback is announced without interrupting the call', async ({page}) => {
  await authenticate(page);
  await page.goto('/voice-video');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('allchat:voice-compatibility', {detail: {message: 'Enhanced suppression is unavailable; standard suppression is active.'}})));
  await expect(page.locator('[data-voice-compatibility]')).toHaveText('Enhanced suppression is unavailable; standard suppression is active.');
  await expect(page.locator('[data-voice-compatibility]')).toHaveAttribute('role', 'status');
});

test('browser interaction reports presence activity over realtime', async ({page}) => {
  await page.addInitScript(() => {
    window.realtimeFrames = [];
    class RecordingWebSocket {
      static OPEN = 1;
      constructor() {
        this.readyState = 0;
        queueMicrotask(() => { this.readyState = RecordingWebSocket.OPEN; this.onopen?.(); });
      }
      send(raw) { window.realtimeFrames.push(JSON.parse(raw)); }
      close() { this.readyState = 3; this.onclose?.(); }
    }
    window.WebSocket = RecordingWebSocket;
  });
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await page.locator('#message-body').click();
  await expect.poll(() => page.evaluate(() => window.realtimeFrames.filter(frame => frame.type === 'activity' && frame.active).length)).toBeGreaterThan(0);
});

test('typing indicator names up to three members and summarizes larger groups', async ({page}) => {
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await expect.poll(() => page.evaluate(() => typeof window.allchatTypingSummary)).toBe('function');
  const summaries = await page.evaluate(channelID => {
    const typing = names => names.map((member_name, index) => ({member_id: `member-${index}`, member_name, channel_id: channelID}));
    return [
      window.allchatTypingSummary(typing(['Member One'])),
      window.allchatTypingSummary(typing(['Member One', 'Member Two', 'Member Three'])),
      window.allchatTypingSummary(typing(['Member One', 'Member Two', 'Member Three', 'Member Four'])),
    ];
  }, fixture.textChannel.id);
  expect(summaries).toEqual([
    'Member One is typing…',
    'Member One, Member Two, Member Three are typing…',
    'Several people are typing…',
  ]);
});

test('bounded conversation window recovers its newer edge by Conversation Sequence', async ({page}) => {
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await expect.poll(() => page.evaluate(() => Boolean(window.allchatConversationWindow)), {timeout: 30_000}).toBe(true);
  await page.locator('#messages').waitFor();
  await page.route(`**/api/v1/channels/${fixture.textChannel.id}/messages?after=300&limit=100`, route => route.fulfill({json: {
    messages: Array.from({length: 50}, (_, index) => ({id: `newer-${index + 301}`, channel_id: fixture.textChannel.id, author_id: fixture.ownerMember.id, author_name: 'visual-owner', sequence: index + 301, body: `Message ${index + 301}`, created_at: '2026-01-01T12:00:00Z'})),
    has_more: false,
    next_after: 0,
  }}));
  const result = await page.evaluate(async () => {
    const messages = document.querySelector('#messages');
    messages.replaceChildren(...Array.from({length: 350}, (_, index) => {
      const item = document.createElement('article');
      item.className = 'message'; item.id = `message-old-${index + 1}`; item.dataset.sequence = String(index + 1);
      item.style.height = '30px'; item.textContent = `Message ${index + 1}`;
      return item;
    }));
    messages.scrollTop = 0;
    window.allchatConversationWindow.trim('newer');
    const bounded = [...messages.querySelectorAll(':scope > .message')].map(item => Number(item.dataset.sequence));
    await window.allchatConversationWindow.loadPresent();
    const recovered = [...messages.querySelectorAll(':scope > .message')].map(item => Number(item.dataset.sequence));
    return {bounded, recovered, reportedSize: messages.dataset.windowSize, virtualized: messages.dataset.virtualized};
  });
  expect(result.bounded).toHaveLength(300);
  expect(result.bounded[0]).toBe(1);
  expect(result.bounded.at(-1)).toBe(300);
  expect(result.recovered).toHaveLength(80);
  expect(result.recovered[0]).toBe(271);
  expect(result.recovered.at(-1)).toBe(350);
  expect(result.reportedSize).toBe('300');
  expect(result.virtualized).toBe('220');
});

test('locally-authored Message reconciles its optimistic identity without duplication', async ({page}) => {
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await page.route(`**/api/v1/channels/${fixture.textChannel.id}/messages`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const input = route.request().postDataJSON();
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.fulfill({status: 201, json: {id: 'committed-optimistic', client_id: input.client_id, channel_id: fixture.textChannel.id, author_id: fixture.ownerMember.id, author_name: 'visual-owner', sequence: 999, body: input.body, created_at: '2026-01-01T12:00:00Z'}});
  });
  await page.locator('#message-body').fill('Optimistic Message');
  await page.locator('#composer-submit').click();
  await expect(page.locator('.message.optimistic', {hasText: 'Optimistic Message'})).toHaveCount(1);
  await expect(page.locator('#message-committed-optimistic')).toHaveCount(1);
  await expect(page.locator('#message-committed-optimistic')).not.toHaveClass(/optimistic/);
  await expect(page.locator('.message', {hasText: 'Optimistic Message'})).toHaveCount(1);
});

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
  for (let index = 0; index < 128; index++) {
    await post(owner, `/api/v1/channels/${fixture.textChannel.id}/messages`, {body: `Scroll fixture ${String(index + 1).padStart(2, '0')}`});
  }
  await authenticate(page);
  await page.goto('/');
  await page.locator(`a[href="/channels/${fixture.textChannel.id}"]`).click();
  await page.locator('#messages').waitFor();
  await expect(page.locator('#messages > .message')).toHaveCount(50);
  const remoteBody = `Remote before local input ${Date.now()}`;
  await post(second, `/api/v1/channels/${fixture.textChannel.id}/messages`, {body: remoteBody});
  await expect(page.locator('#messages')).toContainText(remoteBody);
  await page.evaluate(() => { window.replacedRealtimeSocket = window.allchatSocket; window.allchatSocket.close(); });
  await expect.poll(() => page.evaluate(() => window.allchatSocket !== window.replacedRealtimeSocket && window.allchatSocket?.readyState === WebSocket.OPEN)).toBe(true);
  const recoveredBody = `Remote after realtime recovery ${Date.now()}`;
  await post(second, `/api/v1/channels/${fixture.textChannel.id}/messages`, {body: recoveredBody});
  await expect(page.locator('#messages')).toContainText(recoveredBody);
  await expect.poll(() => page.locator('#messages').evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(3);
  await expect.poll(async () => {
    await page.locator('#messages').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
    return page.locator('#messages').textContent();
  }).toContain('Scroll fixture 01');
  await expect.poll(() => page.locator('#messages > .message').count()).toBeLessThanOrEqual(80);
  await expect.poll(async () => {
    await page.locator('#messages').evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
    return page.locator('#messages').textContent();
  }).toContain(recoveredBody);
  await expect.poll(() => page.locator('#messages > .message').count()).toBeLessThanOrEqual(300);
  await owner.dispose();
  await second.dispose();
});

test('records the representative messaging burst benchmark', async ({page}, testInfo) => {
  test.skip(process.env.ALLCHAT_BENCHMARK !== '1', 'opt-in performance benchmark');
  test.setTimeout(180_000);
  const owner = await request.newContext({baseURL, storageState: fixture.ownerState});
  const publish = async body => {
    const started = performance.now();
    await post(owner, `/api/v1/channels/${fixture.textChannel.id}/messages`, {body});
    return performance.now() - started;
  };
  for (let offset = 0; offset < 10_000; offset += 500) {
    await Promise.all(Array.from({length: 500}, (_, index) => publish(`Benchmark seed ${offset + index + 1}`)));
  }
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await page.evaluate(() => {
    window.benchmarkFrames = [];
    let previous = performance.now();
    const sample = now => { window.benchmarkFrames.push(now - previous); previous = now; if (window.benchmarkFrames.length < 1200) requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
  });
  const metric = async name => {
    const text = await (await owner.get('/metrics')).text();
    return Number(text.match(new RegExp(`^${name} (\\d+)$`, 'm'))?.[1] || 0);
  };
  const beforeTransactions = await metric('allchat_message_transactions_total');
  const beforeCommitted = await metric('allchat_messages_committed_total');
  const memoryBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
  const started = performance.now();
  const latencies = await Promise.all(Array.from({length: 1000}, (_, index) => publish(`Measured burst ${index + 1}`)));
  await expect.poll(() => metric('allchat_messages_committed_total'), {timeout: 30_000}).toBeGreaterThanOrEqual(beforeCommitted + 1000);
  await page.locator('#messages').waitFor();
  const elapsedSeconds = (performance.now() - started) / 1000;
  const afterTransactions = await metric('allchat_message_transactions_total');
  const frames = await page.evaluate(() => (window.benchmarkFrames || []).slice(1));
  const percentile = (values, quantile) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * quantile))] || 0;
  const report = {
    existing_messages: 10_000,
    burst_messages: 1000,
    publication_latency_ms: {p50: percentile(latencies, 0.50), p95: percentile(latencies, 0.95), p99: percentile(latencies, 0.99)},
    sqlite_transactions_per_second: (afterTransactions - beforeTransactions) / elapsedSeconds,
    realtime_queue_high_water: await page.evaluate(() => Number(sessionStorage.getItem('allchat.realtime.queue_high_water') || 0)),
    browser_frame_ms_p95: percentile(frames, 0.95),
    message_dom_nodes: await page.locator('#messages > .message').count(),
    browser_heap_bytes: {before: memoryBefore, after: await page.evaluate(() => performance.memory?.usedJSHeapSize || 0)},
  };
  expect(report.message_dom_nodes).toBeLessThanOrEqual(80);
  expect(report.sqlite_transactions_per_second).toBeGreaterThan(0);
  await testInfo.attach('messaging-benchmark.json', {body: JSON.stringify(report, null, 2), contentType: 'application/json'});
  console.log(`MESSAGING_BENCHMARK ${JSON.stringify(report)}`);
  await owner.dispose();
});

test('Community Member rail appears outside DMs, settings, and Voice Room grids', async ({page}) => {
  await authenticate(page);
  await page.goto('/');
  const homeRail = page.locator('.content-shell > .participant-sidebar');
  await expect(homeRail).toBeVisible();
  await expect(homeRail.locator('[data-participant-id]')).toHaveCount(2);
  await expect(homeRail.locator('[data-member-group]')).toHaveCount(3);
  await expect(homeRail.locator('[data-member-group="owner"]')).toContainText('visual-owner');
  await expect(homeRail.locator('[data-member-group="offline"]')).toContainText('visual-member');
  await page.evaluate(({ownerID, memberID}) => window.updateAllChatMemberPresence({[ownerID]: 'online', [memberID]: 'dnd'}), {ownerID: fixture.ownerMember.id, memberID: fixture.secondMember.id});
  await expect(homeRail.locator('[data-member-group="online"]')).toContainText('visual-member');
  await expect(homeRail.locator('[data-member-group="online"] .participant-presence')).toHaveClass(/dnd/);
  await page.evaluate(({ownerID, memberID}) => window.updateAllChatMemberPresence({[ownerID]: 'online', [memberID]: 'idle'}), {ownerID: fixture.ownerMember.id, memberID: fixture.secondMember.id});
  await expect(homeRail.locator(`[data-participant-id="${fixture.secondMember.id}"] .participant-presence`)).toHaveClass(/idle/);
  await expect(homeRail.locator('[data-member-group="online"]')).toContainText('visual-member');
  await page.evaluate(({ownerID, memberID}) => window.updateAllChatMemberPresence({[ownerID]: 'online', [memberID]: 'mobile'}), {ownerID: fixture.ownerMember.id, memberID: fixture.secondMember.id});
  await expect(homeRail.locator(`[data-participant-id="${fixture.secondMember.id}"] .participant-presence`)).toHaveClass(/mobile/);
  await expect(homeRail.locator(`[data-participant-id="${fixture.secondMember.id}"] .participant-presence`)).toHaveAttribute('aria-label', 'Online on mobile');

  await page.locator(`a[href="/channels/${fixture.textChannel.id}"]`).click();
  await expect(page.locator('.channel-content .participant-sidebar')).toBeVisible();
  await expect(page.locator('.channel-content .participant-sidebar [data-member-group]')).toHaveCount(3);

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

test('notification bell remains interactive after in-app Direct Message navigation', async ({page}) => {
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await page.locator('[data-dm-button]').click();
  await expect(page).toHaveURL(/\/dms$/);
  const bell = page.locator('[data-notification-bell]');
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.locator('.notification-popover')).toBeVisible();
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
  await expect(previews.filter({hasText: 'example-notes.txt'}).locator('.attachment-file-icon svg')).toHaveAttribute('data-lucide', 'file');
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
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/attachments') attachmentUploads++; });
  await page.locator('#message-body').fill('Message with a selected image');
  await page.locator('#composer-submit').click();
  const sentMessage = page.locator('.message').filter({hasText: 'Message with a selected image'});
  await expect(sentMessage).toBeVisible();
  await expect(sentMessage.locator('.message-image')).toHaveAttribute('src', /\/api\/v1\/attachments\/.+\/preview$/);
  const originalURL = await sentMessage.locator('.message-image-button').getAttribute('data-original-src');
  await sentMessage.locator('.message-image-button').click();
  await expect(page.locator('.message-image-dialog img')).toHaveAttribute('src', originalURL);
  await page.locator('.message-image-dialog button').click();
  await expect(page.locator('#attachment-previews')).toBeHidden();
  expect(attachmentUploads).toBe(1);
});

test('composer reports the attachment limit before starting an oversized upload', async ({page}) => {
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  let attachmentUploads = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/attachments') attachmentUploads++; });
  const notice = new Promise(resolve => page.once('dialog', dialog => { const message = dialog.message(); dialog.dismiss(); resolve(message); }));

  await page.locator('#attachment').setInputFiles({name: 'oversized.apk', mimeType: 'application/vnd.android.package-archive', buffer: Buffer.alloc(10 * 1024 * 1024 + 1)});

  await expect(notice).resolves.toContain('oversized.apk is 10.0 MiB. This Instance allows attachments up to 10 MiB.');
  await expect(page.locator('[data-attachment-preview]')).toHaveCount(0);
  expect(attachmentUploads).toBe(0);
});

test('composer accepts files dropped onto it', async ({page}) => {
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await page.locator('#composer').evaluate(composer => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['dropped attachment'], 'dropped-notes.txt', {type: 'text/plain'}));
    composer.dispatchEvent(new DragEvent('dragenter', {bubbles: true, cancelable: true, dataTransfer: transfer}));
    composer.dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: transfer}));
  });
  await expect(page.locator('[data-attachment-preview]')).toHaveCount(1);
  await expect(page.locator('[data-attachment-preview]')).toContainText('dropped-notes.txt');
  await expect(page.locator('#composer')).not.toHaveClass(/file-drag-active/);
});

test('composer accepts pasted files without intercepting ordinary text paste', async ({page}) => {
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  const input = page.locator('#message-body');
  const textPastePrevented = await input.evaluate(element => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', 'Pasted message text');
    const event = new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: clipboard});
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(textPastePrevented).toBe(false);
  const filePastePrevented = await input.evaluate(element => {
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'clipboard-image.png', {type: 'image/png'}));
    clipboard.items.add(new File([new Uint8Array([79, 103, 103, 83])], 'clipboard-song.ogg', {type: 'audio/ogg'}));
    const event = new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: clipboard});
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(filePastePrevented).toBe(true);
  const previews = page.locator('[data-attachment-preview]');
  await expect(previews).toHaveCount(2);
  await expect(previews.filter({hasText: 'clipboard-image.png'}).locator('img')).toBeVisible();
  await expect(previews.filter({hasText: 'clipboard-song.ogg'}).locator('.attachment-file-icon svg')).toHaveAttribute('data-lucide', 'music');
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

test('messages asynchronously render link preview cards', async ({page}) => {
  await page.route('**/api/v1/link-preview?**', async route => {
    await route.fulfill({json: {
      url: 'https://news.example.test/articles/example',
      site_name: 'Example News',
      title: 'A useful example article',
      description: 'A short preview description for the linked page.',
    }});
  });
  await authenticate(page);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  await page.locator('#message-body').fill('Read https://news.example.test/articles/example');
  await page.locator('#composer-submit').click();
  const message = page.locator('.message').filter({hasText: 'A useful example article'});
  const preview = message.locator('[data-link-preview]');
  await expect(preview).toBeVisible();
  await expect(preview.locator('.link-preview-site')).toHaveText('Example News');
  await expect(preview.locator('.link-preview-description')).toContainText('short preview description');
  await expect(preview).toHaveAttribute('href', 'https://news.example.test/articles/example');
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

test('accepting an incoming Direct Call outside its DM opens the call workspace', async ({page}) => {
  const owner = await request.newContext({baseURL, storageState: fixture.ownerState});
  await page.context().addCookies(fixture.secondState.cookies);
  await page.goto(`/channels/${fixture.textChannel.id}`);
  const started = await post(owner, `/api/v1/dms/${fixture.dm.id}/calls`, {});
  const banner = page.locator('.call-banner');
  await expect(banner).toContainText('Incoming Direct Call', {timeout: 3000});

  await banner.getByRole('button', {name: 'Accept'}).click();

  await expect(page).toHaveURL(new RegExp(`/channels/${fixture.dm.id}$`));
  await expect(page.locator('.channel-topic')).toHaveText('Direct Message');
  await post(owner, `/api/v1/calls/${started.id}/end`, {});
  await owner.dispose();
});

test('Direct Call caller connects after the recipient accepts', async ({browser}) => {
  const callerContext = await browser.newContext({storageState: fixture.ownerState, permissions: ['microphone']});
  const recipientContext = await browser.newContext({storageState: fixture.secondState});
  const recipientAPI = await request.newContext({baseURL, storageState: fixture.secondState});
  const caller = await callerContext.newPage();
  const recipient = await recipientContext.newPage();
  await caller.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', {configurable: true, value: {getUserMedia: async () => { window.__callMicrophoneRequests = (window.__callMicrophoneRequests || 0) + 1; return new MediaStream(); }}}));
  await caller.goto(`/channels/${fixture.dm.id}`);
  await recipient.goto('/login');
  await caller.getByRole('button', {name: 'Start Call'}).click();
  await expect.poll(() => caller.evaluate(() => window.__callMicrophoneRequests || 0)).toBe(1);
  await expect.poll(async () => (await recipientAPI.get('/api/v1/calls/current')).status()).toBe(200);
  const currentResponse = await recipientAPI.get('/api/v1/calls/current');
  const current = await currentResponse.json();
  await post(recipientAPI, `/api/v1/calls/${current.id}/accept`, {});
  const recipientConnected = recipient.evaluate(async callID => {
    const peer = new RTCPeerConnection();
    peer.addTransceiver('audio', {direction: 'sendrecv'});
    peer.addTransceiver('video', {direction: 'recvonly'});
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const socket = new WebSocket(`ws://${location.host}/api/v1/media`);
    return new Promise((resolve, reject) => {
      socket.onopen = () => socket.send(JSON.stringify({version: 1, type: 'join', room_id: callID, sdp: peer.localDescription}));
      socket.onerror = reject;
      socket.onmessage = async event => {
        const frame = JSON.parse(event.data);
        if (frame.type === 'error') reject(new Error(frame.error));
        if (frame.type === 'answer') { await peer.setRemoteDescription(frame.sdp); window.__mobileLikeCall = {peer, socket}; resolve(true); }
      };
    });
  }, current.id);
  await expect(recipientConnected).resolves.toBe(true);
  await expect(caller.locator('[data-call-status]')).toHaveText('Direct Call connected', {timeout: 10_000});
  await caller.getByRole('button', {name: 'End Call'}).click();
  await recipientAPI.dispose();
  await callerContext.close();
  await recipientContext.close();
});
