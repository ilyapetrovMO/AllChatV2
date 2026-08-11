import type {MobileBootstrap, Message} from '../src/client/bootstrap';
import {MemoryConversationCache} from '../src/cache/ConversationCache';

function snapshot(): MobileBootstrap {
  const messages: Message[] = Array.from({length: 60}, (_, index) => ({
    id: `message-${index}`, channel_id: 'channel-1', author_id: 'member-1', author_name: 'Member',
    sequence: index + 1, body: `Message ${index}`, created_at: '2030-01-01T00:00:00Z', deleted: false,
  }));
  return {
    version: 1, community: {name: 'Example'}, member: {id: 'member-1', username: 'member', owner: false}, members: [], categories: [], channels: [], direct_messages: [],
    messages: {'channel-1': messages}, channel_states: [], presence: {'member-1': 'online'}, typing: [{member_id: 'member-1', member_name: 'Member', channel_id: 'channel-1', expires_at: '2030-01-01T00:00:00Z'}],
    notifications: {current_member_id: 'member-1', community: {level: 'default', muted: false}, channels: {}, muted_channel_ids: []}, media: {audio_bitrate: 64000, screen_bitrate: 2500000}, cursor: 1,
  };
}

describe('ConversationCache', () => {
  it('isolates accounts, bounds history, and excludes ephemeral state', async () => {
    const cache = new MemoryConversationCache();
    await cache.save('https://chat.example.test', 'member-1', snapshot());

    const cached = await cache.load('https://chat.example.test', 'member-1');

    expect(cached?.messages['channel-1']).toHaveLength(50);
    expect(cached?.messages['channel-1'][0].id).toBe('message-10');
    expect(cached?.presence).toEqual({});
    expect(cached?.typing).toEqual([]);
    expect(await cache.load('https://chat.example.test', 'member-2')).toBeUndefined();
  });

  it('clears only the selected account cache', async () => {
    const cache = new MemoryConversationCache();
    await cache.save('https://one.example.test', 'member-1', snapshot());
    await cache.save('https://two.example.test', 'member-1', snapshot());
    await cache.clear('https://one.example.test', 'member-1');
    expect(await cache.load('https://one.example.test', 'member-1')).toBeUndefined();
    expect(await cache.load('https://two.example.test', 'member-1')).toBeDefined();
  });
});
