const { test, expect, request } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let fixture;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const owner = await request.newContext({ baseURL: 'http://127.0.0.1:4173' });
  const directory = fs
    .readFileSync(path.join(os.tmpdir(), 'allchat-playwright-data-path'), 'utf8')
    .trim();
  const token = fs.existsSync(path.join(directory, 'setup.token'))
    ? fs.readFileSync(path.join(directory, 'setup.token'), 'utf8').trim()
    : '';
  let response = await owner.post('/api/v1/auth/setup', {
    data: { token, username: 'design-owner', password: 'web design test password' },
  });
  if (response.status() !== 201)
    response = await owner.post('/api/v1/auth/login', {
      data: { username: 'design-owner', password: 'web design test password' },
    });
  expect(response.ok()).toBeTruthy();
  const csrf = (await owner.storageState()).cookies.find((c) => c.name === 'allchat_csrf').value;
  const post = async (url, data) => {
    const result = await owner.post(url, { data, headers: { 'X-CSRF-Token': csrf } });
    expect(result.ok(), url).toBeTruthy();
    return result.json();
  };
  const category = await post('/api/v1/categories', { name: 'Design review', position: 1 });
  const channel = await post('/api/v1/channels', {
    name: 'design-chat',
    type: 'text',
    category_id: category.id,
    position: 1,
  });
  const voice = await post('/api/v1/channels', {
    name: 'Lounge',
    type: 'voice',
    category_id: category.id,
    position: 2,
  });
  const message = await post(`/api/v1/channels/${channel.id}/messages`, {
    body: 'A message to edit inline.',
  });
  // A real attachment exercises both server HTML and live rendering metadata.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0b8AAAAASUVORK5CYII=',
    'base64',
  );
  const upload = await owner.post('/api/v1/attachments?filename=sample.png', {
    data: png,
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'image/png' },
  });
  expect(upload.ok()).toBeTruthy();
  const attachment = await upload.json();
  await post(`/api/v1/channels/${channel.id}/messages`, {
    body: 'Attached image',
    attachment_ids: [attachment.id],
  });
  const invitation = await post('/api/v1/invitations', { expires_in_minutes: 60, max_uses: 1 });
  const second = await request.newContext({ baseURL: 'http://127.0.0.1:4173' });
  const registered = await second.post('/api/v1/auth/register', {
    data: {
      token: invitation.token,
      username: 'design-member-' + Date.now(),
      password: 'web design test password',
    },
  });
  expect(registered.ok()).toBeTruthy();
  const member = await registered.json();
  const dm = await post('/api/v1/dms', { member_id: member.id });
  fixture = {
    state: await owner.storageState(),
    secondState: await second.storageState(),
    channel,
    voice,
    message,
    dm,
    member,
  };
  await second.dispose();
  await owner.dispose();
});
test('desktop styling, inline edit, image menus and responsive settings', async ({ browser }) => {
  const context = await browser.newContext({
    storageState: fixture.state,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/channels/${fixture.channel.id}`);
  await expect(page.locator('.floating-member-panel')).toBeVisible();
  expect((await page.locator('.floating-member-panel').boundingBox()).x).toBeLessThan(16);
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(24, 25, 30)',
  );
  await expect(page.getByRole('button', { name: 'Input controls', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Input controls', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Input controls' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    window.renderAllChatMessage(
      {
        id: 'foreign-call',
        channel_id: 'another-dm',
        created_at: new Date().toISOString(),
        call_event: { state: 'ringing', caller_id: 'other' },
      },
      'message.created',
    ),
  );
  await expect(page.locator('#message-foreign-call')).toHaveCount(0);
  await page.locator('#message-body').fill('Keep this draft');
  const row = page.locator(`#message-${fixture.message.id}`);
  await row.hover();
  await row.locator('[data-edit-message]').click();
  await expect(row.getByRole('textbox', { name: 'Edit message' })).toBeVisible();
  await expect(page.locator('#message-body')).toHaveValue('Keep this draft');
  await row.getByRole('textbox', { name: 'Edit message' }).fill('Edited in place');
  await row.getByRole('textbox', { name: 'Edit message' }).press('Enter');
  await expect(row.locator('.body')).toHaveText('Edited in place');
  await expect(row.locator('.inline-message-editor')).toHaveCount(0);
  const picture = page.locator('.message-image-button').first();
  await picture.click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Image actions' })).toContainText('sample.png');
  await expect(page.getByRole('menuitem', { name: 'Download', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await picture.click();
  await page.locator('.message-image-dialog img').click({ button: 'right' });
  await expect(page.locator('.message-image-dialog .image-context-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Close image' }).click();
  await picture.click({ button: 'right' });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('sample.png');
  await page.screenshot({ path: '/tmp/web-design-chat.png' });
  for (const url of [
    '/profile',
    '/voice-video',
    '/admin/settings',
    '/admin/channels',
    '/admin/roles',
    '/admin/invitations',
    '/admin/soundboard',
  ]) {
    await page.goto(url);
    await expect(page.locator('.content-shell')).toBeVisible();
    expect((await page.locator('.content-shell').boundingBox()).width).toBeGreaterThan(600);
    expect(await page.locator('body').evaluate((el) => el.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.screenshot({ path: '/tmp/web-design-settings.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/channels/${fixture.channel.id}`);
  expect(await page.locator('body').evaluate((el) => el.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Open conversation navigation' }).click();
  await expect(page.locator('.floating-member-panel')).toBeVisible();
  await expect
    .poll(async () => Math.round((await page.locator('.channel-sidebar').boundingBox()).x))
    .toBe(0);
  await page.screenshot({ path: '/tmp/web-design-mobile.png' });
  expect(errors).toEqual([]);
  await context.close();
});
test('shared call tiles maximize 16:9 sizes and center partial rows', async ({ browser }) => {
  const context = await browser.newContext({
    storageState: fixture.state,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto(`/channels/${fixture.voice.id}`);
  for (const count of [1, 2, 3, 4, 5, 6, 7]) {
    await page.evaluate((count) => {
      const grid = document.querySelector('[data-media-stage-grid]');
      grid.replaceChildren(
        ...Array.from({ length: count }, (_, i) => {
          const tile = document.createElement('article');
          tile.className = 'media-stage-tile participant-tile';
          tile.innerHTML = `<div class="media-stage-visual"><span class="media-stage-avatar-fallback">${i + 1}</span></div><strong>Member ${i + 1}</strong>`;
          return tile;
        }),
      );
      window.AllChatDesign.layoutGrid(grid);
    }, count);
    await page.waitForTimeout(80);
    const data = await page.locator('[data-media-stage-grid]').evaluate((grid) => {
      const box = grid.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        tiles: [...grid.children].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
          };
        }),
      };
    });
    for (const tile of data.tiles) {
      expect(Math.abs(tile.width / tile.height - 16 / 9)).toBeLessThan(0.02);
      expect(tile.right).toBeLessThanOrEqual(data.right + 1);
      expect(tile.bottom).toBeLessThanOrEqual(data.bottom + 1);
    }
    const rows = new Map();
    for (const tile of data.tiles) {
      const key = Math.round(tile.y);
      rows.set(key, [...(rows.get(key) || []), tile]);
    }
    for (const row of rows.values())
      expect(
        Math.abs((row[0].x + row.at(-1).right) / 2 - (data.left + data.right) / 2),
      ).toBeLessThan(2);
  }
  await page.screenshot({ path: '/tmp/web-design-voice-seven.png' });
  await context.close();
});
async function mockMedia(page) {
  for (const name of ['rnnoise', 'voice-settings', 'voice-connection'])
    await page.route(`**/assets/${name}.js`, (route) =>
      route.fulfill({ contentType: 'application/javascript', body: '' }),
    );
  await page.addInitScript(() => {
    const track = { enabled: true, kind: 'audio', stop() {} };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    window.sentMedia = [];
    window.AllChatRNNoise = {};
    window.AllChatVoiceSettings = {
      load: () => ({ inputGain: 1, outputVolume: 1, noiseSuppressionMode: 'standard' }),
      applyOutput() {},
      prepare: async (dependencies) => [
        { stream, stop() {}, settings: {} },
        ...(await Promise.all(dependencies)),
      ],
      capture: async () => ({ stream, stop() {}, settings: {} }),
    };
    window.AllChatVoiceConnection = class {
      constructor(options) {
        this.options = options;
        this.stream = options.stream;
        this.peer = {
          connectionState: 'connected',
          getStats: async () =>
            new Map([
              [
                'pair',
                {
                  type: 'candidate-pair',
                  state: 'succeeded',
                  nominated: true,
                  currentRoundTripTime: 0.105,
                },
              ],
            ]),
          getSenders: () => [],
        };
      }
      async start() {
        this.stopped = false;
        this.state = 'connected';
        this.options.onState('connected');
      }
      stop() {
        this.stopped = true;
      }
      send(type, data) {
        window.sentMedia.push({ type, ...data });
      }
      async setVideoTrack() {}
      async clearVideoTrack() {}
      async setDisplayAudioTrack() {}
    };
  });
}
test('connected member panel keeps all four actions and soundboard open', async ({ browser }) => {
  const context = await browser.newContext({
      storageState: fixture.state,
      viewport: { width: 1280, height: 800 },
    }),
    page = await context.newPage();
  await mockMedia(page);
  await page.route('**/api/v1/soundboard', (route) =>
    route.fulfill({
      json: {
        sounds: Array.from({ length: 10 }, (_, i) => ({
          id: String(i),
          name: `Sound ${i + 1}`,
          emoji: '🎵',
        })),
      },
    }),
  );
  await page.goto(`/channels/${fixture.channel.id}`);
  await page.locator(`a.voice-link[href="/channels/${fixture.voice.id}"]`).click();
  const panel = page.locator('.floating-member-panel .voice-connection-panel');
  await expect(panel.locator('.member-call-actions>button')).toHaveCount(4);
  await expect(panel.locator('.member-connection-heading')).toHaveCSS('display', 'flex');
  await expect(panel.getByText('Voice Connected', { exact: true })).toBeVisible();
  const bounds = await page.locator('.floating-member-panel').boundingBox();
  expect(bounds.x).toBeLessThan(16);
  await expect(panel.locator('.connection-signal')).toHaveAttribute('title', '105 ms');
  await page.getByRole('button', { name: 'Open soundboard', exact: true }).click();
  await expect(page.locator('.sound-button')).toHaveCount(10);
  await page.locator('.sound-button').first().click();
  await page.locator('.sound-button').last().click();
  await expect(page.getByRole('dialog', { name: 'Community soundboard' })).toBeVisible();
  expect(
    await page.evaluate(
      () => window.sentMedia.filter((frame) => frame.type === 'soundboard-play').length,
    ),
  ).toBe(2);
  await page.screenshot({ path: '/tmp/web-design-soundboard.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Disconnect voice', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await context.close();
});
test('Direct Call has member controls and a single collapsible chat edge', async ({ browser }) => {
  const context = await browser.newContext({
      storageState: fixture.state,
      viewport: { width: 1280, height: 800 },
    }),
    page = await context.newPage();
  await mockMedia(page);
  await page.goto(`/channels/${fixture.dm.id}`);
  await page.getByRole('button', { name: 'Start Call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel Call', exact: true })).toBeVisible();
  const second = await request.newContext({
    baseURL: 'http://127.0.0.1:4173',
    storageState: fixture.secondState,
  });
  const current = await (await second.get('/api/v1/calls/current')).json();
  const csrf = (await second.storageState()).cookies.find((c) => c.name === 'allchat_csrf').value;
  await second.post(`/api/v1/calls/${current.id}/accept`, { headers: { 'X-CSRF-Token': csrf } });
  await expect(page.locator('.direct-call-workspace')).toBeVisible();
  await expect(page.locator('[data-direct-call-panel] .member-call-actions>button')).toHaveCount(4);
  await page.locator('#message-body').fill('Draft during call');
  await page.getByRole('button', { name: 'Hide chat', exact: true }).click();
  await expect(page.locator('.direct-call-chat')).toBeHidden();
  await page.screenshot({ path: '/tmp/web-design-call-collapsed.png' });
  await page.getByRole('button', { name: 'Show chat', exact: true }).click();
  await expect(page.locator('#message-body')).toHaveValue('Draft during call');
  await page.screenshot({ path: '/tmp/web-design-call-expanded.png' });
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await expect(page.locator('.direct-call-workspace')).toHaveCount(0);
  await expect(page.locator('.call-history-event')).not.toHaveCount(0);
  await second.dispose();
  await context.close();
});
