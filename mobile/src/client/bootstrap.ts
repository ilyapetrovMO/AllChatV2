import type {Member} from './AllChatClient';

export type Category = {id: string; name: string; position: number; archived: boolean};
export type Channel = {id: string; category_id: string; name: string; type: 'text' | 'voice'; position: number; archived: boolean};
export type DirectMessage = {id: string; other: Member; blocked_by_me: boolean; blocked_me: boolean; unread: number; created_at: string};
export type Attachment = {id: string; message_id?: string; name: string; content_type: string; size: number; url?: string};
export type Message = {
  id: string; channel_id: string; author_id: string; author_name: string; author_avatar_url?: string;
  sequence: number; body?: string; created_at: string; edited_at?: string; deleted: boolean;
  rendered_html?: string; pinned?: boolean; attachments?: Attachment[];
};
export type ChannelState = {channel_id: string; read_sequence: number; last_sequence: number; unread: number};
export type NotificationSetting = {level: 'default' | 'all_messages' | 'mentions_only' | 'nothing'; muted: boolean; sound_enabled?: boolean};

export type MobileBootstrap = {
  version: 1;
  community: {name: string};
  member: Member;
  members: Member[];
  categories: Category[];
  channels: Channel[];
  direct_messages: DirectMessage[];
  messages: Record<string, Message[]>;
  channel_states: ChannelState[];
  presence: Record<string, 'online' | 'idle' | 'dnd' | 'offline' | 'mobile'>;
  typing: Array<{member_id: string; member_name: string; channel_id: string; expires_at: string}>;
  notifications: {
    current_member_id: string;
    community: NotificationSetting;
    channels: Record<string, NotificationSetting>;
    muted_channel_ids: string[];
  };
  media: {audio_bitrate: number; screen_bitrate: number};
  cursor: number;
};
