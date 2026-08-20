import { describe, expect, it, vi } from 'vitest';

import { MemoryDesktopCredentialVault } from './desktop-credential-vault';
import { InstanceCoordinator } from './instance-coordinator';
import { InstanceRegistry } from './instance-registry';
import { MemoryInstanceStateCache } from './instance-state-cache';
import { MemoryAssetCache } from './asset-cache';
import type { RealtimeConnectionOptions } from './realtime-connection';

describe('InstanceCoordinator', () => {
  it('reports the incompatible protocol version for a saved Community', async () => {
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', { member: { id: 'me', username: 'nora', owner: false }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z' });
    const vault = new MemoryDesktopCredentialVault();
    await vault.put('desktop-session:home', 'token');
    const coordinator = new InstanceCoordinator(registry, vault, async () => new Response(JSON.stringify({ version: 2 }), { status: 200 }));

    await expect(coordinator.load('home')).rejects.toThrow(
      'Incompatible Instance protocol: version 2. This desktop app supports version 1.',
    );
  });
  it('accepts the canonical Admin Dashboard response shape', async () => {
    const registry = new InstanceRegistry(() => 'home'); registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', { member: { id: 'me', username: 'nora', owner: true }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z' });
    const vault = new MemoryDesktopCredentialVault(); await vault.put('desktop-session:home', 'token');
    const dashboard = { checked_at: '2026-08-18T10:00:00Z', uptime_seconds: 42, health: { database: 'ready' }, counts: { members: 2, online_members: 1, messages: 3, attachments: 1 }, resources: { cpu_seconds: 1, cpu_cores: 4, memory_bytes: 2, heap_bytes: 1, disk_total_bytes: 10, disk_available_bytes: 8, app_storage_bytes: 2 }, storage_sources: [{ name: 'Messages', bytes: 2 }], message_rate: { messages_per_minute: 1, buckets: [{ at: '2026-08-18T10:00:00Z', count: 1 }] } };
    const coordinator = new InstanceCoordinator(registry, vault, async () => new Response(JSON.stringify(dashboard), { status: 200 }));

    await expect(coordinator.execute('home', { type: 'admin_dashboard' })).resolves.toEqual({ type: 'admin_dashboard', dashboard });
  });

  it('loads Community settings from servers that omit relay identity metadata', async () => {
    const registry = new InstanceRegistry(() => 'home'); registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', { member: { id: 'me', username: 'nora', owner: true }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z' });
    const vault = new MemoryDesktopCredentialVault(); await vault.put('desktop-session:home', 'token');
    const coordinator = new InstanceCoordinator(registry, vault, async () => new Response(JSON.stringify({ max_attachment_mib: 64, home_markdown: '# Welcome', push_relay_url: '' }), { status: 200 }));

    await expect(coordinator.execute('home', { type: 'get_community_settings' })).resolves.toEqual({ type: 'community_settings', settings: { max_attachment_mib: 64, home_markdown: '# Welcome', push_relay_url: '', push_key_id: '', push_public_key: '' } });
  });

  it('identifies an Instance version that predates the Community settings API', async () => {
    const registry = new InstanceRegistry(() => 'home'); registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', { member: { id: 'me', username: 'nora', owner: true }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z' });
    const vault = new MemoryDesktopCredentialVault(); await vault.put('desktop-session:home', 'token');
    const coordinator = new InstanceCoordinator(registry, vault, async () => new Response('<html>proxy page with private settings</html>', { status: 404, headers: { 'Content-Type': 'text/html' } }));

    await expect(coordinator.execute('home', { type: 'get_community_settings' })).resolves.toEqual({
      type: 'community_settings_unavailable',
      reason: 'Update the Instance to manage Community settings from desktop.',
    });
  });

  it('treats a link without preview metadata as an ordinary message without an embed', async () => {
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', { member: { id: 'me', username: 'nora', owner: false }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z' });
    const vault = new MemoryDesktopCredentialVault(); await vault.put('desktop-session:home', 'token');
    const coordinator = new InstanceCoordinator(registry, vault, async () => new Response(JSON.stringify({ error: 'link preview unavailable' }), { status: 502 }));

    await expect(coordinator.execute('home', { type: 'link_preview', url: 'https://example.com/no-preview' })).resolves.toEqual({ type: 'accepted' });
  });

  it('keeps an accepted Reaction in the authoritative state used by later realtime publications', async () => {
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', { member: { id: 'me', username: 'nora', owner: false }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z' });
    const vault = new MemoryDesktopCredentialVault(); await vault.put('desktop-session:home', 'token');
    const cache = new MemoryInstanceStateCache();
    const bootstrap = { version: 1, community: { name: 'Community' }, member: { id: 'me', username: 'nora', owner: false }, members: [], categories: [], channels: [], direct_messages: [], messages: { chat: [{ id: 'message-1', channel_id: 'chat', author_id: 'me', author_name: 'nora', sequence: 1, body: 'hello', created_at: '2026-08-18T09:00:00Z', deleted: false }] }, channel_states: [], presence: {}, typing: [], notifications: { current_member_id: 'me', community: { level: 'default', muted: false }, channels: {}, muted_channel_ids: [] }, media: { audio_bitrate: 64000, screen_bitrate: 2500000 }, cursor: 1 };
    const request: typeof fetch = vi.fn(async (input: URL | RequestInfo) => String(input).includes('/reactions') ? new Response(null, { status: 204 }) : new Response(JSON.stringify(bootstrap), { status: 200 }));
    const coordinator = new InstanceCoordinator(registry, vault, request, cache);
    await coordinator.load('home');
    await coordinator.execute('home', { type: 'set_reaction', messageId: 'message-1', emoji: '👍', active: true });

    const cached = await new InstanceCoordinator(registry, vault, async () => { throw new Error('offline'); }, cache).load('home');
    expect(cached.messages.chat[0].reactions).toEqual([{ emoji: '👍', count: 1, me: true }]);
  });

  it('does not erase an accepted Reaction when the next realtime frame is reduced', async () => {
    const registry = new InstanceRegistry(() => 'home'); registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', { member: { id: 'me', username: 'nora', owner: false }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z' });
    const vault = new MemoryDesktopCredentialVault(); await vault.put('desktop-session:home', 'token');
    const bootstrap = { version: 1, community: { name: 'Community' }, member: { id: 'me', username: 'nora', owner: false }, members: [], categories: [], channels: [], direct_messages: [], messages: { chat: [{ id: 'message-1', channel_id: 'chat', author_id: 'me', author_name: 'nora', sequence: 1, body: 'hello', created_at: '2026-08-18T09:00:00Z', deleted: false }] }, channel_states: [], presence: {}, typing: [], notifications: { current_member_id: 'me', community: { level: 'default', muted: false }, channels: {}, muted_channel_ids: [] }, media: { audio_bitrate: 64000, screen_bitrate: 2500000 }, cursor: 1 };
    const request: typeof fetch = vi.fn(async (input: URL | RequestInfo) => String(input).includes('/reactions') ? new Response(null, { status: 204 }) : new Response(JSON.stringify(bootstrap), { status: 200 }));
    let realtime: RealtimeConnectionOptions | undefined;
    const coordinator = new InstanceCoordinator(registry, vault, request, new MemoryInstanceStateCache(), new MemoryAssetCache(), (options) => { realtime = options; return { start: vi.fn(), stop: vi.fn(), sendTyping: vi.fn() }; });
    await coordinator.load('home');
    const listener = vi.fn(); coordinator.watch('home', listener);
    await vi.waitFor(() => expect(realtime).toBeDefined());
    await coordinator.execute('home', { type: 'set_reaction', messageId: 'message-1', emoji: '👍', active: true });
    realtime!.onFrame({ type: 'heartbeat', cursor: 2 });

    expect(listener.mock.calls.at(-1)?.[0].messages.chat[0].reactions).toEqual([{ emoji: '👍', count: 1, me: true }]);
  });

  it('reuses cached avatars across refreshes and coordinator restarts', async () => {
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', {
      member: { id: 'me', username: 'nora', owner: false }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z',
    });
    const vault = new MemoryDesktopCredentialVault();
    await vault.put('desktop-session:home', 'token');
    const assetCache = new MemoryAssetCache();
    const request = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200, headers: { 'Content-Type': 'image/png' },
    }));
    const coordinator = new InstanceCoordinator(registry, vault, request, new MemoryInstanceStateCache(), assetCache);

    const [first, simultaneous] = await Promise.all([
      coordinator.execute('home', { type: 'load_asset', path: '/api/v1/members/alex/avatar' }),
      coordinator.execute('home', { type: 'load_asset', path: '/api/v1/members/alex/avatar' }),
    ]);
    const afterRefresh = await new InstanceCoordinator(
      registry, vault, request, new MemoryInstanceStateCache(), assetCache,
    ).execute('home', { type: 'load_asset', path: '/api/v1/members/alex/avatar' });

    expect(request).toHaveBeenCalledTimes(1);
    expect(first).toEqual(simultaneous);
    expect(afterRefresh).toEqual(first);
  });
  it('reuses a cached Attachment preview when a channel is left and reopened', async () => {
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', { member: { id: 'me', username: 'nora', owner: false }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z' });
    const vault = new MemoryDesktopCredentialVault(); await vault.put('desktop-session:home', 'token');
    const assetCache = new MemoryAssetCache();
    const request = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
    const coordinator = new InstanceCoordinator(registry, vault, request, new MemoryInstanceStateCache(), assetCache);

    const first = await coordinator.execute('home', { type: 'load_asset', path: '/api/v1/attachments/media-1/preview' });
    const reopened = await coordinator.execute('home', { type: 'load_asset', path: '/api/v1/attachments/media-1/preview' });

    expect(reopened).toEqual(first);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('loads versioned Community state without exposing the bearer credential', async () => {
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', {
      member: { id: 'me', username: 'nora', owner: false },
      sessionId: 'session-1',
      expiresAt: '2026-09-18T00:00:00Z',
    });
    const vault = new MemoryDesktopCredentialVault();
    await vault.put('desktop-session:home', 'raw-secret-token');
    const request = vi.fn(async () => new Response(JSON.stringify({
      version: 1,
      community: { name: 'AllChat Community' },
      member: { id: 'me', username: 'nora', owner: false },
      members: [], categories: [], channels: [], direct_messages: [], messages: {},
      channel_states: [], presence: {}, typing: [],
      notifications: {
        current_member_id: 'me',
        community: { level: 'default', muted: false },
        channels: {}, muted_channel_ids: [],
      },
      media: { audio_bitrate: 64000, screen_bitrate: 2500000 }, cursor: 4,
    }), { status: 200 }));
    const coordinator = new InstanceCoordinator(registry, vault, request);

    const state = await coordinator.load('home');

    expect(state.community.name).toBe('AllChat Community');
    expect(JSON.stringify(state)).not.toContain('raw-secret-token');
    expect(request).toHaveBeenCalledWith(
      'https://chat.example/api/v1/mobile/bootstrap?history=recent',
      { headers: { Authorization: 'Bearer raw-secret-token' } },
    );
  });

  it('returns the last cached Community state when an authenticated Instance is offline', async () => {
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', {
      member: { id: 'me', username: 'nora', owner: false }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z',
    });
    const vault = new MemoryDesktopCredentialVault();
    await vault.put('desktop-session:home', 'token');
    const cache = new MemoryInstanceStateCache();
    const online = new InstanceCoordinator(registry, vault, async () => new Response(JSON.stringify({
      version: 1, community: { name: 'Cached Community' }, member: { id: 'me', username: 'nora', owner: false },
      members: [], categories: [], channels: [], direct_messages: [], messages: {}, channel_states: [], presence: {}, typing: [],
      notifications: { current_member_id: 'me', community: { level: 'default', muted: false }, channels: {}, muted_channel_ids: [] },
      media: { audio_bitrate: 64000, screen_bitrate: 2500000 }, cursor: 7,
    }), { status: 200 }), cache);
    await online.load('home');

    const offline = new InstanceCoordinator(registry, vault, async () => { throw new Error('offline'); }, cache);
    const state = await offline.load('home');

    expect(state.community.name).toBe('Cached Community');
    expect(state.connection).toBe('offline');
    expect(state.cursor).toBe(7);
  });

  it('publishes a Message through the authenticated action interface', async () => {
    const emojiMessage = 'Flags 🇺🇦 🇯🇵 · skin 👩🏽‍💻 · family 👨‍👩‍👧‍👦 · keycap 1️⃣ · rainbow 🏳️‍🌈';
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', {
      member: { id: 'me', username: 'nora', owner: false }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z',
    });
    const vault = new MemoryDesktopCredentialVault();
    await vault.put('desktop-session:home', 'token');
    const request = vi.fn(async () => new Response(JSON.stringify({
      id: 'message-1', channel_id: 'chat', author_id: 'me', author_name: 'nora',
      sequence: 1, body: emojiMessage, created_at: '2026-08-18T09:00:00Z', deleted: false,
    }), { status: 200 }));
    const coordinator = new InstanceCoordinator(registry, vault, request);

    const result = await coordinator.execute('home', {
      type: 'send_message', conversationId: 'chat', direct: false, body: emojiMessage,
    });

    expect(result.type).toBe('message');
    expect(request).toHaveBeenCalledWith('https://chat.example/api/v1/channels/chat/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: emojiMessage }),
    });

    await coordinator.execute('home', { type: 'set_reaction', messageId: 'message-1', emoji: '🇺🇦', active: true });
    expect(request).toHaveBeenLastCalledWith('https://chat.example/api/v1/messages/message-1/reactions', {
      method: 'PUT',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: '🇺🇦' }),
    });
    await coordinator.execute('home', { type: 'set_reaction', messageId: 'message-1', emoji: '🇺🇦', active: false });
    expect(request).toHaveBeenLastCalledWith('https://chat.example/api/v1/messages/message-1/reactions', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: '🇺🇦' }),
    });
  });

  it('loads forward history pages for returning from older history to present', async () => {
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', { member: { id: 'me', username: 'nora', owner: false }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z' });
    const vault = new MemoryDesktopCredentialVault(); await vault.put('desktop-session:home', 'token');
    const request = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'message-101', channel_id: 'chat', author_id: 'me', author_name: 'nora', sequence: 101, body: 'newer', created_at: '2026-08-18T09:00:00Z', deleted: false }], has_more: false, next_after: 0 }), { status: 200 }));
    const coordinator = new InstanceCoordinator(registry, vault, request);

    const result = await coordinator.execute('home', { type: 'load_messages', conversationId: 'chat', direct: false, after: 100, limit: 100 });

    expect(result).toMatchObject({ type: 'messages', direction: 'newer' });
    expect(request).toHaveBeenCalledWith('https://chat.example/api/v1/channels/chat/messages?limit=100&after=100', { headers: { Authorization: 'Bearer token' } });
  });

  it('starts and controls Direct Calls through the authenticated action interface', async () => {
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', {
      member: { id: 'me', username: 'nora', owner: false }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z',
    });
    const vault = new MemoryDesktopCredentialVault(); await vault.put('desktop-session:home', 'token');
    const call = { id: 'call-1', direct_message_id: 'dm-1', caller_id: 'me', recipient_id: 'alex', state: 'ringing', created_at: '2026-08-18T12:00:00Z' };
    const request = vi.fn(async () => new Response(JSON.stringify(call), { status: 200 }));
    const coordinator = new InstanceCoordinator(registry, vault, request);

    expect(await coordinator.execute('home', { type: 'start_call', directMessageId: 'dm-1' })).toEqual({ type: 'call', call });
    expect(request).toHaveBeenCalledWith('https://chat.example/api/v1/dms/dm-1/calls', {
      method: 'POST', headers: { Authorization: 'Bearer token' },
    });
    await coordinator.execute('home', { type: 'call_action', callId: 'call-1', action: 'end' });
    expect(request).toHaveBeenLastCalledWith('https://chat.example/api/v1/calls/call-1/end', {
      method: 'POST', headers: { Authorization: 'Bearer token' },
    });
  });

  it('updates the Member profile through the authenticated action interface', async () => {
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', {
      member: { id: 'me', username: 'nora', owner: false }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z',
    });
    const vault = new MemoryDesktopCredentialVault();
    await vault.put('desktop-session:home', 'token');
    const request = vi.fn(async () => new Response(JSON.stringify({
      id: 'me', username: 'nora', display_name: 'Nora', owner: false,
    }), { status: 200 }));

    const result = await new InstanceCoordinator(registry, vault, request).execute('home', {
      type: 'update_profile', username: 'nora', displayName: 'Nora',
    });

    expect(result).toEqual({ type: 'member', member: { id: 'me', username: 'nora', displayName: 'Nora', owner: false } });
    expect(request).toHaveBeenCalledWith('https://chat.example/api/v1/profile', {
      method: 'PATCH', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nora', display_name: 'Nora' }),
    });
  });

  it('submits a Report through the authenticated safety interface', async () => {
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', { member: { id: 'me', username: 'nora', owner: false }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z' });
    const vault = new MemoryDesktopCredentialVault(); await vault.put('desktop-session:home', 'token');
    const request = vi.fn(async () => new Response(JSON.stringify({ id: 'report-1', reporter_id: 'me', target_member_id: 'other', reason: 'spam', status: 'open', created_at: '2026-08-18T10:00:00Z' }), { status: 201 }));

    const result = await new InstanceCoordinator(registry, vault, request).execute('home', { type: 'create_report', targetMemberId: 'other', reason: 'spam' });

    expect(result.type).toBe('report');
    expect(request).toHaveBeenCalledWith('https://chat.example/api/v1/reports', { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify({ target_member_id: 'other', target_message_id: '', reason: 'spam' }) });
  });
});
// @vitest-environment node
