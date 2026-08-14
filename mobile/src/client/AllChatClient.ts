import type {Attachment, ChannelState, DirectMessage, Message, MessagePage, MobileBootstrap, NotificationSetting, SearchPage} from './bootstrap';

export type Member = {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  banner_url?: string;
  owner: boolean;
};

export type NativeSession = {
  member: Member;
  session_token: string;
  session_id: string;
  expires_at: string;
};

export type InstanceVersion = {version: string; build_id: string; apk_available: boolean};
export type MobilePushRegistration = {platform: 'android' | 'ios'; token: string; public_key: string; instance_url: string};

export type LocalAttachment = {uri: string; name: string; type: string; size?: number | null};
export type LinkPreview = {url: string; site_name?: string; title?: string; description?: string; image_url?: string};
export type Report = {id: string; reporter_id: string; target_member_id?: string; target_message_id?: string; reason: string; status: string; created_at: string; outcome?: string};
export type ModerationAction = 'warn' | 'timeout' | 'suspend' | 'kick';
export type DirectCall = {id: string; direct_message_id: string; caller_id: string; recipient_id: string; state: 'ringing' | 'accepted' | 'declined' | 'ended' | string; created_at: string; expires_at?: string; finished_at?: string};
export type SoundboardSound = {id: string; name: string; emoji?: string; content_type: string; size: number; duration_ms: number; position: number; audio_url: string};
export type VoiceRoomParticipant = {member_id: string; connected: boolean; muted?: boolean; server_muted?: boolean; speaking?: boolean; screen_sharing?: boolean};
export type VoiceRoomState = {participants: VoiceRoomParticipant[]; names: Record<string, string>; members: Record<string, Member>};

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
    const response = await this.request(`${this.instanceURL}/api/v1/mobile/bootstrap?history=none`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    const bootstrap = await this.decode<MobileBootstrap>(response, 'Could not synchronize the Instance.');
    if (bootstrap.version !== 1) {
      throw new Error(`Unsupported mobile protocol version: ${bootstrap.version}`);
    }
    return bootstrap;
  }

  async instanceVersion(): Promise<InstanceVersion> {
    const response = await this.request(`${this.instanceURL}/api/v1/version`);
    return this.decode<InstanceVersion>(response, 'Could not check for updates.');
  }

  async listMessages(token: string, conversationID: string, direct = false, before = 0, limit = 50): Promise<MessagePage> {
    const query = new URLSearchParams({limit: String(limit)});
    if (before > 0) query.set('before', String(before));
    const response = await this.request(`${this.instanceURL}/api/v1/${direct ? 'dms' : 'channels'}/${encodeURIComponent(conversationID)}/messages?${query}`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    return this.decode<MessagePage>(response, 'Could not load Messages.');
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

  async updateAvatar(token: string, file: LocalAttachment): Promise<void> {
    let content: Blob;
    try { content = await (await this.readLocalFile(file.uri)).blob(); }
    catch { throw new Error(`Could not read ${file.name} from this device.`); }
    await this.ensureOK(await this.request(`${this.instanceURL}/api/v1/profile/avatar`, {
      method: 'PUT', headers: {Authorization: `Bearer ${token}`, 'Content-Type': file.type || 'application/octet-stream'}, body: content,
    }), 'Could not update your avatar.');
  }

  async removeAvatar(token: string): Promise<void> {
    await this.ensureOK(await this.request(`${this.instanceURL}/api/v1/profile/avatar`, {
      method: 'DELETE', headers: {Authorization: `Bearer ${token}`},
    }), 'Could not remove your avatar.');
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

  async reports(token: string): Promise<Report[]> {
    const response = await this.request(`${this.instanceURL}/api/v1/reports`, {headers: {Authorization: `Bearer ${token}`}});
    return (await this.decode<{reports: Report[]}>(response, 'Could not load reports.')).reports;
  }

  async resolveReport(token: string, reportID: string, outcome: string): Promise<Report> {
    const response = await this.request(`${this.instanceURL}/api/v1/reports/${encodeURIComponent(reportID)}/resolve`, {
      method: 'POST', headers: this.jsonHeaders(token), body: JSON.stringify({outcome}),
    });
    return this.decode<Report>(response, 'Could not resolve the report.');
  }

  async moderateMember(token: string, memberID: string, action: ModerationAction, reason: string, durationMinutes = 0): Promise<void> {
    const response = await this.request(`${this.instanceURL}/api/v1/moderation-actions`, {
      method: 'POST', headers: this.jsonHeaders(token),
      body: JSON.stringify({action, target_member_id: memberID, reason, ...(durationMinutes ? {duration_minutes: durationMinutes} : {})}),
    });
    await this.decode<unknown>(response, 'Could not apply the moderation action.');
  }

  async setPresenceMode(token: string, mode: 'available' | 'dnd'): Promise<void> {
    const response = await this.request(`${this.instanceURL}/api/v1/presence-mode`, {
      method: 'PUT', headers: this.jsonHeaders(token), body: JSON.stringify({mode}),
    });
    await this.decode<{mode: string}>(response, 'Could not update your presence.');
  }

  async updateNotificationSettings(token: string, setting: NotificationSetting): Promise<void> {
    await this.ensureOK(await this.request(`${this.instanceURL}/api/v1/notification-settings`, {method: 'PUT', headers: this.jsonHeaders(token), body: JSON.stringify(setting)}), 'Could not update notification settings.');
  }

  async updateChannelNotificationSettings(token: string, channelID: string, setting: NotificationSetting): Promise<void> {
    await this.ensureOK(await this.request(`${this.instanceURL}/api/v1/channels/${encodeURIComponent(channelID)}/notification-settings`, {method: 'PUT', headers: this.jsonHeaders(token), body: JSON.stringify(setting)}), 'Could not update Channel notification settings.');
  }

  async registerMobilePush(token: string, registration: MobilePushRegistration): Promise<void> {
    await this.ensureOK(await this.request(`${this.instanceURL}/api/v1/mobile-push/subscription`, {
      method: 'PUT', headers: this.jsonHeaders(token), body: JSON.stringify(registration),
    }), 'Could not enable mobile push notifications.');
  }

  async unregisterMobilePush(token: string, deviceToken: string): Promise<void> {
    await this.ensureOK(await this.request(`${this.instanceURL}/api/v1/mobile-push/subscription`, {
      method: 'DELETE', headers: this.jsonHeaders(token), body: JSON.stringify({token: deviceToken}),
    }), 'Could not disable mobile push notifications.');
  }

  async linkPreview(token: string, url: string): Promise<LinkPreview> {
    const response = await this.request(`${this.instanceURL}/api/v1/link-preview?url=${encodeURIComponent(url)}`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    return this.decode<LinkPreview>(response, 'Link preview unavailable.');
  }

  async currentCall(token: string): Promise<DirectCall | undefined> {
    const response = await this.request(`${this.instanceURL}/api/v1/calls/current`, {headers: {Authorization: `Bearer ${token}`}});
    if (response.status === 204) return undefined;
    return this.decode<DirectCall>(response, 'Could not load the current Call.');
  }

  async voiceRoomParticipants(token: string, channelID: string): Promise<VoiceRoomState> {
    const response = await this.request(`${this.instanceURL}/api/v1/voice/${encodeURIComponent(channelID)}/participants`, {headers: {Authorization: `Bearer ${token}`}});
    return this.decode<VoiceRoomState>(response, 'Could not load Voice Room participants.');
  }

  async startCall(token: string, directMessageID: string): Promise<DirectCall> {
    const response = await this.request(`${this.instanceURL}/api/v1/dms/${encodeURIComponent(directMessageID)}/calls`, {method: 'POST', headers: {Authorization: `Bearer ${token}`}});
    return this.decode<DirectCall>(response, 'Could not start the Call.');
  }

  async callAction(token: string, callID: string, action: 'accept' | 'decline' | 'end'): Promise<DirectCall> {
    const response = await this.request(`${this.instanceURL}/api/v1/calls/${encodeURIComponent(callID)}/${action}`, {method: 'POST', headers: {Authorization: `Bearer ${token}`}});
    return this.decode<DirectCall>(response, `Could not ${action} the Call.`);
  }

  async soundboard(token: string): Promise<SoundboardSound[]> {
    const response = await this.request(`${this.instanceURL}/api/v1/soundboard`, {headers: {Authorization: `Bearer ${token}`}});
    return (await this.decode<{sounds: SoundboardSound[]}>(response, 'Could not load the soundboard.')).sounds;
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
