import type { MemberSummary } from './desktop-bridge';
import type { Attachment, DirectMessage, Message, SearchResult } from './instance-state';

export interface SessionInfo { id: string; device: string; created_at: string; last_activity: string; current: boolean }
export interface Report { id: string; reporter_id: string; target_member_id?: string; target_message_id?: string; reason: string; status: string; created_at: string; outcome?: string }
export interface ModerationRecord { id: number; actor_id: string; action: string; target_member_id?: string; target_message_id?: string; target_resource_id?: string; report_id?: string; reason: string; outcome: string; created_at: string }

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
  | { type: 'load_asset'; path: string }
  | { type: 'update_profile'; username: string; displayName: string }
  | { type: 'update_profile_image'; kind: 'avatar' | 'banner'; contentType: string; data: Uint8Array }
  | { type: 'remove_profile_image'; kind: 'avatar' | 'banner' }
  | { type: 'set_presence'; mode: 'available' | 'dnd' }
  | { type: 'open_dm'; memberId: string }
  | { type: 'set_block'; memberId: string; blocked: boolean }
  | { type: 'list_sessions' }
  | { type: 'revoke_session'; sessionId: string }
  | { type: 'create_report'; targetMemberId?: string; targetMessageId?: string; reason: string }
  | { type: 'list_reports' }
  | { type: 'resolve_report'; reportId: string; outcome: string }
  | { type: 'list_moderation_records' }
  | { type: 'purge_moderation_records'; before: string }
  | { type: 'moderate'; action: string; targetMemberId?: string; targetMessageId?: string; invitationId?: string; reason: string; durationMinutes?: number }
  | { type: 'export_account' }
  | { type: 'delete_account'; password: string; confirmation: string };

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
  | { type: 'member'; member: MemberSummary }
  | { type: 'direct_message'; directMessage: DirectMessage }
  | { type: 'sessions'; sessions: SessionInfo[] }
  | { type: 'reports'; reports: Report[] }
  | { type: 'report'; report: Report }
  | { type: 'moderation_records'; records: ModerationRecord[] }
  | { type: 'moderation_record'; record: ModerationRecord }
  | { type: 'account_deleted' }
  | { type: 'accepted' };
