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
    const response = await this.request(`${this.instanceURL}/api/v1/auth/native/login`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-AllChat-Device': deviceName},
      body: JSON.stringify({username, password}),
    });
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

  private async decode<T>(response: Response, fallback: string): Promise<T> {
    const body = await response.json().catch(() => ({})) as {error?: string};
    if (!response.ok) {
      throw new Error(body.error || fallback);
    }
    return body as T;
  }
}
