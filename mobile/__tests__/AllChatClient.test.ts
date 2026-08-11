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
});
