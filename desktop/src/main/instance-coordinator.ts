import type { InstanceViewState } from '../shared/instance-state';
import type { DesktopCredentialVault } from './desktop-credential-vault';
import type { InstanceRegistry } from './instance-registry';
import { MemoryInstanceStateCache, type InstanceStateCache } from './instance-state-cache';
import { RealtimeConnection, type RealtimeConnectionOptions } from './realtime-connection';
import { reduceRealtimeFrame } from '../shared/realtime-state';
import type { InstanceAction, InstanceActionResult } from '../shared/instance-actions';
import { MemoryAssetCache, type AssetCache, type CachedAsset } from './asset-cache';

const ASSET_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
interface RealtimeDriver { start(): void; stop(): void; sendTyping(conversationId: string): void; sendActivity(active: boolean): void }

export class InstanceCoordinator {
  onMessage?: (instanceId: string, message: import('../shared/instance-state').Message, state: InstanceViewState) => void;
  readonly #states = new Map<string, InstanceViewState>();
  readonly #listeners = new Map<string, Set<(state: InstanceViewState) => void>>();
  readonly #connections = new Map<string, RealtimeDriver>();
  readonly #assetLoads = new Map<string, Promise<InstanceActionResult>>();
  constructor(
    private readonly registry: InstanceRegistry,
    private readonly vault: DesktopCredentialVault,
    private readonly request: typeof fetch = fetch,
    private readonly cache: InstanceStateCache = new MemoryInstanceStateCache(),
    private readonly assetCache: AssetCache = new MemoryAssetCache(),
    private readonly createRealtime: (options: RealtimeConnectionOptions) => RealtimeDriver = (options) => new RealtimeConnection(options),
  ) {}

  async load(instanceId: string): Promise<InstanceViewState> {
    const profile = this.registry.get(instanceId);
    if (!profile.credentialRef) throw new Error('Sign in to this Instance first.');
    const token = await this.vault.get(profile.credentialRef);
    if (!token) throw new Error('Desktop Device Session is unavailable. Sign in again.');

    let response: Response;
    try {
      response = await this.request(`${profile.baseUrl}/api/v1/mobile/bootstrap?history=recent`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      const cached = this.cache.get(instanceId);
      if (cached) return { ...cached, connection: 'offline' };
      throw new Error('Could not synchronize the Instance.');
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      if (response.status >= 500) {
        const cached = this.cache.get(instanceId);
        if (cached) return { ...cached, connection: 'offline' };
      }
      const message = body && typeof body === 'object' && 'error' in body &&
        typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : 'Could not synchronize the Instance.';
      throw new Error(message);
    }
    if (!isInstanceViewState(body)) {
      const version = body && typeof body === 'object' ? (body as { version?: unknown }).version : undefined;
      if (typeof version === 'number') {
        throw new Error(`Incompatible Instance protocol: version ${version}. This desktop app supports version 1.`);
      }
      throw new Error('Instance returned an unsupported bootstrap contract.');
    }
    const state = normalizeMembers(body);
	this.registry.updateCommunityIdentity(instanceId, state.community.name, state.community.avatar_url);
    this.#states.set(instanceId, state);
    this.cache.put(instanceId, state);
    return state;
  }

  watch(instanceId: string, listener: (state: InstanceViewState) => void): void {
    const listeners = this.#listeners.get(instanceId) || new Set();
    listeners.add(listener);
    this.#listeners.set(instanceId, listeners);
    if (!this.#connections.has(instanceId)) void this.startRealtime(instanceId);
  }

  async execute(instanceId: string, action: InstanceAction): Promise<InstanceActionResult> {
    const profile = this.registry.get(instanceId);
    const token = await this.credential(profile.credentialRef);
    if (action.type === 'send_typing') {
      this.#connections.get(instanceId)?.sendTyping(action.conversationId);
      return { type: 'accepted' };
    }
    if (action.type === 'report_activity') {
      this.#connections.get(instanceId)?.sendActivity(action.active);
      return { type: 'accepted' };
    }
    if (action.type === 'load_messages') {
      const query = new URLSearchParams({ limit: String(action.limit || 50) });
      if (action.before) query.set('before', String(action.before));
      if (action.after) query.set('after', String(action.after));
      const kind = action.direct ? 'dms' : 'channels';
      const response = await this.request(`${profile.baseUrl}/api/v1/${kind}/${encodeURIComponent(action.conversationId)}/messages?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok || !isMessagePage(body)) throw new Error(readError(body, 'Could not load Messages.'));
      return { type: 'messages', conversationId: action.conversationId, direction: action.after ? 'newer' : 'older', page: body };
    }
    if (action.type === 'send_message') {
      const kind = action.direct ? 'dms' : 'channels';
      const response = await this.request(
        `${profile.baseUrl}/api/v1/${kind}/${encodeURIComponent(action.conversationId)}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: action.body,
            ...(action.attachmentIds?.length ? { attachment_ids: action.attachmentIds } : {}),
            ...(action.replyTo ? { reply_to: action.replyTo } : {}),
          }),
        },
      );
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok || !isMessage(body)) throw new Error(response.ok ? 'Instance returned an invalid Message.' : readError(body, 'Could not send the Message.'));
      return { type: 'message', message: body };
    }
    if (action.type === 'edit_message') {
      const response = await this.request(`${profile.baseUrl}/api/v1/messages/${encodeURIComponent(action.messageId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: action.body }),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok || !isMessage(body)) throw new Error(readError(body, 'Could not edit the Message.'));
      return { type: 'message', message: body };
    }
    if (action.type === 'delete_message') {
      const response = await this.request(`${profile.baseUrl}/api/v1/messages/${encodeURIComponent(action.messageId)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Could not delete the Message.');
      return { type: 'deleted_message', messageId: action.messageId, conversationId: action.conversationId };
    }
    if (action.type === 'update_read_position') {
      const kind = action.direct ? 'dms' : 'channels';
      const response = await this.request(`${profile.baseUrl}/api/v1/${kind}/${encodeURIComponent(action.conversationId)}/read-position`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence: action.sequence }),
      });
      if (!response.ok) throw new Error('Could not update the Read Position.');
      return { type: 'read_position', conversationId: action.conversationId, sequence: action.sequence };
    }
    if (action.type === 'set_reaction') {
      const response = await this.request(`${profile.baseUrl}/api/v1/messages/${encodeURIComponent(action.messageId)}/reactions`, {
        method: action.active ? 'PUT' : 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji: action.emoji }),
      });
      if (!response.ok) throw new Error('Could not update the Reaction.');
      const current = this.#states.get(instanceId);
      if (current) {
        const state = {
          ...current,
          messages: Object.fromEntries(Object.entries(current.messages).map(([conversationId, messages]) => [
            conversationId,
            messages.map((message) => message.id === action.messageId ? {
              ...message,
              reactions: updateReaction(message.reactions || [], action.emoji, action.active),
            } : message),
          ])),
        };
        this.#states.set(instanceId, state);
        this.cache.put(instanceId, state);
        this.publish(instanceId, state);
      }
      return { type: 'accepted' };
    }
    if (action.type === 'set_pinned') {
      const response = await this.request(`${profile.baseUrl}/api/v1/messages/${encodeURIComponent(action.messageId)}/pin`, {
        method: action.active ? 'PUT' : 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Could not update the Pinned Message.');
	  const current = this.#states.get(instanceId);
	  if (current) {
		const state = { ...current, messages: Object.fromEntries(Object.entries(current.messages).map(([conversationId, messages]) => [conversationId, messages.map((message) => message.id === action.messageId ? { ...message, pinned: action.active } : message)])) };
		this.#states.set(instanceId, state); this.cache.put(instanceId, state); this.publish(instanceId, state);
	  }
      return { type: 'accepted' };
    }
    if (action.type === 'set_community_notifications') {
      const response = await this.request(`${profile.baseUrl}/api/v1/notification-settings`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: action.level, muted: action.muted, sound_enabled: action.soundEnabled }),
      });
      if (!response.ok) throw new Error('Could not update notification settings.');
      const current = this.#states.get(instanceId);
      if (current) this.storeAndPublish(instanceId, { ...current, notifications: { ...current.notifications, community: { level: action.level, muted: action.muted, sound_enabled: action.soundEnabled } } });
      return { type: 'accepted' };
    }
    if (action.type === 'set_channel_notifications') {
      const response = await this.request(`${profile.baseUrl}/api/v1/channels/${encodeURIComponent(action.channelId)}/notification-settings`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: action.level, muted: action.muted }),
      });
      if (!response.ok) throw new Error('Could not update conversation notification settings.');
      const current = this.#states.get(instanceId);
      if (current) this.storeAndPublish(instanceId, { ...current, notifications: { ...current.notifications, channels: { ...current.notifications.channels, [action.channelId]: { level: action.level, muted: action.muted } } } });
      return { type: 'accepted' };
    }
    if (action.type === 'list_pins') {
      const response = await this.request(`${profile.baseUrl}/api/v1/channels/${encodeURIComponent(action.channelId)}/pins`, { headers: { Authorization: `Bearer ${token}` } });
      const body: unknown = await response.json().catch(() => undefined);
      const messages = body && typeof body === 'object' && 'messages' in body ? (body as { messages?: unknown }).messages : undefined;
      if (!response.ok || !Array.isArray(messages) || !messages.every(isMessage)) throw new Error('Could not load Pinned Messages.');
      return { type: 'messages', conversationId: action.channelId, direction: 'older', page: { messages, has_more: false, next_before: 0 } };
    }
    if (action.type === 'search_messages') {
      const query = new URLSearchParams({ q: action.query, limit: '25' });
      if (action.cursor) query.set('cursor', action.cursor);
      const response = await this.request(`${profile.baseUrl}/api/v1/search?${query}`, { headers: { Authorization: `Bearer ${token}` } });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok || !isSearchPage(body)) throw new Error(readError(body, 'Could not search Messages.'));
      return { type: 'search_results', results: body.results, ...(body.next_cursor ? { nextCursor: body.next_cursor } : {}) };
    }
    if (action.type === 'upload_attachment') {
      const query = new URLSearchParams({ filename: action.name });
      const response = await this.request(`${profile.baseUrl}/api/v1/attachments?${query}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': action.contentType || 'application/octet-stream' }, body: Buffer.from(action.data) as unknown as BodyInit,
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok || !isAttachment(body)) throw new Error(readError(body, `Could not upload ${action.name}.`));
      return { type: 'attachment', attachment: body };
    }
    if (action.type === 'link_preview') {
      const query = new URLSearchParams({ url: action.url });
      const response = await this.request(`${profile.baseUrl}/api/v1/link-preview?${query}`, { headers: { Authorization: `Bearer ${token}` } });
      const body: unknown = await response.json().catch(() => undefined);
      if ([400, 422, 502].includes(response.status)) return { type: 'accepted' };
      if (!response.ok || !isLinkPreview(body)) throw new Error('Link preview unavailable.');
      return { type: 'link_preview', preview: body };
    }
    if (action.type === 'load_asset') {
      const assetUrl = new URL(action.path, profile.baseUrl);
      const cacheable = /^\/api\/v1\/members\/[^/]+\/(avatar|banner)$/.test(assetUrl.pathname) ||
		assetUrl.pathname === '/api/v1/community-avatar' ||
        /^\/api\/v1\/attachments\/[^/]+(?:\/preview)?$/.test(assetUrl.pathname);
      const cacheKey = `${assetUrl.pathname}${assetUrl.search}`;
      const cached = cacheable ? this.assetCache.get(instanceId, cacheKey) : null;
      if (cached && Date.now() - cached.cachedAt < ASSET_CACHE_MAX_AGE_MS) return assetResult(cached);
      const pendingKey = `${instanceId}:${cacheKey}`;
      const pending = this.#assetLoads.get(pendingKey);
      if (pending) return pending;
      const load = (async (): Promise<InstanceActionResult> => {
        try {
          const response = await this.request(assetUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!response.ok) throw new Error('Could not load the Attachment.');
          const asset: CachedAsset = {
            contentType: response.headers.get('Content-Type') || 'application/octet-stream',
            data: new Uint8Array(await response.arrayBuffer()),
            cachedAt: Date.now(),
          };
          if (cacheable) this.assetCache.put(instanceId, cacheKey, asset);
          return assetResult(asset);
        } catch (error) {
          if (cached) return assetResult(cached);
          throw error;
        } finally {
          this.#assetLoads.delete(pendingKey);
        }
      })();
      this.#assetLoads.set(pendingKey, load);
      return load;
    }
    if (action.type === 'update_profile') {
      const response = await this.request(`${profile.baseUrl}/api/v1/profile`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: action.username, display_name: action.displayName }),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok || !isMember(body)) throw new Error(readError(body, 'Could not update the profile.'));
      return { type: 'member', member: normalizeMember(body) };
    }
    if (action.type === 'update_profile_image') {
      const response = await this.request(`${profile.baseUrl}/api/v1/profile/${action.kind}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': action.contentType },
        body: Buffer.from(action.data) as unknown as BodyInit,
      });
      if (!response.ok) throw new Error(`Could not update the ${action.kind}.`);
      this.assetCache.clearInstance(instanceId);
      return { type: 'accepted' };
    }
    if (action.type === 'remove_profile_image') {
      const response = await this.request(`${profile.baseUrl}/api/v1/profile/${action.kind}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`Could not remove the ${action.kind}.`);
      this.assetCache.clearInstance(instanceId);
      return { type: 'accepted' };
    }
    if (action.type === 'set_presence') {
      const response = await this.request(`${profile.baseUrl}/api/v1/presence-mode`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: action.mode }),
      });
      if (!response.ok) throw new Error('Could not update Presence.');
      return { type: 'accepted' };
    }
    if (action.type === 'open_dm') {
      const response = await this.request(`${profile.baseUrl}/api/v1/dms`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ member_id: action.memberId }),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok || !isDirectMessage(body)) throw new Error(readError(body, 'Could not open the Direct Message.'));
      return { type: 'direct_message', directMessage: { ...body, other: normalizeMember(body.other) } };
    }
    if (action.type === 'set_block') {
      const response = await this.request(`${profile.baseUrl}/api/v1/blocks/${encodeURIComponent(action.memberId)}`, { method: action.blocked ? 'PUT' : 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`Could not ${action.blocked ? 'Block' : 'Unblock'} the Member.`);
      return { type: 'accepted' };
    }
	if (action.type === 'set_member_disabled' || action.type === 'delete_member') {
	  const response = await this.request(`${profile.baseUrl}/api/v1/admin/members/${encodeURIComponent(action.memberId)}${action.type === 'set_member_disabled' ? '/disabled' : ''}`, {
		method: action.type === 'delete_member' ? 'DELETE' : action.disabled ? 'PUT' : 'DELETE',
		headers: { Authorization: `Bearer ${token}`, ...(action.type === 'delete_member' ? { 'Content-Type': 'application/json' } : {}) },
		...(action.type === 'delete_member' ? { body: JSON.stringify({ confirmation: action.confirmation }) } : {}),
	  });
	  const errorBody: unknown = response.ok ? undefined : await response.json().catch(() => undefined);
	  if (!response.ok) throw new Error(readError(errorBody, action.type === 'delete_member' ? 'Could not delete Member.' : 'Could not update Member.'));
	  const current = this.#states.get(instanceId);
	  if (current) {
		const state = action.type === 'delete_member' ? { ...current, members: current.members.filter(({ id }) => id !== action.memberId) } : { ...current, members: current.members.map((member) => member.id === action.memberId ? { ...member, disabled: action.disabled } : member) };
		this.#states.set(instanceId, state); this.cache.put(instanceId, state); this.publish(instanceId, state);
	  }
	  return { type: 'accepted' };
	}
    if (action.type === 'list_sessions') {
      const response = await this.request(`${profile.baseUrl}/api/v1/sessions`, { headers: { Authorization: `Bearer ${token}` } });
      const body: unknown = await response.json().catch(() => undefined);
      const sessions = body && typeof body === 'object' && 'sessions' in body ? (body as { sessions?: unknown }).sessions : undefined;
      if (!response.ok || !Array.isArray(sessions)) throw new Error(readError(body, 'Could not load Sessions.'));
      return { type: 'sessions', sessions: sessions as import('../shared/instance-actions').SessionInfo[] };
    }
    if (action.type === 'list_voice_participants') {
      const response = await this.request(`${profile.baseUrl}/api/v1/voice/${encodeURIComponent(action.channelId)}/participants`, { headers: { Authorization: `Bearer ${token}` } });
      const body: unknown = await response.json().catch(() => undefined);
      const participants = body && typeof body === 'object' && 'participants' in body ? (body as { participants?: unknown }).participants : undefined;
      if (!response.ok || !Array.isArray(participants)) throw new Error(readError(body, 'Could not load Voice participants.'));
      return { type: 'voice_participants', channelId: action.channelId, participants: participants as import('../shared/instance-actions').VoiceParticipant[] };
    }
    if (action.type === 'moderate_voice_participant') {
      const suffix = action.action === 'disconnect' ? 'disconnect' : 'mute';
      const response = await this.request(`${profile.baseUrl}/api/v1/media/rooms/${encodeURIComponent(action.roomId)}/participants/${encodeURIComponent(action.memberId)}/${suffix}`, {
        method: action.action === 'unmute' ? 'DELETE' : action.action === 'mute' ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(action.action === 'disconnect' ? { body: JSON.stringify({ reason: 'Removed by a Community moderator.' }) } : {}),
      });
      if (!response.ok) throw new Error('Could not update Voice participant.');
      return { type: 'accepted' };
    }
    if (action.type === 'admin_dashboard') {
      const response = await this.request(`${profile.baseUrl}/api/v1/admin/dashboard`, { headers: { Authorization: `Bearer ${token}` } });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok || !isAdminDashboard(body)) throw new Error(readError(body, 'Could not load the Admin Dashboard.'));
      return { type: 'admin_dashboard', dashboard: body };
    }
    if (action.type === 'list_roles') {
      const response = await this.request(`${profile.baseUrl}/api/v1/roles`, { headers: { Authorization: `Bearer ${token}` } });
      const body: unknown = await response.json().catch(() => undefined);
      const roles = body && typeof body === 'object' ? (body as { roles?: unknown }).roles : undefined;
      if (!response.ok || !Array.isArray(roles) || !roles.every(isCommunityRole)) throw new Error(readError(body, 'Could not load Roles.'));
      return { type: 'roles', roles };
    }
    if (action.type === 'create_role') {
      const response = await this.jsonRequest(profile.baseUrl, token, '/api/v1/roles', 'POST', { name: action.name, position: action.position, permissions: action.permissions });
      if (!response.ok || !isCommunityRole(response.body)) throw new Error(readError(response.body, 'Could not create the Role.'));
      return { type: 'role', role: response.body };
    }
    if (action.type === 'update_role') {
      const response = await this.jsonRequest(profile.baseUrl, token, `/api/v1/roles/${encodeURIComponent(action.roleId)}`, 'PATCH', { name: action.name, position: action.position, permissions: action.permissions });
      if (!response.ok || !isCommunityRole(response.body)) throw new Error(readError(response.body, 'Could not update the Role.'));
      return { type: 'role', role: response.body };
    }
    if (action.type === 'retire_role') {
      const response = await this.request(`${profile.baseUrl}/api/v1/roles/${encodeURIComponent(action.roleId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Could not retire the Role.');
      return { type: 'accepted' };
    }
    if (action.type === 'list_invitations') {
      const response = await this.request(`${profile.baseUrl}/api/v1/invitations`, { headers: { Authorization: `Bearer ${token}` } });
      const body: unknown = await response.json().catch(() => undefined);
      const invitations = body && typeof body === 'object' ? (body as { invitations?: unknown }).invitations : undefined;
      if (!response.ok || !Array.isArray(invitations) || !invitations.every(isCommunityInvitation)) throw new Error(readError(body, 'Could not load Invitations.'));
      return { type: 'invitations', invitations };
    }
    if (action.type === 'create_invitation') {
      const response = await this.jsonRequest(profile.baseUrl, token, '/api/v1/invitations', 'POST', { expires_in_minutes: action.expiresInMinutes, max_uses: action.maxUses });
      if (!response.ok || !isCommunityInvitation(response.body)) throw new Error(readError(response.body, 'Could not create the Invitation.'));
      return { type: 'invitation', invitation: response.body };
    }
    if (action.type === 'revoke_invitation') {
      const response = await this.request(`${profile.baseUrl}/api/v1/invitations/${encodeURIComponent(action.invitationId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Could not revoke the Invitation.');
      return { type: 'accepted' };
    }
    if (action.type === 'create_category') {
      const response = await this.jsonRequest(profile.baseUrl, token, '/api/v1/categories', 'POST', { name: action.name, position: action.position });
      if (!response.ok || !isCategory(response.body)) throw new Error(readError(response.body, 'Could not create the Category.'));
      return { type: 'category', category: response.body };
    }
    if (action.type === 'create_channel') {
      const response = await this.jsonRequest(profile.baseUrl, token, '/api/v1/channels', 'POST', { category_id: action.categoryId, name: action.name, type: action.channelType, position: action.position });
      if (!response.ok || !isChannel(response.body)) throw new Error(readError(response.body, 'Could not create the Channel.'));
      return { type: 'channel', channel: response.body };
    }
    if (action.type === 'set_channel_archived') {
      const operation = action.archived ? 'archive' : 'restore';
      const response = await this.request(`${profile.baseUrl}/api/v1/channels/${encodeURIComponent(action.channelId)}/${operation}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`Could not ${operation} the Channel.`);
      return { type: 'accepted' };
    }
    if (action.type === 'update_channel') {
      const response = await this.jsonRequest(profile.baseUrl, token, `/api/v1/channels/${encodeURIComponent(action.channelId)}`, 'PATCH', { category_id: action.categoryId, name: action.name, type: action.channelType, position: action.position });
      if (!response.ok || !isChannel(response.body)) throw new Error(readError(response.body, 'Could not update the Channel.'));
      return { type: 'channel', channel: response.body };
    }
    if (action.type === 'set_channel_override') {
      const response = await this.jsonRequest(profile.baseUrl, token, `/api/v1/channels/${encodeURIComponent(action.channelId)}/overrides`, 'PUT', { role_id: action.roleId, permission: action.permission, effect: action.effect });
      if (!response.ok) throw new Error(readError(response.body, 'Could not update Channel permissions.'));
      return { type: 'accepted' };
    }
    if (action.type === 'delete_channel') {
      const prepared = await this.request(`${profile.baseUrl}/api/v1/channels/${encodeURIComponent(action.channelId)}/deletion-confirmation`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const body: unknown = await prepared.json().catch(() => undefined);
      const confirmation = body && typeof body === 'object' ? (body as { confirmation_token?: unknown }).confirmation_token : undefined;
      if (!prepared.ok || typeof confirmation !== 'string') throw new Error(readError(body, 'Could not prepare Channel deletion.'));
      const response = await this.jsonRequest(profile.baseUrl, token, `/api/v1/channels/${encodeURIComponent(action.channelId)}`, 'DELETE', { confirmation_token: confirmation });
      if (!response.ok) throw new Error(readError(response.body, 'Could not delete the Channel.'));
      return { type: 'accepted' };
    }
    if (action.type === 'list_soundboard') {
      const response = await this.request(`${profile.baseUrl}/api/v1/soundboard`, { headers: { Authorization: `Bearer ${token}` } });
      const body: unknown = await response.json().catch(() => undefined);
      const value = body as { sounds?: unknown; settings?: { max_duration_ms?: unknown }; can_manage?: unknown } | undefined;
      if (!response.ok || !value || !Array.isArray(value.sounds) || !value.sounds.every(isSoundboardSound) || typeof value.settings?.max_duration_ms !== 'number') throw new Error(readError(body, 'Could not load the Soundboard.'));
      return { type: 'soundboard', sounds: value.sounds, maxDurationMs: value.settings.max_duration_ms, canManage: value.can_manage === true };
    }
    if (action.type === 'upload_sound') {
      const form = new FormData();
      form.set('name', action.name);
      form.set('emoji', action.emoji);
      form.set('position', String(action.position));
      form.set('file', new Blob([action.data as BlobPart], { type: action.contentType }), action.name);
      const response = await this.request(`${profile.baseUrl}/api/v1/soundboard`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok || !isSoundboardSound(body)) throw new Error(readError(body, 'Could not upload the Sound.'));
      return { type: 'sound', sound: body };
    }
    if (action.type === 'update_sound') {
      const response = await this.jsonRequest(profile.baseUrl, token, `/api/v1/soundboard/${encodeURIComponent(action.soundId)}`, 'PATCH', { name: action.name, emoji: action.emoji, position: action.position });
      if (!response.ok || !isSoundboardSound(response.body)) throw new Error(readError(response.body, 'Could not update the Sound.'));
      return { type: 'sound', sound: response.body };
    }
    if (action.type === 'delete_sound') {
      const response = await this.request(`${profile.baseUrl}/api/v1/soundboard/${encodeURIComponent(action.soundId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Could not delete the Sound.');
      return { type: 'accepted' };
    }
    if (action.type === 'set_soundboard_limit') {
      const response = await this.jsonRequest(profile.baseUrl, token, '/api/v1/soundboard/settings', 'PUT', { max_duration_ms: action.maxDurationMs });
      if (!response.ok) throw new Error(readError(response.body, 'Could not save Soundboard settings.'));
      return { type: 'accepted' };
    }
    if (action.type === 'get_community_settings') {
      const response = await this.request(`${profile.baseUrl}/api/v1/admin/settings`, { headers: { Authorization: `Bearer ${token}` } });
      const body: unknown = await response.json().catch(() => undefined);
      const settings = normalizeCommunitySettings(body);
      if (!response.ok || !settings) {
        if (response.status === 404) return { type: 'community_settings_unavailable', reason: 'Update the Instance to manage Community settings from desktop.' };
        const serverError = readError(body, '');
        if (serverError) throw new Error(serverError);
        throw new Error(responseDiagnostic(response, 'Community settings API'));
      }
      return { type: 'community_settings', settings };
    }
    if (action.type === 'update_community_settings') {
      const response = await this.jsonRequest(profile.baseUrl, token, '/api/v1/admin/settings', 'PUT', { name: action.name, max_attachment_mib: action.maxAttachmentMiB, home_markdown: action.homeMarkdown, push_relay_url: action.pushRelayURL });
      if (!response.ok || !isCommunitySettings(response.body)) throw new Error(readError(response.body, 'Could not save Community settings.'));
	  const current = this.#states.get(instanceId);
	  if (current) {
		const state = { ...current, community: { ...current.community, name: response.body.name } };
		this.#states.set(instanceId, state);
		this.registry.updateCommunityIdentity(instanceId, response.body.name, response.body.avatar_url);
		this.cache.put(instanceId, state);
		this.publish(instanceId, state);
	  }
      return { type: 'community_settings', settings: response.body };
    }
	if (action.type === 'update_community_avatar' || action.type === 'remove_community_avatar') {
	  const response = await this.request(`${profile.baseUrl}/api/v1/admin/community-avatar`, {
		method: action.type === 'update_community_avatar' ? 'PUT' : 'DELETE',
		headers: { Authorization: `Bearer ${token}`, ...(action.type === 'update_community_avatar' ? { 'Content-Type': action.contentType } : {}) },
		...(action.type === 'update_community_avatar' ? { body: Buffer.from(action.data) as unknown as BodyInit } : {}),
	  });
	  if (!response.ok) throw new Error('Could not update the Community avatar.');
	  this.assetCache.clearInstance(instanceId);
	  const current = this.#states.get(instanceId);
	  if (current) {
		const avatarUrl = action.type === 'update_community_avatar' ? `/api/v1/community-avatar?v=${Date.now()}` : undefined;
		const state = { ...current, community: { ...current.community, ...(avatarUrl ? { avatar_url: avatarUrl } : { avatar_url: undefined }) } };
		this.#states.set(instanceId, state); this.registry.updateCommunityIdentity(instanceId, state.community.name, avatarUrl); this.cache.put(instanceId, state); this.publish(instanceId, state);
	  }
	  return { type: 'accepted' };
	}
    if (action.type === 'community_home') {
      const response = await this.request(`${profile.baseUrl}/api/v1/community-home`, { headers: { Authorization: `Bearer ${token}` } });
      const body: unknown = await response.json().catch(() => undefined);
      const markdown = body && typeof body === 'object' ? (body as { markdown?: unknown }).markdown : undefined;
      if (!response.ok || typeof markdown !== 'string') throw new Error(readError(body, 'Could not load the Community Guide.'));
      return { type: 'community_home', markdown };
    }
    if (action.type === 'revoke_session') {
      const response = await this.request(`${profile.baseUrl}/api/v1/sessions/${encodeURIComponent(action.sessionId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Could not revoke the Session.');
      return { type: 'accepted' };
    }
    if (action.type === 'create_report') {
      const response = await this.jsonRequest(profile.baseUrl, token, '/api/v1/reports', 'POST', { target_member_id: action.targetMemberId || '', target_message_id: action.targetMessageId || '', reason: action.reason });
      if (!response.ok || !isReport(response.body)) throw new Error(readError(response.body, 'Could not submit the Report.'));
      return { type: 'report', report: response.body };
    }
    if (action.type === 'list_reports') {
      const response = await this.request(`${profile.baseUrl}/api/v1/reports`, { headers: { Authorization: `Bearer ${token}` } });
      const body: unknown = await response.json().catch(() => undefined);
      const reports = body && typeof body === 'object' && 'reports' in body ? (body as { reports?: unknown }).reports : undefined;
      if (!response.ok || !Array.isArray(reports) || !reports.every(isReport)) throw new Error(readError(body, 'Could not load Reports.'));
      return { type: 'reports', reports };
    }
    if (action.type === 'resolve_report') {
      const response = await this.jsonRequest(profile.baseUrl, token, `/api/v1/reports/${encodeURIComponent(action.reportId)}/resolve`, 'POST', { outcome: action.outcome });
      if (!response.ok || !isReport(response.body)) throw new Error(readError(response.body, 'Could not resolve the Report.'));
      return { type: 'report', report: response.body };
    }
    if (action.type === 'list_moderation_records') {
      const response = await this.request(`${profile.baseUrl}/api/v1/moderation-records`, { headers: { Authorization: `Bearer ${token}` } });
      const body: unknown = await response.json().catch(() => undefined);
      const records = body && typeof body === 'object' && 'records' in body ? (body as { records?: unknown }).records : undefined;
      if (!response.ok || !Array.isArray(records)) throw new Error(readError(body, 'Could not load Moderation Records.'));
      return { type: 'moderation_records', records: records as import('../shared/instance-actions').ModerationRecord[] };
    }
    if (action.type === 'purge_moderation_records') {
      const response = await this.jsonRequest(profile.baseUrl, token, '/api/v1/moderation-records/purge', 'POST', { before: action.before });
      if (!response.ok || !response.body || typeof response.body !== 'object') throw new Error(readError(response.body, 'Could not purge Moderation Records.'));
      return { type: 'moderation_record', record: response.body as import('../shared/instance-actions').ModerationRecord };
    }
    if (action.type === 'moderate') {
      const response = await this.jsonRequest(profile.baseUrl, token, '/api/v1/moderation-actions', 'POST', { action: action.action, target_member_id: action.targetMemberId || '', target_message_id: action.targetMessageId || '', invitation_id: action.invitationId || '', reason: action.reason, duration_minutes: action.durationMinutes || 0 });
      if (!response.ok || !response.body || typeof response.body !== 'object') throw new Error(readError(response.body, 'Could not apply the moderation action.'));
      return { type: 'moderation_record', record: response.body as import('../shared/instance-actions').ModerationRecord };
    }
    if (action.type === 'export_account') {
      const response = await this.request(`${profile.baseUrl}/api/v1/account/export`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Could not export the Account.');
      return { type: 'asset', contentType: 'application/json', data: new Uint8Array(await response.arrayBuffer()) };
    }
    if (action.type === 'delete_account') {
      const response = await this.jsonRequest(profile.baseUrl, token, '/api/v1/account/delete', 'POST', { password: action.password, confirmation: action.confirmation });
      if (!response.ok) throw new Error(readError(response.body, 'Could not delete the Account.'));
      return { type: 'account_deleted' };
    }
    if (action.type === 'current_call') {
      const response = await this.request(`${profile.baseUrl}/api/v1/calls/current`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 204) return { type: 'call', call: null };
      const call = await response.json().catch(() => undefined);
      if (!response.ok || !isDirectCall(call)) throw new Error('Could not load the current Call.');
      return { type: 'call', call };
    }
    if (action.type === 'start_call') {
      const response = await this.request(`${profile.baseUrl}/api/v1/dms/${encodeURIComponent(action.directMessageId)}/calls`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const call = await response.json().catch(() => undefined);
      if (!response.ok || !isDirectCall(call)) throw new Error(readError(call, 'Could not start the Call.'));
      return { type: 'call', call };
    }
    if (action.type === 'call_action') {
      const response = await this.request(`${profile.baseUrl}/api/v1/calls/${encodeURIComponent(action.callId)}/${action.action}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const call = await response.json().catch(() => undefined);
      if (!response.ok || !isDirectCall(call)) throw new Error(readError(call, `Could not ${action.action} the Call.`));
      return { type: 'call', call };
    }
    if (action.type === 'turn_credentials') {
      const response = await this.request(`${profile.baseUrl}/api/v1/turn-credentials`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => undefined) as { ice_servers?: unknown } | undefined;
      if (!response.ok || !body || !Array.isArray(body.ice_servers)) throw new Error('TURN credentials unavailable.');
      return { type: 'turn_credentials', iceServers: body.ice_servers as RTCIceServer[] };
    }
    throw new Error('Unsupported Instance action.');
  }

  unwatch(instanceId: string, listener: (state: InstanceViewState) => void): void {
    const listeners = this.#listeners.get(instanceId);
    listeners?.delete(listener);
    if (!listeners?.size) {
      this.#listeners.delete(instanceId);
      this.#connections.get(instanceId)?.stop();
      this.#connections.delete(instanceId);
    }
  }

  private async startRealtime(instanceId: string): Promise<void> {
    const profile = this.registry.get(instanceId);
    if (!profile.credentialRef) return;
    const token = await this.vault.get(profile.credentialRef);
    if (!token) return;
    let state = this.#states.get(instanceId) || await this.load(instanceId);
    const connection = this.createRealtime({
      baseUrl: profile.baseUrl,
      token,
      cursor: state.cursor,
      onFrame: (frame) => {
        if (frame.type === 'snapshot_required') {
          void this.load(instanceId).then((snapshot) => this.publish(instanceId, snapshot));
          return;
        }
        const previous = this.#states.get(instanceId) || state;
        for (const message of createdMessages(frame)) this.onMessage?.(instanceId, message, previous);
        state = reduceRealtimeFrame(previous, frame);
        this.#states.set(instanceId, state);
        this.cache.put(instanceId, state);
        this.publish(instanceId, state);
      },
      onStatus: (status) => {
        if (status !== 'reconnecting') return;
        state = { ...(this.#states.get(instanceId) || state), connection: 'offline' };
        this.#states.set(instanceId, state);
        this.publish(instanceId, state);
      },
    });
    this.#connections.set(instanceId, connection);
    connection.start();
  }

  private async credential(reference: string | null): Promise<string> {
    if (!reference) throw new Error('Sign in to this Instance first.');
    const token = await this.vault.get(reference);
    if (!token) throw new Error('Desktop Device Session is unavailable. Sign in again.');
    return token;
  }

  private async jsonRequest(baseUrl: string, token: string, path: string, method: string, value: unknown): Promise<{ ok: boolean; body: unknown }> {
    const response = await this.request(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    return { ok: response.ok, body: await response.json().catch(() => undefined) };
  }

  private publish(instanceId: string, state: InstanceViewState): void {
    this.#listeners.get(instanceId)?.forEach((listener) => listener(state));
  }

  private storeAndPublish(instanceId: string, state: InstanceViewState): void {
    this.#states.set(instanceId, state);
    this.cache.put(instanceId, state);
    this.publish(instanceId, state);
  }
}

function createdMessages(frame: import('../shared/realtime-state').RealtimeFrame): import('../shared/instance-state').Message[] {
  const events = frame.type === 'events' ? frame.events || [] : [{ type: frame.type, payload: frame.payload }];
  return events.filter((event) => event.type === 'message.created' && isMessage(event.payload)).map((event) => event.payload as import('../shared/instance-state').Message);
}

function updateReaction(
  reactions: NonNullable<import('../shared/instance-state').Message['reactions']>,
  emoji: string,
  active: boolean,
) {
  const existing = reactions.find((reaction) => reaction.emoji === emoji);
  if (!existing) return active ? [...reactions, { emoji, count: 1, me: true }] : reactions;
  const count = Math.max(0, existing.count + (active && !existing.me ? 1 : !active && existing.me ? -1 : 0));
  return reactions.filter((reaction) => reaction.emoji !== emoji).concat(count ? [{ ...existing, count, me: active }] : []);
}

function readError(value: unknown, fallback: string): string {
  return value && typeof value === 'object' && 'error' in value && typeof (value as { error?: unknown }).error === 'string'
    ? (value as { error: string }).error
    : fallback;
}

function responseDiagnostic(response: Response, label: string): string {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0] || 'unknown content type';
  return `${label} returned HTTP ${response.status} (${contentType}).`;
}

function assetResult(asset: CachedAsset): InstanceActionResult {
  return {
    type: 'asset',
    contentType: asset.contentType,
    data: new Uint8Array(asset.data),
  };
}

function isMessage(value: unknown): value is import('../shared/instance-state').Message {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<import('../shared/instance-state').Message>;
  return typeof message.id === 'string' && typeof message.channel_id === 'string' &&
    typeof message.author_id === 'string' && typeof message.author_name === 'string' &&
    typeof message.sequence === 'number' && typeof message.created_at === 'string' &&
    typeof message.deleted === 'boolean';
}

function isMessagePage(value: unknown): value is import('../shared/instance-actions').MessagePage {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<import('../shared/instance-actions').MessagePage>;
  return Array.isArray(page.messages) && page.messages.every(isMessage) && typeof page.has_more === 'boolean' &&
    (typeof page.next_before === 'number' || typeof page.next_after === 'number');
}

function isAttachment(value: unknown): value is import('../shared/instance-state').Attachment {
  if (!value || typeof value !== 'object') return false;
  const attachment = value as Partial<import('../shared/instance-state').Attachment>;
  return typeof attachment.id === 'string' && typeof attachment.name === 'string' && typeof attachment.content_type === 'string' && typeof attachment.size === 'number';
}

function isSearchPage(value: unknown): value is { results: import('../shared/instance-state').SearchResult[]; next_cursor?: string } {
  return !!value && typeof value === 'object' && Array.isArray((value as { results?: unknown }).results);
}

function isLinkPreview(value: unknown): value is { url: string; site_name?: string; title?: string; description?: string; image_url?: string } {
  return !!value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string';
}

function isMember(value: unknown): value is import('../shared/desktop-bridge').MemberSummary {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' && typeof (value as { username?: unknown }).username === 'string' && typeof (value as { owner?: unknown }).owner === 'boolean';
}

function isDirectMessage(value: unknown): value is import('../shared/instance-state').DirectMessage {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' && isMember((value as { other?: unknown }).other);
}

function isDirectCall(value: unknown): value is import('../shared/instance-actions').DirectCall {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { direct_message_id?: unknown }).direct_message_id === 'string' &&
    typeof (value as { caller_id?: unknown }).caller_id === 'string' &&
    typeof (value as { recipient_id?: unknown }).recipient_id === 'string' &&
    typeof (value as { state?: unknown }).state === 'string';
}

function isAdminDashboard(value: unknown): value is import('../shared/instance-actions').AdminDashboard {
  if (!value || typeof value !== 'object') return false;
  const dashboard = value as Partial<import('../shared/instance-actions').AdminDashboard>;
  return typeof dashboard.checked_at === 'string' && typeof dashboard.uptime_seconds === 'number' &&
    !!dashboard.health && !!dashboard.counts && typeof dashboard.counts.members === 'number' &&
    !!dashboard.resources && Array.isArray(dashboard.storage_sources) && !!dashboard.message_rate &&
    typeof dashboard.message_rate.messages_per_minute === 'number' && Array.isArray(dashboard.message_rate.buckets);
}

function isCommunityRole(value: unknown): value is import('../shared/instance-actions').CommunityRole {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { name?: unknown }).name === 'string' && typeof (value as { position?: unknown }).position === 'number' &&
    Array.isArray((value as { permissions?: unknown }).permissions);
}

function isCommunityInvitation(value: unknown): value is import('../shared/instance-actions').CommunityInvitation {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { expires_at?: unknown }).expires_at === 'string' && typeof (value as { max_uses?: unknown }).max_uses === 'number' &&
    typeof (value as { use_count?: unknown }).use_count === 'number';
}

function isCategory(value: unknown): value is import('../shared/instance-state').Category {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { name?: unknown }).name === 'string' && typeof (value as { position?: unknown }).position === 'number';
}

function isChannel(value: unknown): value is import('../shared/instance-state').Channel {
  return isCategory(value) && typeof (value as { category_id?: unknown }).category_id === 'string' &&
    ((value as { type?: unknown }).type === 'text' || (value as { type?: unknown }).type === 'voice');
}

function isSoundboardSound(value: unknown): value is import('../shared/instance-actions').SoundboardSound {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { name?: unknown }).name === 'string' && typeof (value as { content_type?: unknown }).content_type === 'string' &&
    typeof (value as { size?: unknown }).size === 'number' && typeof (value as { duration_ms?: unknown }).duration_ms === 'number';
}

function isCommunitySettings(value: unknown): value is import('../shared/instance-actions').CommunitySettings {
  return !!value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string' && ((value as { avatar_url?: unknown }).avatar_url === undefined || typeof (value as { avatar_url?: unknown }).avatar_url === 'string') && typeof (value as { max_attachment_mib?: unknown }).max_attachment_mib === 'number' &&
    typeof (value as { home_markdown?: unknown }).home_markdown === 'string' && typeof (value as { push_relay_url?: unknown }).push_relay_url === 'string' &&
    typeof (value as { push_key_id?: unknown }).push_key_id === 'string' && typeof (value as { push_public_key?: unknown }).push_public_key === 'string';
}

function normalizeCommunitySettings(value: unknown): import('../shared/instance-actions').CommunitySettings | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const settings = value as Partial<import('../shared/instance-actions').CommunitySettings>;
  if (typeof settings.name !== 'string' || typeof settings.max_attachment_mib !== 'number' || typeof settings.home_markdown !== 'string' || typeof settings.push_relay_url !== 'string') return undefined;
  return {
    name: settings.name,
	...(typeof settings.avatar_url === 'string' ? { avatar_url: settings.avatar_url } : {}),
    max_attachment_mib: settings.max_attachment_mib,
    home_markdown: settings.home_markdown,
    push_relay_url: settings.push_relay_url,
    push_key_id: typeof settings.push_key_id === 'string' ? settings.push_key_id : '',
    push_public_key: typeof settings.push_public_key === 'string' ? settings.push_public_key : '',
  };
}

function isReport(value: unknown): value is import('../shared/instance-actions').Report {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' && typeof (value as { reason?: unknown }).reason === 'string' && typeof (value as { status?: unknown }).status === 'string';
}

function isInstanceViewState(value: unknown): value is InstanceViewState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<InstanceViewState>;
  return state.version === 1 && !!state.community && typeof state.community.name === 'string' &&
    !!state.member && typeof state.member.id === 'string' && typeof state.member.username === 'string' &&
    Array.isArray(state.members) && Array.isArray(state.categories) && Array.isArray(state.channels) &&
    Array.isArray(state.direct_messages) && !!state.messages && typeof state.messages === 'object' &&
    Array.isArray(state.channel_states) && !!state.presence && Array.isArray(state.typing) &&
    !!state.notifications && !!state.media && typeof state.cursor === 'number';
}

function normalizeMembers(state: InstanceViewState): InstanceViewState {
  return {
    ...state,
    connection: 'online',
    member: normalizeMember(state.member),
    members: state.members.map(normalizeMember),
    direct_messages: state.direct_messages.map((dm) => ({ ...dm, other: normalizeMember(dm.other) })),
  };
}

function normalizeMember(member: InstanceViewState['member']): InstanceViewState['member'] {
  const source = member as InstanceViewState['member'] & {
    display_name?: string;
    avatar_url?: string;
    banner_url?: string;
  };
  const { display_name: _displayName, avatar_url: _avatarUrl, banner_url: _bannerUrl, ...normalized } = source;
  return {
    ...normalized,
    ...(source.display_name ? { displayName: source.display_name } : {}),
    ...(source.avatar_url ? { avatarUrl: source.avatar_url } : {}),
    ...(source.banner_url ? { bannerUrl: source.banner_url } : {}),
	...(source.disabled ? { disabled: true } : {}),
  };
}
