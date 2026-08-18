import { describe, expect, it, vi } from 'vitest';

import { MemoryDesktopCredentialVault } from './desktop-credential-vault';
import { InstanceCoordinator } from './instance-coordinator';
import { InstanceRegistry } from './instance-registry';
import { MemoryInstanceStateCache } from './instance-state-cache';

describe('InstanceCoordinator', () => {
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
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', {
      member: { id: 'me', username: 'nora', owner: false }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z',
    });
    const vault = new MemoryDesktopCredentialVault();
    await vault.put('desktop-session:home', 'token');
    const request = vi.fn(async () => new Response(JSON.stringify({
      id: 'message-1', channel_id: 'chat', author_id: 'me', author_name: 'nora',
      sequence: 1, body: 'hello desktop', created_at: '2026-08-18T09:00:00Z', deleted: false,
    }), { status: 200 }));
    const coordinator = new InstanceCoordinator(registry, vault, request);

    const result = await coordinator.execute('home', {
      type: 'send_message', conversationId: 'chat', direct: false, body: 'hello desktop',
    });

    expect(result.type).toBe('message');
    expect(request).toHaveBeenCalledWith('https://chat.example/api/v1/channels/chat/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'hello desktop' }),
    });

    await coordinator.execute('home', { type: 'set_reaction', messageId: 'message-1', emoji: '👍', active: true });
    expect(request).toHaveBeenLastCalledWith('https://chat.example/api/v1/messages/message-1/reactions', {
      method: 'PUT',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: '👍' }),
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
});
