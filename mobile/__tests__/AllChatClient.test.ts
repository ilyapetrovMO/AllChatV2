import {AllChatClient} from '../src/client/AllChatClient';

describe('AllChatClient', () => {
  it('creates a native Session without cookies', async () => {
    const request = jest.fn(async () => new Response(JSON.stringify({
      member: {id: 'member-1', username: 'member', owner: false},
      session_token: 'session-token',
      session_id: 'session-id',
      expires_at: '2030-01-01T00:00:00Z',
    }), {status: 200, headers: {'Content-Type': 'application/json'}}));
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch);

    const session = await client.login('member', 'correct horse battery staple', 'Test phone');

    expect(session.session_token).toBe('session-token');
    expect(request).toHaveBeenCalledWith('https://chat.example.test/api/v1/auth/native/login', expect.objectContaining({
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-AllChat-Device': 'Test phone'},
    }));
  });

  it('uses an explicit bearer token for authenticated requests', async () => {
    const request = jest.fn(async () => new Response(JSON.stringify({id: 'member-1', username: 'member', owner: false}), {status: 200}));
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch);

    await client.currentSession('session-token');

    expect(request).toHaveBeenCalledWith('https://chat.example.test/api/v1/session', {
      headers: {Authorization: 'Bearer session-token'},
    });
  });

  it('revokes a native Session with its bearer token', async () => {
    const request = jest.fn(async () => new Response(null, {status: 204}));
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch);

    await client.logout('session-token');

    expect(request).toHaveBeenCalledWith('https://chat.example.test/api/v1/auth/logout', {
      method: 'POST',
      headers: {Authorization: 'Bearer session-token'},
    });
  });

  it('loads a versioned bootstrap using the bearer token', async () => {
    const request = jest.fn(async () => new Response(JSON.stringify({
      version: 1,
      community: {name: 'Example Community'},
      member: {id: 'member-1', username: 'member', owner: false},
      members: [], categories: [], channels: [], direct_messages: [], messages: {}, channel_states: [], presence: {}, typing: [],
      notifications: {current_member_id: 'member-1', community: {level: 'all_messages', muted: false, sound_enabled: true}, channels: {}, muted_channel_ids: []},
      media: {audio_bitrate: 64000, screen_bitrate: 2500000}, cursor: 0,
    }), {status: 200}));
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch);

    const bootstrap = await client.bootstrap('session-token');

    expect(bootstrap.version).toBe(1);
    expect(request).toHaveBeenCalledWith('https://chat.example.test/api/v1/mobile/bootstrap', {
      headers: {Authorization: 'Bearer session-token'},
    });
  });

  it('rejects an unsupported bootstrap protocol', async () => {
    const request = jest.fn(async () => new Response(JSON.stringify({version: 2}), {status: 200}));
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch);

    await expect(client.bootstrap('session-token')).rejects.toThrow('Unsupported mobile protocol version: 2');
  });
});
