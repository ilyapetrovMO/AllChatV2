import type {
  DesktopSessionSummary,
  LoginInstanceInput,
  RecoverInstanceInput,
  RegisterInstanceInput,
  MemberSummary,
  ShellState,
} from '../shared/desktop-bridge';
import type { DesktopCredentialVault } from './desktop-credential-vault';
import type { InstanceRegistry } from './instance-registry';

interface NativeSessionResponse {
  member: {
    id: string;
    username: string;
    display_name?: string;
    avatar_url?: string;
    owner: boolean;
  };
  session_token: string;
  session_id: string;
  expires_at: string;
}

const SUPPORTED_INSTANCE_PROTOCOL = 1;

export class DesktopAccountManager {
  constructor(
    private readonly registry: InstanceRegistry,
    private readonly vault: DesktopCredentialVault,
    private readonly request: typeof fetch = fetch,
  ) {}

  async login(input: LoginInstanceInput): Promise<ShellState> {
    return this.authenticate(input.instanceId, '/api/v1/auth/native/login', { username: input.username, password: input.password });
  }

  async register(input: RegisterInstanceInput): Promise<ShellState> {
    return this.authenticate(input.instanceId, '/api/v1/auth/native/register', { token: input.invitationToken, username: input.username, password: input.password });
  }

  async recover(input: RecoverInstanceInput): Promise<ShellState> {
    const profile = this.registry.get(input.instanceId);
    let response: Response;
    try {
      response = await this.request(`${profile.baseUrl}/api/v1/auth/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: input.recoveryToken, password: input.password }),
      });
    } catch {
      throw new Error('Could not reach the Instance. Check its address and HTTPS certificate.');
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      throw new Error(body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : 'Could not recover the Account.');
    }
    return this.registry.state();
  }

  private async authenticate(instanceId: string, path: string, body: unknown): Promise<ShellState> {
    const profile = this.registry.get(instanceId);
    let response: Response;
    try {
      response = await this.request(`${profile.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AllChat-Device': 'AllChat Desktop' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Could not reach the Instance. Check its address and HTTPS certificate.');
    }
    const session = await decodeNativeSession(response);
    await this.assertCompatible(profile.baseUrl, session.session_token);
    const credentialRef = `desktop-session:${profile.id}`;
    await this.vault.put(credentialRef, session.session_token);
    this.registry.setSession(profile.id, credentialRef, toSummary(session));
    return this.registry.state();
  }

  private async assertCompatible(baseUrl: string, token: string): Promise<void> {
    let response: Response;
    try {
      response = await this.request(`${baseUrl}/api/v1/mobile/bootstrap?history=none`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new Error('Could not verify Instance compatibility. Check its connection and try again.');
    }
    const body: unknown = await response.json().catch(() => undefined);
    const version = body && typeof body === 'object' ? (body as { version?: unknown }).version : undefined;
    if (!response.ok || version !== SUPPORTED_INSTANCE_PROTOCOL) {
      await this.request(`${baseUrl}/api/v1/auth/logout`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
      const found = typeof version === 'number' ? `version ${version}` : 'an unknown version';
      throw new Error(`Incompatible Instance protocol: ${found}. This desktop app supports version ${SUPPORTED_INSTANCE_PROTOCOL}.`);
    }
  }

  async logout(instanceId: string): Promise<ShellState> {
    const profile = this.registry.get(instanceId);
    const reference = profile.credentialRef;
    if (reference) {
      const token = await this.vault.get(reference);
      if (token) {
        await this.request(`${profile.baseUrl}/api/v1/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => undefined);
      }
      await this.vault.remove(reference);
    }
    this.registry.clearSession(instanceId);
    return this.registry.state();
  }

  async validateStoredSessions(): Promise<ShellState> {
    await Promise.all(this.registry.list().map(async (profile) => {
      if (!profile.credentialRef || !profile.session) return;
      const token = await this.vault.get(profile.credentialRef);
      if (!token) {
        this.registry.clearSession(profile.id);
        return;
      }
      let response: Response;
      try {
        response = await this.request(`${profile.baseUrl}/api/v1/session`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        return;
      }
      if (response.status === 401 || response.status === 403) {
        await this.vault.remove(profile.credentialRef);
        this.registry.clearSession(profile.id);
      }
    }));
    return this.registry.state();
  }
}

async function decodeNativeSession(response: Response): Promise<NativeSessionResponse> {
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body &&
      typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : 'Could not sign in.';
    throw new Error(message);
  }
  if (!isNativeSession(body)) throw new Error('Instance returned an invalid native Session.');
  return body;
}

function isNativeSession(value: unknown): value is NativeSessionResponse {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<NativeSessionResponse>;
  return typeof session.session_token === 'string' && session.session_token.length > 0 &&
    typeof session.session_id === 'string' && typeof session.expires_at === 'string' &&
    !!session.member && typeof session.member.id === 'string' &&
    typeof session.member.username === 'string' && typeof session.member.owner === 'boolean';
}

function toSummary(session: NativeSessionResponse): DesktopSessionSummary {
  const member: MemberSummary = {
    id: session.member.id,
    username: session.member.username,
    ...(session.member.display_name ? { displayName: session.member.display_name } : {}),
    ...(session.member.avatar_url ? { avatarUrl: session.member.avatar_url } : {}),
    owner: session.member.owner,
  };
  return { member, sessionId: session.session_id, expiresAt: session.expires_at };
}
