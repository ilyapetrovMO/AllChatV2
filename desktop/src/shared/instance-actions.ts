import type { Attachment, Message, SearchResult } from './instance-state';

export type InstanceAction =
  | { type: 'load_messages'; conversationId: string; direct: boolean; before?: number; limit?: number }
  | { type: 'send_message'; conversationId: string; direct: boolean; body: string; attachmentIds?: string[]; replyTo?: string }
  | { type: 'edit_message'; messageId: string; body: string }
  | { type: 'delete_message'; messageId: string; conversationId: string }
  | { type: 'update_read_position'; conversationId: string; direct: boolean; sequence: number }
  | { type: 'send_typing'; conversationId: string }
  | { type: 'set_reaction'; messageId: string; emoji: string; active: boolean }
  | { type: 'set_pinned'; messageId: string; active: boolean }
  | { type: 'list_pins'; channelId: string }
  | { type: 'search_messages'; query: string; cursor?: string }
  | { type: 'upload_attachment'; name: string; contentType: string; data: Uint8Array }
  | { type: 'link_preview'; url: string }
  | { type: 'load_asset'; path: string };

export type MessagePage = { messages: Message[]; has_more: boolean; next_before: number };

export type InstanceActionResult =
  | { type: 'message'; message: Message }
  | { type: 'messages'; conversationId: string; page: MessagePage }
  | { type: 'deleted_message'; messageId: string; conversationId: string }
  | { type: 'read_position'; conversationId: string; sequence: number }
  | { type: 'attachment'; attachment: Attachment }
  | { type: 'search_results'; results: SearchResult[]; nextCursor?: string }
  | { type: 'link_preview'; preview: { url: string; site_name?: string; title?: string; description?: string; image_url?: string } }
  | { type: 'asset'; contentType: string; data: Uint8Array }
  | { type: 'accepted' };
