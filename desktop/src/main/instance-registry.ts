import { randomUUID } from 'node:crypto';

import type { AddInstanceInput, InstanceProfile, ShellState } from '../shared/desktop-bridge';

const FORBIDDEN_CREDENTIAL_FIELDS = ['token', 'password', 'secret', 'credential'];

export class InstanceRegistry {
  readonly #profiles = new Map<string, InstanceProfile>();
  #activeInstanceId: string | null = null;

  constructor(private readonly createId: () => string = randomUUID) {}

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
    return profile;
  }

  list(): InstanceProfile[] {
    return [...this.#profiles.values()];
  }

  select(id: string): void {
    if (!this.#profiles.has(id)) throw new Error('Unknown Instance Profile');
    this.#activeInstanceId = id;
  }

  state(): ShellState {
    return { instances: this.list(), activeInstanceId: this.#activeInstanceId };
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
