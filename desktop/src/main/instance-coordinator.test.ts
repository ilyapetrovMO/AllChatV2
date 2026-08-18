import { describe, expect, it, vi } from 'vitest';

import { MemoryDesktopCredentialVault } from './desktop-credential-vault';
import { InstanceCoordinator } from './instance-coordinator';
import { InstanceRegistry } from './instance-registry';

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
});
