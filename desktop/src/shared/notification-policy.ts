import type { InstanceViewState, Message } from './instance-state';

export function shouldNotifyForMessage(message: Message, state: InstanceViewState, appFocused: boolean, activeConversationId = ''): boolean {
  if ((appFocused && activeConversationId === message.channel_id) || message.author_id === state.member.id || state.notifications.muted_channel_ids.includes(message.channel_id)) return false;
  const channel = state.notifications.channels[message.channel_id];
  if (state.notifications.community.muted || channel?.muted) return false;
  const level = channel?.level && channel.level !== 'default' ? channel.level : state.notifications.community.level;
  if (level === 'nothing') return false;
  if (level === 'mentions_only') return Boolean(message.mentions?.some(({ member_id }) => member_id === state.member.id));
  return level === 'all_messages' || level === 'default';
}

export function notificationPreview(message: Message): string {
  const text = (message.body || '').replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();
  return (text || (message.attachments?.length ? 'Sent an Attachment' : 'New Message')).slice(0, 160);
}
