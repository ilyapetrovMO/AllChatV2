import type {Attachment, ChannelState, DirectMessage, Message, MobileBootstrap, SearchPage} from './bootstrap';

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

export type LocalAttachment = {uri: string; name: string; type: string; size?: number | null};

type Fetch = typeof fetch;

export class AllChatClient {
  constructor(private readonly instanceURL: string, private readonly request: Fetch = fetch, private readonly readLocalFile: Fetch = fetch) {}

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

  async publishMessage(token: string, conversationID: string, body: string, direct = false, attachmentIDs: string[] = [], replyTo = ''): Promise<Message> {
    const response = await this.request(`${this.instanceURL}/api/v1/${direct ? 'dms' : 'channels'}/${encodeURIComponent(conversationID)}/messages`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({body, ...(attachmentIDs.length ? {attachment_ids: attachmentIDs} : {}), ...(replyTo ? {reply_to: replyTo} : {})}),
    });
    return this.decode<Message>(response, 'Could not send the Message.');
  }

  async editMessage(token: string, messageID: string, body: string): Promise<Message> {
    const response = await this.request(`${this.instanceURL}/api/v1/messages/${encodeURIComponent(messageID)}`, {
      method: 'PATCH', headers: this.jsonHeaders(token), body: JSON.stringify({body}),
    });
    return this.decode<Message>(response, 'Could not edit the Message.');
  }

  async deleteMessage(token: string, messageID: string): Promise<void> {
    await this.ensureOK(await this.request(`${this.instanceURL}/api/v1/messages/${encodeURIComponent(messageID)}`, {
      method: 'DELETE', headers: {Authorization: `Bearer ${token}`},
    }), 'Could not delete the Message.');
  }

  async setReaction(token: string, messageID: string, emoji: string, active: boolean): Promise<void> {
    await this.ensureOK(await this.request(`${this.instanceURL}/api/v1/messages/${encodeURIComponent(messageID)}/reactions`, {
      method: active ? 'PUT' : 'DELETE', headers: this.jsonHeaders(token), body: JSON.stringify({emoji}),
    }), 'Could not update the reaction.');
  }

  async setPinned(token: string, messageID: string, pinned: boolean): Promise<void> {
    await this.ensureOK(await this.request(`${this.instanceURL}/api/v1/messages/${encodeURIComponent(messageID)}/pin`, {
      method: pinned ? 'PUT' : 'DELETE', headers: {Authorization: `Bearer ${token}`},
    }), 'Could not update the pin.');
  }

  async pinnedMessages(token: string, channelID: string): Promise<Message[]> {
    const response = await this.request(`${this.instanceURL}/api/v1/channels/${encodeURIComponent(channelID)}/pins`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    return (await this.decode<{messages: Message[]}>(response, 'Could not load pinned Messages.')).messages;
  }

  async searchMessages(token: string, query: string, cursor = '', limit = 25): Promise<SearchPage> {
    const parameters = new URLSearchParams({q: query, limit: String(limit)});
    if (cursor) parameters.set('cursor', cursor);
    const response = await this.request(`${this.instanceURL}/api/v1/search?${parameters.toString()}`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    return this.decode<SearchPage>(response, 'Could not search Messages.');
  }

  async memberProfile(token: string, memberID: string): Promise<Member> {
    const response = await this.request(`${this.instanceURL}/api/v1/members/${encodeURIComponent(memberID)}`, {headers: {Authorization: `Bearer ${token}`}});
    return this.decode<Member>(response, 'Could not load the Member profile.');
  }

  async updateProfile(token: string, username: string, displayName: string): Promise<Member> {
    const response = await this.request(`${this.instanceURL}/api/v1/profile`, {
      method: 'PATCH', headers: this.jsonHeaders(token), body: JSON.stringify({username, display_name: displayName}),
    });
    return this.decode<Member>(response, 'Could not update your profile.');
  }

  async openDirectMessage(token: string, memberID: string): Promise<DirectMessage> {
    const response = await this.request(`${this.instanceURL}/api/v1/dms`, {
      method: 'POST', headers: this.jsonHeaders(token), body: JSON.stringify({member_id: memberID}),
    });
    return this.decode<DirectMessage>(response, 'Could not open the Direct Message.');
  }

  async setBlock(token: string, memberID: string, blocked: boolean): Promise<void> {
    await this.ensureOK(await this.request(`${this.instanceURL}/api/v1/blocks/${encodeURIComponent(memberID)}`, {
      method: blocked ? 'PUT' : 'DELETE', headers: {Authorization: `Bearer ${token}`},
    }), blocked ? 'Could not block the Member.' : 'Could not unblock the Member.');
  }

  async reportMember(token: string, memberID: string, reason: string): Promise<void> {
    const response = await this.request(`${this.instanceURL}/api/v1/reports`, {
      method: 'POST', headers: this.jsonHeaders(token), body: JSON.stringify({target_member_id: memberID, reason}),
    });
    await this.decode<unknown>(response, 'Could not submit the report.');
  }

  async setPresenceMode(token: string, mode: 'available' | 'dnd'): Promise<void> {
    const response = await this.request(`${this.instanceURL}/api/v1/presence-mode`, {
      method: 'PUT', headers: this.jsonHeaders(token), body: JSON.stringify({mode}),
    });
    await this.decode<{mode: string}>(response, 'Could not update your presence.');
  }

  async uploadAttachment(token: string, file: LocalAttachment): Promise<Attachment> {
    let content: Blob;
    try {
      const local = await this.readLocalFile(file.uri);
      content = await local.blob();
    } catch {
      throw new Error(`Could not read ${file.name} from this device.`);
    }
    const response = await this.request(`${this.instanceURL}/api/v1/attachments?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': file.type || 'application/octet-stream'},
      body: content,
    });
    return this.decode<Attachment>(response, `Could not upload ${file.name}.`);
  }

  async updateReadPosition(token: string, conversationID: string, sequence: number, direct = false): Promise<ChannelState> {
    const response = await this.request(`${this.instanceURL}/api/v1/${direct ? 'dms' : 'channels'}/${encodeURIComponent(conversationID)}/read-position`, {
      method: 'PUT',
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({sequence}),
    });
    return this.decode<ChannelState>(response, 'Could not update the read position.');
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

  private jsonHeaders(token: string) {
    return {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'};
  }

  private async ensureOK(response: Response, fallback: string): Promise<void> {
    if (response.ok) return;
    const raw = await response.text().catch(() => '');
    let error = '';
    try { error = (JSON.parse(raw) as {error?: string}).error || ''; } catch {}
    throw new Error(error || `${fallback} (HTTP ${response.status}${readableResponse(raw) ? `: ${readableResponse(raw)}` : ''})`);
  }
}

function readableResponse(raw: string): string {
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}
