import { randomUUID } from 'node:crypto';

import type {
  AddInstanceInput,
  DesktopSessionSummary,
  InstanceProfile,
  ShellState,
} from '../shared/desktop-bridge';
import {
  MemoryInstanceProfileStore,
  type InstanceProfileStore,
} from './instance-profile-store';

const FORBIDDEN_CREDENTIAL_FIELDS = ['token', 'password', 'secret', 'credential'];

export class InstanceRegistry {
  readonly #profiles = new Map<string, InstanceProfile>();
  #activeInstanceId: string | null = null;

  constructor(
    private readonly createId: () => string = randomUUID,
    private readonly store: InstanceProfileStore = new MemoryInstanceProfileStore(),
  ) {
    const state = store.load();
    state.instances.forEach((profile) => this.#profiles.set(profile.id, Object.freeze(profile)));
    this.#activeInstanceId = state.activeInstanceId;
  }

  add(input: AddInstanceInput): InstanceProfile {
    const record = input as unknown as Record<string, unknown>;
    if (Object.keys(record).some((key) => FORBIDDEN_CREDENTIAL_FIELDS.includes(key.toLowerCase()))) {
      throw new Error('Raw credentials are forbidden in an Instance Profile');
    }

    const baseUrl = normalizeInstanceUrl(input.baseUrl);
    const id = this.createId();
    const profile: InstanceProfile = Object.freeze({
      id,
      displayName: input.displayName.trim() || new URL(baseUrl).host,
      baseUrl,
      partition: `persist:allchat-${id}`,
      credentialRef: null,
    });
    this.#profiles.set(id, profile);
    this.#activeInstanceId ??= id;
    this.persist();
    return profile;
  }

  list(): InstanceProfile[] {
    return [...this.#profiles.values()];
  }

  get(id: string): InstanceProfile {
    const profile = this.#profiles.get(id);
    if (!profile) throw new Error('Unknown Instance Profile');
    return profile;
  }

  select(id: string): void {
    if (!this.#profiles.has(id)) throw new Error('Unknown Instance Profile');
    this.#activeInstanceId = id;
    this.persist();
  }

  updateCommunityIdentity(id: string, displayName: string, avatarUrl?: string): void {
    const profile = this.get(id);
    const normalized = displayName.trim();
	if (!normalized || (normalized === profile.displayName && avatarUrl === profile.avatarUrl)) return;
	this.#profiles.set(id, Object.freeze({ ...profile, displayName: normalized, ...(avatarUrl ? { avatarUrl } : { avatarUrl: undefined }) }));
    this.persist();
  }

  setSession(id: string, credentialRef: string, session: DesktopSessionSummary): void {
    const profile = this.get(id);
    this.#profiles.set(id, Object.freeze({ ...profile, credentialRef, session }));
    this.persist();
  }

  clearSession(id: string): void {
    const profile = this.get(id);
    const { session: _session, ...withoutSession } = profile;
    this.#profiles.set(id, Object.freeze({ ...withoutSession, credentialRef: null }));
    this.persist();
  }

  state(): ShellState {
    return { instances: this.list(), activeInstanceId: this.#activeInstanceId };
  }

  private persist(): void {
    this.store.save(this.state());
  }
}

function normalizeInstanceUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new Error('An Instance must use HTTPS outside local development');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
