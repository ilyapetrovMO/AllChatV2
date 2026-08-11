import type {MobileBootstrap} from './bootstrap';

export type Member = {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  owner: boolean;
};

export type NativeSession = {
  member: Member;
  session_token: string;
  session_id: string;
  expires_at: string;
};

type Fetch = typeof fetch;

export class AllChatClient {
  constructor(private readonly instanceURL: string, private readonly request: Fetch = fetch) {}

  async login(username: string, password: string, deviceName: string): Promise<NativeSession> {
    let response: Response;
    try {
      response = await this.request(`${this.instanceURL}/api/v1/auth/native/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-AllChat-Device': deviceName},
        body: JSON.stringify({username, password}),
      });
    } catch {
      throw new Error('Could not reach the Instance. Check its address, HTTPS certificate, and your connection.');
    }
    return this.decode<NativeSession>(response, 'Could not sign in.');
  }

  async currentSession(token: string): Promise<Member> {
    const response = await this.request(`${this.instanceURL}/api/v1/session`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    return this.decode<Member>(response, 'Session is no longer valid.');
  }

  async logout(token: string): Promise<void> {
    const response = await this.request(`${this.instanceURL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${token}`},
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as {error?: string};
      throw new Error(body.error || 'Could not revoke Session.');
    }
  }

  async bootstrap(token: string): Promise<MobileBootstrap> {
    const response = await this.request(`${this.instanceURL}/api/v1/mobile/bootstrap`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    const bootstrap = await this.decode<MobileBootstrap>(response, 'Could not synchronize the Instance.');
    if (bootstrap.version !== 1) {
      throw new Error(`Unsupported mobile protocol version: ${bootstrap.version}`);
    }
    return bootstrap;
  }

  private async decode<T>(response: Response, fallback: string): Promise<T> {
    const raw = await response.text().catch(() => '');
    let body: {error?: string} | undefined;
    try {
      body = JSON.parse(raw) as {error?: string};
    } catch {
      body = undefined;
    }
    if (!response.ok) {
      if (body?.error) {
        throw new Error(body.error);
      }
      const detail = readableResponse(raw);
      throw new Error(`${fallback} (HTTP ${response.status}${detail ? `: ${detail}` : ''})`);
    }
    if (!body) {
      throw new Error(`${fallback} (HTTP ${response.status}: the Instance returned an invalid response.)`);
    }
    return body as T;
  }
}

function readableResponse(raw: string): string {
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}
