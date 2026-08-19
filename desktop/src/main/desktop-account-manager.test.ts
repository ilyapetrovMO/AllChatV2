import { describe, expect, it } from 'vitest';

import { DesktopAccountManager } from './desktop-account-manager';
import { InstanceRegistry } from './instance-registry';
import { MemoryDesktopCredentialVault } from './desktop-credential-vault';

describe('DesktopAccountManager', () => {
  it('keeps a native Session token in the vault and returns only non-secret state', async () => {
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    const vault = new MemoryDesktopCredentialVault();
    const request = async () => new Response(JSON.stringify({
      member: { id: 'member-1', username: 'nora', owner: false },
      session_token: 'raw-secret-token',
      session_id: 'session-1',
      expires_at: '2026-09-18T00:00:00Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const accounts = new DesktopAccountManager(registry, vault, request);

    const state = await accounts.login({
      instanceId: 'home',
      username: 'nora',
      password: 'correct horse battery staple',
    });

    expect(JSON.stringify(state)).not.toContain('raw-secret-token');
    expect(state.instances[0]?.session?.member.username).toBe('nora');
    expect(await vault.get('desktop-session:home')).toBe('raw-secret-token');
  });

  it('clears local authenticated state when the Instance revokes a stored Session', async () => {
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    registry.setSession('home', 'desktop-session:home', {
      member: { id: 'member-1', username: 'nora', owner: false },
      sessionId: 'session-1',
      expiresAt: '2026-09-18T00:00:00Z',
    });
    const vault = new MemoryDesktopCredentialVault();
    await vault.put('desktop-session:home', 'revoked-token');
    const accounts = new DesktopAccountManager(
      registry,
      vault,
      async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    );

    await accounts.validateStoredSessions();

    expect(registry.get('home').session).toBeUndefined();
    expect(await vault.get('desktop-session:home')).toBeNull();
  });

  it('registers and recovers native Accounts through the Instance contracts', async () => {
    const registry = new InstanceRegistry(() => 'home');
    registry.add({ displayName: 'Home', baseUrl: 'https://chat.example' });
    const vault = new MemoryDesktopCredentialVault();
    const requests: Array<{ url: string; body: unknown }> = [];
    const accounts = new DesktopAccountManager(registry, vault, async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body || '{}')) });
      if (String(input).endsWith('/recover')) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ member: { id: 'member-2', username: 'alex', owner: false }, session_token: 'register-secret', session_id: 'session-2', expires_at: '2026-09-18T00:00:00Z' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });

    await accounts.register({ instanceId: 'home', invitationToken: 'invite', username: 'alex', password: 'twelve-characters' });
    await accounts.recover({ instanceId: 'home', recoveryToken: 'recovery', password: 'replacement-pass' });

    expect(requests).toEqual([
      { url: 'https://chat.example/api/v1/auth/native/register', body: { token: 'invite', username: 'alex', password: 'twelve-characters' } },
      { url: 'https://chat.example/api/v1/auth/recover', body: { token: 'recovery', password: 'replacement-pass' } },
    ]);
  });
});
// @vitest-environment node
