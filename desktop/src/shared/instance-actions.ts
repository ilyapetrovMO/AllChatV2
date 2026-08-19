import type { MemberSummary } from './desktop-bridge';
import type { Attachment, Category, Channel, DirectMessage, Message, SearchResult } from './instance-state';

export interface SessionInfo { id: string; device: string; created_at: string; last_activity: string; current: boolean }
export interface Report { id: string; reporter_id: string; target_member_id?: string; target_message_id?: string; reason: string; status: string; created_at: string; outcome?: string }
export interface ModerationRecord { id: number; actor_id: string; action: string; target_member_id?: string; target_message_id?: string; target_resource_id?: string; report_id?: string; reason: string; outcome: string; created_at: string }
export interface DirectCall { id: string; direct_message_id: string; caller_id: string; recipient_id: string; state: string; created_at: string; expires_at?: string; finished_at?: string }
export interface VoiceParticipant { member_id: string; room_id: string; connected: boolean; joined_at: string; rejoin_before?: string; server_muted: boolean; speaking: boolean; muted: boolean; screen_sharing: boolean }
export interface AdminDashboard { checked_at: string; uptime_seconds: number; health: Record<string, string>; counts: { members: number; online_members: number; messages: number; attachments: number }; resources: { cpu_seconds: number; cpu_cores: number; memory_bytes: number; heap_bytes: number; disk_total_bytes: number; disk_available_bytes: number; app_storage_bytes: number }; storage_sources: Array<{ name: string; bytes: number }>; message_rate: { messages_per_minute: number; buckets: Array<{ at: string; count: number }> } }
export interface CommunityRole { id: string; name: string; position: number; default: boolean; owner: boolean; permissions: string[] }
export interface CommunityInvitation { id: string; token?: string; expires_at: string; max_uses: number; use_count: number; revoked: boolean }
export interface SoundboardSound { id: string; name: string; emoji?: string; content_type: string; size: number; duration_ms: number; position: number; audio_url: string }
export interface CommunitySettings { max_attachment_mib: number; home_markdown: string; push_relay_url: string; push_key_id: string; push_public_key: string }

export type InstanceAction =
  | { type: 'load_messages'; conversationId: string; direct: boolean; before?: number; after?: number; limit?: number }
  | { type: 'send_message'; conversationId: string; direct: boolean; body: string; attachmentIds?: string[]; replyTo?: string }
  | { type: 'edit_message'; messageId: string; body: string }
  | { type: 'delete_message'; messageId: string; conversationId: string }
  | { type: 'update_read_position'; conversationId: string; direct: boolean; sequence: number }
  | { type: 'send_typing'; conversationId: string }
  | { type: 'set_reaction'; messageId: string; emoji: string; active: boolean }
  | { type: 'set_pinned'; messageId: string; active: boolean }
  | { type: 'set_community_notifications'; level: 'all_messages' | 'mentions_only' | 'nothing'; muted: boolean; soundEnabled: boolean }
  | { type: 'set_channel_notifications'; channelId: string; level: 'default' | 'all_messages' | 'mentions_only' | 'nothing'; muted: boolean }
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
  | { type: 'delete_account'; password: string; confirmation: string }
  | { type: 'current_call' }
  | { type: 'start_call'; directMessageId: string }
  | { type: 'call_action'; callId: string; action: 'accept' | 'decline' | 'end' }
  | { type: 'turn_credentials' }
  | { type: 'list_voice_participants'; channelId: string }
  | { type: 'moderate_voice_participant'; roomId: string; memberId: string; action: 'mute' | 'unmute' | 'disconnect' }
  | { type: 'admin_dashboard' }
  | { type: 'list_roles' }
  | { type: 'create_role'; name: string; position: number; permissions: string[] }
  | { type: 'update_role'; roleId: string; name: string; position: number; permissions: string[] }
  | { type: 'retire_role'; roleId: string }
  | { type: 'list_invitations' }
  | { type: 'create_invitation'; expiresInMinutes: number; maxUses: number }
  | { type: 'revoke_invitation'; invitationId: string }
  | { type: 'create_category'; name: string; position: number }
  | { type: 'create_channel'; categoryId: string; name: string; channelType: 'text' | 'voice'; position: number }
  | { type: 'set_channel_archived'; channelId: string; archived: boolean }
  | { type: 'update_channel'; channelId: string; categoryId: string; name: string; channelType: 'text' | 'voice'; position: number }
  | { type: 'set_channel_override'; channelId: string; roleId: string; permission: string; effect: 'allow' | 'deny' | 'inherit' }
  | { type: 'delete_channel'; channelId: string }
  | { type: 'list_soundboard' }
  | { type: 'upload_sound'; name: string; emoji: string; contentType: string; data: Uint8Array; position: number }
  | { type: 'update_sound'; soundId: string; name: string; emoji: string; position: number }
  | { type: 'delete_sound'; soundId: string }
  | { type: 'set_soundboard_limit'; maxDurationMs: number }
  | { type: 'get_community_settings' }
  | { type: 'update_community_settings'; maxAttachmentMiB: number; homeMarkdown: string; pushRelayURL: string }
  | { type: 'community_home' };

export type MessagePage = { messages: Message[]; has_more: boolean; next_before?: number; next_after?: number };

export type InstanceActionResult =
  | { type: 'message'; message: Message }
  | { type: 'messages'; conversationId: string; direction: 'older' | 'newer'; page: MessagePage }
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
  | { type: 'call'; call: DirectCall | null }
  | { type: 'turn_credentials'; iceServers: RTCIceServer[] }
  | { type: 'voice_participants'; channelId: string; participants: VoiceParticipant[] }
  | { type: 'admin_dashboard'; dashboard: AdminDashboard }
  | { type: 'roles'; roles: CommunityRole[] }
  | { type: 'role'; role: CommunityRole }
  | { type: 'invitations'; invitations: CommunityInvitation[] }
  | { type: 'invitation'; invitation: CommunityInvitation }
  | { type: 'category'; category: Category }
  | { type: 'channel'; channel: Channel }
  | { type: 'soundboard'; sounds: SoundboardSound[]; maxDurationMs: number; canManage: boolean }
  | { type: 'sound'; sound: SoundboardSound }
  | { type: 'community_settings'; settings: CommunitySettings }
  | { type: 'community_settings_unavailable'; reason: string }
  | { type: 'community_home'; markdown: string }
  | { type: 'accepted' };
