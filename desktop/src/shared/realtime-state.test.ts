import { describe, expect, it } from 'vitest';

import { reduceRealtimeFrame } from './realtime-state';
import type { InstanceViewState } from './instance-state';

describe('realtime Instance state', () => {
  it('applies a Message event in sequence order and advances unread state', () => {
    const state: InstanceViewState = {
      connection: 'online', version: 1, community: { name: 'Home' },
      member: { id: 'me', username: 'nora', owner: false }, members: [], categories: [], channels: [], direct_messages: [],
      messages: { chat: [{ id: 'm2', channel_id: 'chat', author_id: 'me', author_name: 'nora', sequence: 2, body: 'second', created_at: '', deleted: false }] },
      channel_states: [{ channel_id: 'chat', read_sequence: 2, last_sequence: 2, unread: 0 }], presence: {}, typing: [],
      notifications: { current_member_id: 'me', community: { level: 'default', muted: false }, channels: {}, muted_channel_ids: [] },
      media: { audio_bitrate: 64000, screen_bitrate: 2500000 }, cursor: 2,
    };

    const result = reduceRealtimeFrame(state, {
      type: 'message.created', cursor: 3, channel_id: 'chat',
      payload: { id: 'm3', channel_id: 'chat', author_id: 'other', author_name: 'Alex', sequence: 3, body: 'third', created_at: '', deleted: false },
    });

    expect(result.messages.chat?.map(({ id }) => id)).toEqual(['m2', 'm3']);
    expect(result.channel_states[0]?.unread).toBe(1);
    expect(result.cursor).toBe(3);
  });
});
