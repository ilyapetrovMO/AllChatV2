import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.ALLCHAT_SETTINGS_SCREENSHOTS || '/tmp/allchat-settings-review';
const server = await createServer({ root, configFile: path.join(root, 'vite.renderer.config.mts'), server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const member = { id: 'me', username: 'alex', displayName: 'Alex', owner: true };
    const state = {
      connection: 'online', version: 1, community: { name: 'AllChat Community' }, member,
      members: [member, { id: 'sam', username: 'sam', owner: false }],
      categories: [{ id: 'cat', name: 'Community', position: 0, archived: false }],
      channels: [{ id: 'general', category_id: 'cat', name: 'general', type: 'text', position: 0, archived: false }, { id: 'lounge', category_id: 'cat', name: 'Lounge', type: 'voice', position: 1, archived: false }],
      direct_messages: [], messages: { general: [{ id: 'hello', channel_id: 'general', author_id: 'sam', author_name: 'Sam', sequence: 1, body: 'Welcome!', created_at: '2026-09-09T10:00:00Z', deleted: false }] }, channel_states: [], presence: { me: 'online' }, typing: [],
      notifications: { current_member_id: 'me', community: { level: 'mentions_only', muted: false, sound_enabled: true }, channels: {}, muted_channel_ids: [] },
      media: { audio_bitrate: 64000, screen_bitrate: 2500000 }, cursor: 1,
    };
    const shell = { activeInstanceId: 'home', instances: [{ id: 'home', displayName: 'AllChat', baseUrl: 'https://chat.example', partition: 'persist:allchat-home', credentialRef: 'test', session: { member, sessionId: 'session', expiresAt: '2099-01-01T00:00:00Z' } }] };
    let settings = { name: 'AllChat Community', max_attachment_mib: 25, home_markdown: 'Welcome to AllChat Community.', push_relay_url: 'https://push.example.com', push_key_id: 'key-1', push_public_key: 'public-key' };
    let roles = [
      { id: 'owner', name: 'Owner', position: 0, owner: true, default: false, permissions: [] },
      { id: 'mod', name: 'Moderator', position: 1, owner: false, default: false, permissions: ['moderate_members'] },
      { id: 'member', name: 'Member', position: 2, owner: false, default: true, permissions: [] },
    ];
    let invitations = [{ id: 'invite', token: 'allchat-7QK9-WM2P', expires_at: '2026-09-10T10:00:00Z', max_uses: 5, use_count: 1, revoked: false }];
    let sounds = [{ id: 'airhorn', name: 'Airhorn', emoji: '♪', content_type: 'audio/ogg', size: 12288, duration_ms: 900, position: 0, audio_url: '/audio' }, { id: 'celebration', name: 'Celebration', emoji: '♪', content_type: 'audio/ogg', size: 34816, duration_ms: 2400, position: 1, audio_url: '/audio2' }];
    let soundLimit = 10000;
    let notifyState = () => {};
    window.setProfileFixture = ({ owner = true, targetOwner = false, disabled = false, blocked = false } = {}) => {
      state.member = { ...member, owner };
      state.members = [state.member, { id: 'sam', username: 'sam', displayName: 'Sam', owner: targetOwner, disabled }];
      state.presence.sam = 'online';
      state.direct_messages = blocked ? [{ id: 'sam-dm', other: state.members[1], blocked_by_me: true, blocked_by_other: false }] : [];
      notifyState({ ...state });
    };
    window.settingsActions = [];
    window.settingsStoppedCameras = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      const stream = canvas.captureStream();
      stream.getTracks().forEach(track => {
        const stop = track.stop.bind(track);
        track.stop = () => { window.settingsStoppedCameras += 1; stop(); };
      });
      if (window.settingsDelayCamera) await new Promise(resolve => { window.settingsReleaseCamera = resolve; });
      return stream;
    };
    window.allchatDesktop = {
      getShellState: async () => shell, selectInstance: async () => shell,
      loadInstance: async () => state, watchInstance: (_id, callback) => { notifyState = callback; return () => {}; },
      executeInstance: async (_id, action) => {
        window.settingsActions.push(action);
        if (window.settingsFailNextAction === action.type) { window.settingsFailNextAction = null; throw new Error('Simulated save failure'); }
        if (action.type === 'list_roles') return { type: 'roles', roles };
        if (action.type === 'create_role') { const role = { ...action, id: 'role-' + roles.length, default: false, owner: false }; roles = [...roles, role]; return { type: 'role', role }; }
        if (action.type === 'update_role') { const role = { ...roles.find(r => r.id === action.roleId), ...action }; roles = roles.map(r => r.id === action.roleId ? role : r); return { type: 'role', role }; }
        if (action.type === 'retire_role') roles = roles.filter(r => r.id !== action.roleId);
        if (action.type === 'list_invitations') return { type: 'invitations', invitations };
        if (action.type === 'create_invitation') { const invitation = { id: 'new-invite', token: 'new-invitation-code', expires_at: '2026-09-10T10:00:00Z', max_uses: action.maxUses, use_count: 0, revoked: false }; invitations = [invitation, ...invitations]; return { type: 'invitation', invitation }; }
        if (action.type === 'revoke_invitation') invitations = invitations.filter(i => i.id !== action.invitationId);
        if (action.type === 'list_soundboard') return { type: 'soundboard', sounds, maxDurationMs: soundLimit };
        if (action.type === 'set_soundboard_limit') soundLimit = action.maxDurationMs;
        if (action.type === 'upload_sound') { const sound = { id: 'uploaded-' + sounds.length, name: action.name, emoji: action.emoji, content_type: action.contentType, size: action.data.length, duration_ms: 1000, position: action.position, audio_url: '/uploaded' }; sounds = [...sounds, sound]; return { type: 'sound', sound }; }
        if (action.type === 'update_sound') { const sound = { ...sounds.find(i => i.id === action.soundId), name: action.name, emoji: action.emoji, position: action.position }; sounds = sounds.map(i => i.id === action.soundId ? sound : i); return { type: 'sound', sound }; }
        if (action.type === 'delete_sound') sounds = sounds.filter(i => i.id !== action.soundId);
        if (action.type === 'create_category') { const category = { id: 'cat-' + state.categories.length, name: action.name, position: action.position, archived: false }; state.categories.push(category); return { type: 'category', category }; }
        if (action.type === 'create_channel') { const channel = { id: 'chan-' + state.channels.length, category_id: action.categoryId, name: action.name, type: action.channelType, position: action.position, archived: false }; state.channels.push(channel); return { type: 'channel', channel }; }
        if (action.type === 'update_channel') { const channel = { ...state.channels.find(c => c.id === action.channelId), name: action.name }; state.channels = state.channels.map(c => c.id === action.channelId ? channel : c); return { type: 'channel', channel }; }
        if (action.type === 'get_community_settings') return { type: 'community_settings', settings };
        if (action.type === 'update_community_settings') { settings = { ...settings, name: action.name, max_attachment_mib: action.maxAttachmentMiB, home_markdown: action.homeMarkdown, push_relay_url: action.pushRelayURL }; return { type: 'community_settings', settings }; }
        if (action.type === 'list_sessions') return { type: 'sessions', sessions: [{ id: 'current', device: 'Desktop Linux', current: true }, { id: 'laptop', device: 'Laptop Windows', current: false, last_activity: '2026-09-08T10:00:00Z' }] };
        if (action.type === 'list_reports') return { type: 'reports', reports: [{ id: 'r1', status: 'open', reason: 'Repeated unwanted messages.' }, { id: 'r2', status: 'resolved', reason: 'Disruptive posts in the conversation.' }] };
        if (action.type === 'list_moderation_records') return { type: 'moderation_records', records: [] };
        if (action.type === 'create_report') return { type: 'report', report: { id: 'r3', status: 'open', reason: action.reason } };
        if (action.type === 'community_home') return { type: 'community_home', markdown: 'Welcome to AllChat Community.' };
        return { type: 'accepted' };
      },
    };
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await fs.mkdir(output, { recursive: true });
  await page.getByRole('button', { name: 'general', exact: true }).click();
  const profile = page.getByRole('dialog', { name: 'Member profile' });
  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 640 });
    for (const fixture of [
      { owner: false }, { owner: false, blocked: true }, { owner: true, targetOwner: true },
      { owner: true }, { owner: true, blocked: true }, { owner: true, disabled: true }, { owner: true, disabled: true, blocked: true },
    ]) {
      await page.evaluate(fixture => window.setProfileFixture(fixture), fixture);
      await page.locator('.message-author-trigger').getByText('Sam', { exact: true }).click();
      assert.equal(await profile.getByRole('button', { name: 'Message', exact: true }).count(), 0);
      await profile.getByRole('button', { name: 'Member actions', exact: true }).click();
      await profile.getByRole('button', { name: fixture.blocked ? 'Unblock' : 'Block', exact: true }).waitFor();
      const canModerate = fixture.owner && !fixture.targetOwner;
      assert.equal(await profile.getByRole('button', { name: 'Delete Member', exact: true }).count(), canModerate ? 1 : 0);
      if (canModerate) await profile.getByRole('button', { name: fixture.disabled ? 'Restore' : 'Disable', exact: true }).waitFor();
      const bounds = await profile.boundingBox();
      assert.equal(Math.round(bounds.width), 320);
      assert.ok(bounds.x >= 8 && bounds.x + bounds.width <= width - 8);
      assert.ok(bounds.y >= 8 && bounds.y + bounds.height <= (width === 1280 ? 800 : 640) - 8);
      if (canModerate && !fixture.blocked && !fixture.disabled) await profile.screenshot({ path: path.join(output, `member-owner-${width}.png`) });
      await profile.getByRole('button', { name: 'Close member profile' }).click();
    }
    await page.evaluate(() => window.setProfileFixture());
    const directory = page.getByRole('complementary', { name: 'Members' });
    await directory.getByRole('button').filter({ hasText: 'Alex' }).click();
    assert.equal(await profile.getByRole('button', { name: 'Member actions', exact: true }).count(), 0);
    await page.keyboard.press('Escape');
    await directory.getByRole('button').filter({ hasText: 'Sam' }).click();
    await profile.getByRole('button', { name: 'Member actions', exact: true }).click();
    await page.setViewportSize({ width: 480, height: 360 });
    await page.waitForTimeout(100);
    const bounds = await profile.boundingBox();
    assert.ok(bounds.x >= 8 && bounds.x + bounds.width <= 472);
    assert.ok(bounds.y >= 8 && bounds.y + bounds.height <= 352);
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'User Settings', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'User settings' });
  async function capture(name) {
    await page.evaluate(() => document.fonts.ready);
    const scroll = page.locator('.settings-layout, .community-settings-layout');
    await scroll.evaluate(el => { el.scrollTop = 0; });
    const overflow = await scroll.evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
    assert.ok(overflow.content <= overflow.width + 1, `${name}: horizontal overflow ${JSON.stringify(overflow)}`);
    const panel = await page.locator('.member-panel').boundingBox();
    assert.ok(panel && panel.y >= 32 && panel.y + panel.height <= page.viewportSize().height + 1, `${name}: Member controls outside viewport ${JSON.stringify(panel)}`);
    const memberControl = await page.getByRole('button', { name: 'User Settings', exact: true }).evaluate(el => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { reachable: el.contains(top), box: r.toJSON(), covering: top?.outerHTML.slice(0, 160) };
    });
    assert.ok(memberControl.reachable, `${name}: Member controls covered ${JSON.stringify(memberControl)}`);
    await fs.writeFile(path.join(output, `${name}.json`), JSON.stringify({ panel, memberControl, overflow }, null, 2));
    await page.screenshot({ path: path.join(output, `${name}.png`) });
  }
  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 640 });
    for (const [label, name] of [['My Account', 'profile'], ['Voice & Video', 'voice'], ['Ringtone', 'ringtone'], ['Notifications', 'notifications'], ['Sessions', 'sessions'], ['Safety', 'safety']]) {
      await nav.getByRole('button', { name: label, exact: true }).click();
      await page.locator('.settings-heading h2').filter({ hasText: label }).waitFor();
      if (label === 'Sessions') await page.getByText('Desktop Linux', { exact: true }).waitFor();
      if (label === 'Safety') await page.getByRole('heading', { name: 'Report a Member', exact: true }).waitFor();
      await capture(`${name}-${width}`);
      if (label === 'Voice & Video') {
        await page.getByRole('button', { name: 'Camera & sharing', exact: true }).click();
        await capture(`camera-${width}`);
        if (width === 1280) {
          await page.getByRole('button', { name: 'Test Video', exact: true }).click();
          await page.getByRole('button', { name: 'Stop Video', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Audio', exact: true }).click();
          await page.waitForFunction(() => window.settingsStoppedCameras > 0);
          await page.getByRole('button', { name: 'Camera & sharing', exact: true }).click();
          const stopped = await page.evaluate(() => { window.settingsDelayCamera = true; return window.settingsStoppedCameras; });
          await page.getByRole('button', { name: 'Test Video', exact: true }).click();
          await page.waitForFunction(() => Boolean(window.settingsReleaseCamera));
          await page.getByRole('button', { name: 'Audio', exact: true }).click();
          await page.evaluate(() => window.settingsReleaseCamera());
          await page.waitForFunction(previous => window.settingsStoppedCameras > previous, stopped);
        }
        await page.getByRole('button', { name: 'Audio', exact: true }).click();
        assert.equal(await page.getByLabel('Camera', { exact: true }).isVisible(), false);
      }
      if (label === 'Safety') {
        await page.getByRole('button', { name: 'Open moderation' }).click();
        await capture(`moderation-${width}`);
        await page.getByRole('button', { name: /Back to Safety/ }).click();
        await page.getByRole('button', { name: 'Delete Account', exact: true }).click();
        await capture(`delete-${width}`);
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.ok(await page.getByRole('heading', { name: 'Report a Member', exact: true }).isVisible());
      }
    }
    await nav.getByRole('button', { name: 'General', exact: true }).click();
    await page.getByLabel('Community name', { exact: true }).waitFor();
    await capture(`general-${width}`);
    await page.getByLabel('Community name', { exact: true }).fill('Draft Community');
    await page.getByRole('button', { name: 'Manage infrastructure' }).click();
    await capture(`infrastructure-${width}`);
    await page.getByLabel('Maximum attachment size (MiB)', { exact: true }).fill('64');
    await page.getByRole('button', { name: 'Back to General' }).click();
    assert.equal(await page.getByLabel('Community name', { exact: true }).inputValue(), 'Draft Community');
    await page.getByRole('button', { name: 'Manage infrastructure' }).click();
    await page.getByLabel('Maximum attachment size (MiB)', { exact: true }).fill('0');
    await page.getByRole('button', { name: 'Back to General' }).click();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Infrastructure', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Maximum attachment size (MiB)', { exact: true }).evaluate(el => el.validity.rangeUnderflow), true);
    await page.getByLabel('Maximum attachment size (MiB)', { exact: true }).fill('64');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByText('Community settings saved.', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.settingsActions.filter(a => a.type === 'update_community_settings').at(-1)), { type: 'update_community_settings', name: 'Draft Community', maxAttachmentMiB: 64, homeMarkdown: 'Welcome to AllChat Community.', pushRelayURL: 'https://push.example.com' });
    const communityNav = page.getByRole('navigation', { name: 'Community settings' });
    for (const name of ['Channels', 'Roles', 'Invitations', 'Soundboard']) {
      await communityNav.getByRole('button', { name, exact: true }).click();
      await page.locator('.community-management .settings-heading h2').filter({ hasText: name }).waitFor();
      await page.locator('.management-directory article').first().waitFor();
      await capture(`${name.toLowerCase()}-${width}`);
    }
    // Exercise the actual forms and actions behind the new presentation.
    const soundUpload = page.getByRole('form', { name: 'Upload sound', exact: true });
    await soundUpload.getByLabel('Name', { exact: true }).fill('Applause');
    await soundUpload.getByLabel('Audio (MP3, WAV, Ogg; up to 1 MiB)', { exact: true }).setInputFiles({ name: 'applause.ogg', mimeType: 'audio/ogg', buffer: Buffer.from('OggS') });
    await soundUpload.getByRole('button', { name: 'Upload sound', exact: true }).click();
    await page.getByText('Sound uploaded.', { exact: true }).waitFor();
    await page.getByRole('form', { name: 'Playback limit' }).getByLabel('Maximum clip length (seconds)').fill('15');
    await page.getByRole('button', { name: 'Save limit', exact: true }).click();
    await page.getByText('Playback limit saved.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.settingsActions.filter(a => a.type === 'set_soundboard_limit').at(-1).maxDurationMs), 15000);
    await page.getByRole('article', { name: 'Airhorn sound' }).getByRole('button', { name: 'Edit', exact: true }).click();
    const soundEdit = page.getByRole('form', { name: 'Edit sound', exact: true });
    await soundEdit.getByLabel('Emoji', { exact: true }).fill('♫');
    await soundEdit.getByRole('button', { name: 'Save sound', exact: true }).click();
    await page.getByText('Sound updated.', { exact: true }).waitFor();

    await communityNav.getByRole('button', { name: 'Roles', exact: true }).click();
    await page.getByRole('article', { name: 'Moderator Role', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
    const roleEdit = page.getByRole('form', { name: 'Edit Role', exact: true });
    await roleEdit.getByLabel('Manage Channels', { exact: true }).check();
    await roleEdit.getByRole('button', { name: 'Save Role', exact: true }).click();
    await page.getByText('Role updated.', { exact: true }).waitFor();
    const savedRole = await page.evaluate(() => window.settingsActions.filter(a => a.type === 'update_role').at(-1));
    assert.equal(savedRole.position, 1);
    assert.deepEqual(savedRole.permissions, ['manage_channels', 'moderate_members']);
    assert.equal(await page.getByRole('article', { name: 'Owner Role', exact: true }).getByRole('button').count(), 0);
    const roleCreate = page.getByRole('form', { name: 'Create Role', exact: true });
    await roleCreate.getByLabel('Role name', { exact: true }).fill('Event host');
    await page.evaluate(() => { window.settingsFailNextAction = 'create_role'; });
    await roleCreate.getByRole('button', { name: 'Create Role', exact: true }).click();
    await page.locator('.community-management [role="alert"]').waitFor();
    assert.equal(await roleCreate.getByLabel('Role name', { exact: true }).inputValue(), 'Event host');
    await roleCreate.getByRole('button', { name: 'Create Role', exact: true }).click();
    await page.getByText('Role created.', { exact: true }).waitFor();

    await communityNav.getByRole('button', { name: 'Invitations', exact: true }).click();
    const inviteCreate = page.getByRole('form', { name: 'Create Invitation', exact: true });
    await inviteCreate.getByLabel('Expires in minutes').fill('60');
    await inviteCreate.getByLabel('Maximum uses').fill('3');
    await inviteCreate.getByRole('button', { name: 'Create Invitation', exact: true }).click();
    await page.getByText('Invitation created.', { exact: true }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.management-invitation').filter({ hasText: 'new-invitation-code' }).getByRole('button', { name: 'Revoke' }).click();
    await page.getByText('Invitation revoked.', { exact: true }).waitFor();

    await communityNav.getByRole('button', { name: 'Channels', exact: true }).click();
    const channel = page.getByRole('article', { name: 'general settings', exact: true });
    await channel.getByText('Permission override', { exact: true }).click();
    const override = channel.getByRole('form', { name: 'general permission override' });
    await override.getByRole('combobox', { name: 'Role', exact: true }).selectOption('mod');
    await override.getByRole('combobox', { name: 'Effect', exact: true }).selectOption('deny');
    await override.getByRole('button', { name: 'Save override' }).click();
    await channel.getByText('Permission override saved.', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => window.settingsActions.some(a => a.type === 'set_channel_override' && a.roleId === 'mod' && a.effect === 'deny')));
    await channel.getByRole('button', { name: 'Archive', exact: true }).click();
    await channel.getByRole('button', { name: 'Restore', exact: true }).click();
    await channel.getByRole('button', { name: 'Archive', exact: true }).waitFor();
    const categoryCreate = page.getByRole('form', { name: 'Create Category', exact: true });
    await categoryCreate.getByLabel('Category name').fill('Projects');
    await categoryCreate.getByRole('button', { name: 'Create Category', exact: true }).click();
    await page.getByText('Category created.', { exact: true }).waitFor();
    const channelCreate = page.getByRole('form', { name: 'Create Channel', exact: true });
    await channelCreate.getByLabel('Channel name', { exact: true }).fill('introductions');
    await channelCreate.getByRole('button', { name: 'Create Channel', exact: true }).click();
    await page.getByText('Channel created.', { exact: true }).waitFor();
    await page.getByRole('button', { name: /Back to Community/ }).click();
    await page.getByRole('button', { name: 'User Settings', exact: true }).click();
  }
  // Profile saving still sends the same action; deletion requires explicit confirmation.
  await page.getByLabel('Username', { exact: true }).fill('alex-new');
  await page.getByLabel('Display Name', { exact: true }).fill('Alex New');
  await page.getByRole('button', { name: 'Save Profile' }).click();
  assert.ok(await page.evaluate(() => window.settingsActions.some(a => a.type === 'update_profile' && a.username === 'alex-new' && a.displayName === 'Alex New')));
  assert.equal(await page.evaluate(() => window.settingsActions.some(a => a.type === 'delete_account')), false);
  assert.deepEqual(errors, []);
  console.log(`Settings navigation, draft preservation, save actions, and both desktop sizes passed. Screenshots: ${output}`);
} finally { await browser?.close(); await server.close(); }
