jest.mock('@notifee/react-native', () => ({__esModule: true, default: {}, AndroidImportance: {HIGH: 4}, AuthorizationStatus: {DENIED: 0}}));

import type {Message} from '../src/client/bootstrap';
import {NotificationService, shouldNotify} from '../src/notifications/NotificationService';

const message: Message = {id: 'message-1', channel_id: 'channel-1', author_id: 'member-2', author_name: 'Friend', sequence: 1, body: '**Hello**', created_at: '2030-01-01T00:00:00Z', deleted: false};
const context = {currentMemberID: 'member-1', activeConversationID: '', appFocused: true, community: {level: 'all_messages' as const, muted: false, sound_enabled: true}, channels: {}, mutedChannelIDs: [], channelName: 'general'};

describe('NotificationService', () => {
  it('suppresses own Messages and a focused active conversation only', () => {
    expect(shouldNotify({...message, author_id: 'member-1'}, context)).toBe(false);
    expect(shouldNotify(message, {...context, activeConversationID: 'channel-1'})).toBe(false);
    expect(shouldNotify(message, {...context, activeConversationID: 'channel-2'})).toBe(true);
    expect(shouldNotify(message, {...context, activeConversationID: 'channel-1', appFocused: false})).toBe(true);
  });

  it('applies mutes, inheritance, and mention-only policy', () => {
    expect(shouldNotify(message, {...context, mutedChannelIDs: ['channel-1']})).toBe(false);
    expect(shouldNotify(message, {...context, channels: {'channel-1': {level: 'nothing', muted: false}}})).toBe(false);
    expect(shouldNotify(message, {...context, community: {...context.community, level: 'mentions_only'}})).toBe(false);
    expect(shouldNotify({...message, mentions: [{member_id: 'member-1', username: 'member'}]}, {...context, community: {...context.community, level: 'mentions_only'}})).toBe(true);
    expect(shouldNotify(message, {...context, community: {...context.community, level: 'nothing'}, channels: {'channel-1': {level: 'all_messages', muted: false}}})).toBe(true);
  });

  it('rate-limits per-conversation toasts and global sound', async () => {
    const notify = jest.fn(async (_notification: {sound: boolean}) => {}); let now = 2000;
    const service = new NotificationService({notify}, () => now);
    await service.handleMessage(message, context); now = 2500;
    await service.handleMessage({...message, id: 'message-2'}, context);
    await service.handleMessage({...message, id: 'message-3', channel_id: 'channel-2'}, context);
    now = 3600; await service.handleMessage({...message, id: 'message-4'}, context);
    expect(notify).toHaveBeenCalledTimes(3);
    expect(notify.mock.calls.map(call => call[0].sound)).toEqual([true, false, true]);
  });
});
