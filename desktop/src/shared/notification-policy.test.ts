import { describe, expect, it } from 'vitest';
import type { InstanceViewState, Message } from './instance-state';
import { shouldNotifyForMessage } from './notification-policy';

const message: Message = { id: 'message', channel_id: 'chat', author_id: 'other', author_name: 'Other', sequence: 1, body: '@me hello', created_at: '', deleted: false };
const state = { member: { id: 'me' }, notifications: { community: { level: 'mentions_only', muted: false }, channels: {}, muted_channel_ids: [] } } as unknown as InstanceViewState;

describe('desktop notification policy', () => {
  it('requires a structured direct Mention for mentions-only', () => {
    expect(shouldNotifyForMessage(message, state, false)).toBe(false);
    expect(shouldNotifyForMessage({ ...message, mentions: [{ member_id: 'me', username: 'me' }] }, state, false)).toBe(true);
  });

  it('gives focus, own Messages, and mutes precedence', () => {
    const mentioned = { ...message, mentions: [{ member_id: 'me', username: 'me' }] };
    expect(shouldNotifyForMessage(mentioned, state, true, 'chat')).toBe(false);
    expect(shouldNotifyForMessage(mentioned, state, true, 'other')).toBe(true);
    expect(shouldNotifyForMessage({ ...mentioned, author_id: 'me' }, state, false)).toBe(false);
    expect(shouldNotifyForMessage(mentioned, { ...state, notifications: { ...state.notifications, muted_channel_ids: ['chat'] } }, false)).toBe(false);
  });

  it('honors conversation overrides over the Community level', () => {
    expect(shouldNotifyForMessage(message, { ...state, notifications: { ...state.notifications, community: { level: 'nothing', muted: false }, channels: { chat: { level: 'all_messages', muted: false } } } }, false)).toBe(true);
  });
});
