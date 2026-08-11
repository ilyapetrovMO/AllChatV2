import notifee, {AndroidImportance, AuthorizationStatus} from '@notifee/react-native';

import type {Message, NotificationSetting} from '../client/bootstrap';

export type NotificationContext = {
  currentMemberID: string; activeConversationID: string; appFocused: boolean;
  community: NotificationSetting; channels: Record<string, NotificationSetting>; mutedChannelIDs: string[];
  channelName?: string; direct?: boolean;
};
export type DesktopNotification = {conversationID: string; title: string; body: string; sound: boolean};
export interface NativeNotifier {notify(notification: DesktopNotification): Promise<void>}

export class NotificationService {
  private lastToast = new Map<string, number>(); private lastSound = 0;
  constructor(private readonly notifier: NativeNotifier = new NotifeeNotifier(), private readonly now: () => number = Date.now) {}

  async handleMessage(message: Message, context: NotificationContext): Promise<boolean> {
    if (!shouldNotify(message, context)) return false;
    const now = this.now(); const last = this.lastToast.get(message.channel_id) || 0;
    if (now - last < 1500) return false;
    this.lastToast.set(message.channel_id, now);
    const sound = now - this.lastSound >= 1000 && context.community.sound_enabled !== false;
    if (sound) this.lastSound = now;
    await this.notifier.notify({conversationID: message.channel_id, title: context.direct ? message.author_name : `${message.author_name} · #${context.channelName || 'channel'}`, body: preview(message.body || (message.attachments?.length ? 'Sent an Attachment' : 'New Message')), sound});
    return true;
  }
}

export function shouldNotify(message: Message, context: NotificationContext): boolean {
  if (message.author_id === context.currentMemberID || context.mutedChannelIDs.includes(message.channel_id)) return false;
  if (context.appFocused && context.activeConversationID === message.channel_id) return false;
  const channel = context.channels[message.channel_id];
  if (channel?.muted) return false;
  const level = channel?.level && channel.level !== 'default' ? channel.level : context.community.level;
  if (context.community.muted || level === 'nothing') return false;
  if (level === 'mentions_only') return Boolean(message.mentions?.some(mention => mention.member_id === context.currentMemberID));
  return level === 'all_messages' || level === 'default';
}

class NotifeeNotifier implements NativeNotifier {
  async notify(notification: DesktopNotification): Promise<void> {
    const settings = await notifee.requestPermission();
    if (settings.authorizationStatus === AuthorizationStatus.DENIED) return;
    const channelId = await notifee.createChannel({id: 'messages', name: 'Messages', importance: AndroidImportance.HIGH, sound: 'default'});
    await notifee.displayNotification({title: notification.title, body: notification.body, data: {conversation_id: notification.conversationID}, android: {channelId, pressAction: {id: 'default'}, sound: notification.sound ? 'default' : undefined}});
  }
}

function preview(value: string) { return value.replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160); }
