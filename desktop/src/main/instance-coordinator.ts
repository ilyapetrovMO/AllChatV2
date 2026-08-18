import type { InstanceViewState } from '../shared/instance-state';
import type { DesktopCredentialVault } from './desktop-credential-vault';
import type { InstanceRegistry } from './instance-registry';
import { MemoryInstanceStateCache, type InstanceStateCache } from './instance-state-cache';
import { RealtimeConnection } from './realtime-connection';
import { reduceRealtimeFrame } from '../shared/realtime-state';
import type { InstanceAction, InstanceActionResult } from '../shared/instance-actions';

export class InstanceCoordinator {
  readonly #states = new Map<string, InstanceViewState>();
  readonly #listeners = new Map<string, Set<(state: InstanceViewState) => void>>();
  readonly #connections = new Map<string, RealtimeConnection>();
  constructor(
    private readonly registry: InstanceRegistry,
    private readonly vault: DesktopCredentialVault,
    private readonly request: typeof fetch = fetch,
    private readonly cache: InstanceStateCache = new MemoryInstanceStateCache(),
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
    if (!isInstanceViewState(body)) throw new Error('Instance returned an unsupported bootstrap contract.');
    const state = normalizeMembers(body);
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
    if (action.type === 'load_messages') {
      const query = new URLSearchParams({ limit: String(action.limit || 50) });
      if (action.before) query.set('before', String(action.before));
      const kind = action.direct ? 'dms' : 'channels';
      const response = await this.request(`${profile.baseUrl}/api/v1/${kind}/${encodeURIComponent(action.conversationId)}/messages?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok || !isMessagePage(body)) throw new Error(readError(body, 'Could not load Messages.'));
      return { type: 'messages', page: body };
    }
    if (action.type === 'send_message') {
      const kind = action.direct ? 'dms' : 'channels';
      const response = await this.request(
        `${profile.baseUrl}/api/v1/${kind}/${encodeURIComponent(action.conversationId)}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: action.body }),
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
    const connection = new RealtimeConnection({
      baseUrl: profile.baseUrl,
      token,
      cursor: state.cursor,
      onFrame: (frame) => {
        if (frame.type === 'snapshot_required') {
          void this.load(instanceId).then((snapshot) => this.publish(instanceId, snapshot));
          return;
        }
        state = reduceRealtimeFrame(state, frame);
        this.#states.set(instanceId, state);
        this.cache.put(instanceId, state);
        this.publish(instanceId, state);
      },
      onStatus: (status) => {
        if (status !== 'reconnecting') return;
        state = { ...state, connection: 'offline' };
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

  private publish(instanceId: string, state: InstanceViewState): void {
    this.#listeners.get(instanceId)?.forEach((listener) => listener(state));
  }
}

function readError(value: unknown, fallback: string): string {
  return value && typeof value === 'object' && 'error' in value && typeof (value as { error?: unknown }).error === 'string'
    ? (value as { error: string }).error
    : fallback;
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
  return Array.isArray(page.messages) && page.messages.every(isMessage) && typeof page.has_more === 'boolean' && typeof page.next_before === 'number';
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
  };
  return {
    ...source,
    ...(source.display_name ? { displayName: source.display_name } : {}),
    ...(source.avatar_url ? { avatarUrl: source.avatar_url } : {}),
  };
}
