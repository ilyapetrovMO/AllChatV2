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

  it('reports the HTTP status and plain-text response when native login is unavailable', async () => {
    const request = jest.fn(async () => new Response('404 page not found', {status: 404}));
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch);

    await expect(client.login('member', 'password', 'Test phone')).rejects.toThrow('Could not sign in. (HTTP 404: 404 page not found)');
  });

  it('explains transport failures during native login', async () => {
    const request = jest.fn(async () => { throw new TypeError('Network request failed'); });
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch);

    await expect(client.login('member', 'password', 'Test phone')).rejects.toThrow('Could not reach the Instance. Check its address, HTTPS certificate, and your connection.');
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

  it('publishes Channel and Direct Messages with bearer authentication', async () => {
    const message = {id: 'message-1', channel_id: 'conversation/1', author_id: 'member-1', author_name: 'Member', sequence: 1, body: 'Hello', created_at: '2030-01-01T00:00:00Z', deleted: false};
    const request = jest.fn(async () => new Response(JSON.stringify(message), {status: 201}));
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch);

    await client.publishMessage('session-token', 'conversation/1', 'Hello', true);

    expect(request).toHaveBeenCalledWith('https://chat.example.test/api/v1/dms/conversation%2F1/messages', {
      method: 'POST',
      headers: {Authorization: 'Bearer session-token', 'Content-Type': 'application/json'},
      body: JSON.stringify({body: 'Hello'}),
    });
  });

  it('updates a conversation read position', async () => {
    const channelState = {channel_id: 'channel-1', read_sequence: 8, last_sequence: 8, unread: 0};
    const request = jest.fn(async () => new Response(JSON.stringify(channelState), {status: 200}));
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch);

    await client.updateReadPosition('session-token', 'channel-1', 8);

    expect(request).toHaveBeenCalledWith('https://chat.example.test/api/v1/channels/channel-1/read-position', {
      method: 'PUT',
      headers: {Authorization: 'Bearer session-token', 'Content-Type': 'application/json'},
      body: JSON.stringify({sequence: 8}),
    });
  });

  it('uploads a locally selected Attachment with an encoded filename', async () => {
    const localBlob = new Blob(['audio bytes'], {type: 'audio/mpeg', lastModified: 0});
    const readFile = jest.fn(async () => new Response(localBlob, {status: 200}));
    const request = jest.fn(async () => new Response(JSON.stringify({id: 'attachment-1', name: 'Бит.mp3', content_type: 'audio/mpeg', size: 11}), {status: 201}));
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch, readFile as typeof fetch);

    const attachment = await client.uploadAttachment('session-token', {uri: 'content://picked/audio', name: 'Бит.mp3', type: 'audio/mpeg', size: 11});

    expect(attachment.id).toBe('attachment-1');
    expect(request).toHaveBeenCalledWith('https://chat.example.test/api/v1/attachments?filename=%D0%91%D0%B8%D1%82.mp3', expect.objectContaining({
      method: 'POST', headers: {Authorization: 'Bearer session-token', 'Content-Type': 'audio/mpeg'}, body: expect.any(Blob),
    }));
  });

  it('publishes selected Attachment IDs with the Message', async () => {
    const message = {id: 'message-1', channel_id: 'channel-1', author_id: 'member-1', author_name: 'Member', sequence: 1, created_at: '2030-01-01T00:00:00Z', deleted: false};
    const request = jest.fn(async () => new Response(JSON.stringify(message), {status: 201}));
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch);

    await client.publishMessage('session-token', 'channel-1', '', false, ['attachment-1']);

    expect(request).toHaveBeenCalledWith('https://chat.example.test/api/v1/channels/channel-1/messages', expect.objectContaining({
      body: JSON.stringify({body: '', attachment_ids: ['attachment-1']}),
    }));
  });

  it('publishes replies and supports Message actions', async () => {
    const message = {id: 'message-2', channel_id: 'channel-1', author_id: 'member-1', author_name: 'Member', sequence: 2, body: 'Reply', created_at: '2030-01-01T00:00:00Z', deleted: false};
    const request = jest.fn(async (_url: string, options?: RequestInit) => options?.method === 'PATCH'
      ? new Response(JSON.stringify({...message, body: 'Edited'}), {status: 200})
      : options?.method === 'POST'
        ? new Response(JSON.stringify(message), {status: 201})
        : new Response(null, {status: 204}));
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch);

    await client.publishMessage('session-token', 'channel-1', 'Reply', false, [], 'message-1');
    await client.editMessage('session-token', 'message-2', 'Edited');
    await client.setReaction('session-token', 'message-2', '👍', true);
    await client.setPinned('session-token', 'message-2', true);
    await client.deleteMessage('session-token', 'message-2');

    expect(request).toHaveBeenNthCalledWith(1, 'https://chat.example.test/api/v1/channels/channel-1/messages', expect.objectContaining({body: JSON.stringify({body: 'Reply', reply_to: 'message-1'})}));
    expect(request).toHaveBeenNthCalledWith(2, 'https://chat.example.test/api/v1/messages/message-2', expect.objectContaining({method: 'PATCH'}));
    expect(request).toHaveBeenNthCalledWith(3, 'https://chat.example.test/api/v1/messages/message-2/reactions', expect.objectContaining({method: 'PUT', body: JSON.stringify({emoji: '👍'})}));
    expect(request).toHaveBeenNthCalledWith(4, 'https://chat.example.test/api/v1/messages/message-2/pin', expect.objectContaining({method: 'PUT'}));
    expect(request).toHaveBeenNthCalledWith(5, 'https://chat.example.test/api/v1/messages/message-2', expect.objectContaining({method: 'DELETE'}));
  });

  it('loads pins and searches authorized Messages', async () => {
    const request = jest.fn(async (url: string) => new Response(JSON.stringify(url.includes('/pins')
      ? {messages: []}
      : {results: [], next_cursor: 'next'}), {status: 200}));
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch);

    await client.pinnedMessages('session-token', 'channel/1');
    const page = await client.searchMessages('session-token', 'hello world');

    expect(page.next_cursor).toBe('next');
    expect(request).toHaveBeenNthCalledWith(1, 'https://chat.example.test/api/v1/channels/channel%2F1/pins', expect.anything());
    expect(request).toHaveBeenNthCalledWith(2, 'https://chat.example.test/api/v1/search?q=hello+world&limit=25', expect.anything());
  });

  it('supports Member social and Presence actions', async () => {
    const member = {id: 'member-2', username: 'friend', owner: false};
    const dm = {id: 'dm-1', other: member, blocked_by_me: false, blocked_me: false, unread: 0, created_at: '2030-01-01T00:00:00Z'};
    const request = jest.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/api/v1/dms')) return new Response(JSON.stringify(dm), {status: 201});
      if (url.endsWith('/api/v1/reports')) return new Response(JSON.stringify({id: 'report-1'}), {status: 201});
      if (url.endsWith('/presence-mode')) return new Response(JSON.stringify({mode: 'dnd'}), {status: 200});
      if (options?.method === 'PUT') return new Response(null, {status: 204});
      return new Response(JSON.stringify(member), {status: 200});
    });
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch);

    await client.memberProfile('session-token', member.id);
    await client.openDirectMessage('session-token', member.id);
    await client.setBlock('session-token', member.id, true);
    await client.reportMember('session-token', member.id, 'Repeated spam');
    await client.setPresenceMode('session-token', 'dnd');

    expect(request).toHaveBeenNthCalledWith(2, 'https://chat.example.test/api/v1/dms', expect.objectContaining({body: JSON.stringify({member_id: member.id})}));
    expect(request).toHaveBeenNthCalledWith(3, 'https://chat.example.test/api/v1/blocks/member-2', expect.objectContaining({method: 'PUT'}));
    expect(request).toHaveBeenNthCalledWith(4, 'https://chat.example.test/api/v1/reports', expect.objectContaining({body: JSON.stringify({target_member_id: member.id, reason: 'Repeated spam'})}));
    expect(request).toHaveBeenNthCalledWith(5, 'https://chat.example.test/api/v1/presence-mode', expect.objectContaining({body: JSON.stringify({mode: 'dnd'})}));
  });

  it('loads link previews through the authenticated Instance proxy', async () => {
    const request = jest.fn(async () => new Response(JSON.stringify({url: 'https://news.example.test/story', title: 'A story'}), {status: 200}));
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch);

    const preview = await client.linkPreview('session-token', 'https://news.example.test/story?a=1&b=2');

    expect(preview.title).toBe('A story');
    expect(request).toHaveBeenCalledWith('https://chat.example.test/api/v1/link-preview?url=https%3A%2F%2Fnews.example.test%2Fstory%3Fa%3D1%26b%3D2', {
      headers: {Authorization: 'Bearer session-token'},
    });
  });

  it('updates profile fields and avatar content', async () => {
    const localBlob = new Blob(['avatar'], {type: 'image/png', lastModified: 0});
    const readFile = jest.fn(async () => new Response(localBlob));
    const request = jest.fn(async (_url: string, options?: RequestInit) => options?.method === 'PATCH'
      ? new Response(JSON.stringify({id: 'member-1', username: 'renamed', display_name: 'Display', owner: false}), {status: 200})
      : new Response(null, {status: 204}));
    const client = new AllChatClient('https://chat.example.test', request as typeof fetch, readFile as typeof fetch);

    await client.updateProfile('session-token', 'renamed', 'Display');
    await client.updateAvatar('session-token', {uri: 'content://avatar', name: 'avatar.png', type: 'image/png'});
    await client.removeAvatar('session-token');

    expect(request).toHaveBeenNthCalledWith(1, 'https://chat.example.test/api/v1/profile', expect.objectContaining({method: 'PATCH', body: JSON.stringify({username: 'renamed', display_name: 'Display'})}));
    expect(request).toHaveBeenNthCalledWith(2, 'https://chat.example.test/api/v1/profile/avatar', expect.objectContaining({method: 'PUT', body: localBlob}));
    expect(request).toHaveBeenNthCalledWith(3, 'https://chat.example.test/api/v1/profile/avatar', expect.objectContaining({method: 'DELETE'}));
  });
});
