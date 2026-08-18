import type { Message } from './instance-state';

export type InstanceAction =
  | { type: 'load_messages'; conversationId: string; direct: boolean; before?: number; limit?: number }
  | { type: 'send_message'; conversationId: string; direct: boolean; body: string }
  | { type: 'edit_message'; messageId: string; body: string }
  | { type: 'delete_message'; messageId: string; conversationId: string }
  | { type: 'update_read_position'; conversationId: string; direct: boolean; sequence: number }
  | { type: 'send_typing'; conversationId: string };

export type MessagePage = { messages: Message[]; has_more: boolean; next_before: number };

export type InstanceActionResult =
  | { type: 'message'; message: Message }
  | { type: 'messages'; page: MessagePage }
  | { type: 'deleted_message'; messageId: string; conversationId: string }
  | { type: 'read_position'; conversationId: string; sequence: number }
  | { type: 'accepted' };
