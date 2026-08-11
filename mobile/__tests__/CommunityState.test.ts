import type {MobileBootstrap, Message} from '../src/client/bootstrap';
import {communityStateFromBootstrap, reduceRealtimeFrame} from '../src/state/CommunityState';

const firstMessage: Message = {
  id: 'message-1', channel_id: 'channel-1', author_id: 'member-2', author_name: 'Other Member',
  sequence: 1, body: 'First', created_at: '2030-01-01T00:00:00Z', deleted: false,
};

const bootstrap: MobileBootstrap = {
  version: 1,
  community: {name: 'Example Community'},
  member: {id: 'member-1', username: 'member', owner: false},
  members: [], categories: [],
  channels: [{id: 'channel-1', category_id: 'category-1', name: 'general', type: 'text', position: 0, archived: false}],
  direct_messages: [], messages: {'channel-1': [firstMessage]},
  channel_states: [{channel_id: 'channel-1', read_sequence: 1, last_sequence: 1, unread: 0}],
  presence: {}, typing: [],
  notifications: {current_member_id: 'member-1', community: {level: 'all_messages', muted: false}, channels: {}, muted_channel_ids: []},
  media: {audio_bitrate: 64000, screen_bitrate: 2500000}, cursor: 4,
};

describe('CommunityState', () => {
  it('applies batches of realtime Message events once and advances unread state', () => {
    const nextMessage = {...firstMessage, id: 'message-2', sequence: 2, body: 'Second'};
    const state = reduceRealtimeFrame(communityStateFromBootstrap(bootstrap), {
      type: 'events', cursor: 6, events: [
        {cursor: 5, type: 'message.created', channel_id: 'channel-1', payload: nextMessage},
        {cursor: 6, type: 'message.created', channel_id: 'channel-1', payload: nextMessage},
      ],
    });

    expect(state.messages['channel-1'].map(message => message.id)).toEqual(['message-1', 'message-2']);
    expect(state.channel_states[0]).toMatchObject({last_sequence: 2, unread: 1});
    expect(state.cursor).toBe(6);
  });

  it('updates edited, deleted, presence, and typing state', () => {
    let state = communityStateFromBootstrap(bootstrap);
    state = reduceRealtimeFrame(state, {type: 'message.edited', cursor: 5, channel_id: 'channel-1', payload: {...firstMessage, body: 'Edited', edited_at: '2030-01-01T00:01:00Z'}});
    state = reduceRealtimeFrame(state, {type: 'message.deleted', cursor: 6, channel_id: 'channel-1', payload: {...firstMessage, deleted: true}});
    state = reduceRealtimeFrame(state, {type: 'state.ephemeral', cursor: 6, payload: {presence: {'member-2': 'mobile'}, typing: [{member_id: 'member-2', member_name: 'Other Member', channel_id: 'channel-1', expires_at: '2030-01-01T00:01:00Z'}]}});

    expect(state.messages['channel-1'][0]).toMatchObject({body: 'Edited', deleted: true});
    expect(state.presence['member-2']).toBe('mobile');
    expect(state.typing[0].member_name).toBe('Other Member');
  });

  it('requests a fresh bootstrap when realtime history cannot resume', () => {
    const state = reduceRealtimeFrame(communityStateFromBootstrap(bootstrap), {type: 'snapshot_required', cursor: 20});
    expect(state.needs_refresh).toBe(true);
    expect(state.cursor).toBe(20);
  });
});
