import { FormEvent, useEffect, useRef, useState } from 'react';

import type { DesktopBridge, ShellState } from '../shared/desktop-bridge';
import type { Attachment, InstanceViewState } from '../shared/instance-state';
import type { InstanceAction, InstanceActionResult } from '../shared/instance-actions';

export function App({ bridge }: { bridge: DesktopBridge }) {
  const [state, setState] = useState<ShellState | null>(null);
  const [error, setError] = useState('');
  const [instanceState, setInstanceState] = useState<InstanceViewState | null>(null);

  useEffect(() => {
    void bridge.getShellState().then(setState);
  }, [bridge]);

  const active = state?.instances.find(({ id }) => id === state.activeInstanceId);

  useEffect(() => {
    setInstanceState(null);
    if (!active?.session) return;
    let current = true;
    void bridge.loadInstance(active.id).then((value) => {
      if (current) setInstanceState(value);
    }).catch((cause) => {
      if (current) setError(cause instanceof Error ? cause.message : 'Could not synchronize the Instance.');
    });
    return () => { current = false; };
  }, [active?.id, active?.session?.sessionId, bridge]);

  useEffect(() => {
    if (!active?.session || !instanceState) return;
    return bridge.watchInstance(active.id, setInstanceState);
  }, [active?.id, active?.session?.sessionId, bridge, !!instanceState]);

  async function addInstance(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      setState(await bridge.addInstance({
        displayName: String(values.get('displayName') ?? ''),
        baseUrl: String(values.get('baseUrl') ?? ''),
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the Instance.');
    }
  }

  async function login(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!active) return;
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      setState(await bridge.loginInstance({
        instanceId: active.id,
        username: String(values.get('username') ?? ''),
        password: String(values.get('password') ?? ''),
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.');
    }
  }

  async function executeAction(action: InstanceAction): Promise<InstanceActionResult | undefined> {
    if (!active) return undefined;
    const result = await bridge.executeInstance(active.id, action);
    if (result.type === 'message') {
      setInstanceState((current) => current ? {
        ...current,
        messages: {
          ...current.messages,
          [result.message.channel_id]: mergeMessage(current.messages[result.message.channel_id] || [], result.message),
        },
      } : current);
    } else if (result.type === 'messages') {
      setInstanceState((current) => current ? {
        ...current,
        messages: {
          ...current.messages,
          [result.conversationId]: mergeMessages(
            current.messages[result.conversationId] || [],
            result.page.messages,
          ),
        },
      } : current);
    } else if (result.type === 'deleted_message') {
      setInstanceState((current) => current ? {
        ...current,
        messages: {
          ...current.messages,
          [result.conversationId]: (current.messages[result.conversationId] || []).map((message) =>
            message.id === result.messageId ? { ...message, deleted: true } : message),
        },
      } : current);
    } else if (result.type === 'read_position') {
      setInstanceState((current) => current ? {
        ...current,
        channel_states: current.channel_states.map((channel) => channel.channel_id === result.conversationId
          ? { ...channel, read_sequence: result.sequence, unread: 0 }
          : channel),
      } : current);
    }
    return result;
  }

  return (
    <main className="shell">
      <aside className="instance-rail" aria-label="Instances">
        <div className="brand-mark" aria-label="AllChat">A</div>
        {state?.instances.map((instance) => (
          <button
            className="instance-button"
            key={instance.id}
            onClick={() => void bridge.selectInstance(instance.id).then(setState)}
            aria-label={instance.displayName}
          >
            {instance.displayName.slice(0, 1).toUpperCase()}
          </button>
        ))}
      </aside>
      <section className="content">
        {!state ? (
          <p>Starting AllChat…</p>
        ) : state.instances.length === 0 ? (
          <div className="empty-state">
            <p className="eyebrow">Desktop Canary</p>
            <h1>Add your first Instance</h1>
            <p>Connect an AllChat Community to start messaging from the desktop client.</p>
            <form className="onboarding-form" onSubmit={(event) => void addInstance(event)}>
              <label>Instance name<input name="displayName" placeholder="Home" required /></label>
              <label>Instance address<input name="baseUrl" type="url" placeholder="https://chat.example" required /></label>
              <button type="submit">Add Instance</button>
            </form>
            {error && <p role="alert">{error}</p>}
          </div>
        ) : active && !active.session ? (
          <div className="empty-state">
            <p className="eyebrow">{active.displayName}</p>
            <h1>Sign in to your Community</h1>
            <p>{active.baseUrl}</p>
            <form className="onboarding-form" onSubmit={(event) => void login(event)}>
              <label>Username<input name="username" autoComplete="username" required /></label>
              <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
              <button type="submit">Sign in</button>
            </form>
            {error && <p role="alert">{error}</p>}
          </div>
        ) : instanceState ? (
          <CommunityShell instanceId={active!.id} state={instanceState} onAction={executeAction} />
        ) : (
          <div className="empty-state"><p>Synchronizing {active?.displayName}…</p>{error && <p role="alert">{error}</p>}</div>
        )}
      </section>
    </main>
  );
}

function CommunityShell({ instanceId, state, onAction }: { instanceId: string; state: InstanceViewState; onAction(action: InstanceAction): Promise<InstanceActionResult | undefined> }) {
  const [conversation, setConversation] = useState<{ id: string; name: string; type: 'text' | 'voice' | 'dm' } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [searchResults, setSearchResults] = useState<import('../shared/instance-state').SearchResult[] | null>(null);
  const [showPins, setShowPins] = useState(false);
  const lastTypingAt = useRef(0);
  const categories = [...state.categories].filter(({ archived }) => !archived).sort(byPosition);
  const channels = [...state.channels].filter(({ archived }) => !archived);
  useEffect(() => {
    setDraft(conversation ? localStorage.getItem(draftKey(instanceId, conversation.id)) || '' : '');
    setEditingMessageId(null);
    if (conversation && conversation.type !== 'voice') {
      const messages = state.messages[conversation.id] || [];
      const last = messages.at(-1);
      if (last) void onAction({ type: 'update_read_position', conversationId: conversation.id, direct: conversation.type === 'dm', sequence: last.sequence });
    }
  }, [conversation?.id, instanceId]);

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!conversation || conversation.type === 'voice' || (!draft.trim() && attachments.length === 0)) return;
    const body = draft;
    const attachmentIds: string[] = [];
    for (const file of attachments) {
      const result = await onAction({ type: 'upload_attachment', name: file.name, contentType: file.type || 'application/octet-stream', data: new Uint8Array(await file.arrayBuffer()) });
      if (result?.type === 'attachment') attachmentIds.push(result.attachment.id);
    }
    await onAction(editingMessageId
      ? { type: 'edit_message', messageId: editingMessageId, body }
      : { type: 'send_message', conversationId: conversation.id, direct: conversation.type === 'dm', body, attachmentIds, ...(replyTo ? { replyTo } : {}) });
    setDraft('');
    setEditingMessageId(null);
    setReplyTo(null);
    setAttachments([]);
    localStorage.removeItem(draftKey(instanceId, conversation.id));
  }
  return (
    <div className="community-shell">
      <aside className="conversation-sidebar">
        <header className="community-header"><strong>{state.community.name}</strong></header>
        <nav className="conversation-nav" aria-label="Community conversations">
          {state.direct_messages.length > 0 && <h2>Direct Messages</h2>}
          {state.direct_messages.map((dm) => (
            <button type="button" key={dm.id} aria-label={memberName(dm.other)} onClick={() => setConversation({ id: dm.id, name: memberName(dm.other), type: 'dm' })}>
              <span className="avatar">{memberName(dm.other).slice(0, 1).toUpperCase()}</span>
              <span>{memberName(dm.other)}</span>
              {dm.unread > 0 && <span className="unread">{dm.unread}</span>}
            </button>
          ))}
          {categories.map((category) => (
            <section key={category.id}>
              <h2>{category.name}</h2>
              {channels.filter(({ category_id }) => category_id === category.id).sort(byPosition).map((channel) => (
                <button type="button" key={channel.id} aria-label={channel.name} onClick={() => setConversation({ id: channel.id, name: channel.name, type: channel.type })}>
                  <span aria-hidden="true">{channel.type === 'voice' ? '◉' : '#'}</span>
                  <span>{channel.name}</span>
                </button>
              ))}
            </section>
          ))}
        </nav>
        <footer className="member-panel">
          <span className="avatar">{memberName(state.member).slice(0, 1).toUpperCase()}</span>
          <span><strong>{memberName(state.member)}</strong><small>@{state.member.username}</small></span>
          <button type="button" aria-label="User Settings" onClick={() => setSettingsOpen(true)}>⚙</button>
        </footer>
      </aside>
      <section className="conversation-content">
        <header><h1>{settingsOpen ? 'User Settings' : conversation?.name || 'Home'}</h1>{conversation?.type === 'text' && <button className="header-button" type="button" onClick={() => setShowPins((value) => !value)}>Pinned Messages</button>}<form className="header-search" onSubmit={(event) => { event.preventDefault(); const query = String(new FormData(event.currentTarget).get('query') || ''); void onAction({ type: 'search_messages', query }).then((result) => { if (result?.type === 'search_results') setSearchResults(result.results); }); }}><input name="query" aria-label="Search Messages" placeholder="Search" /></form>{state.connection === 'offline' && <span className="offline-badge">Offline</span>}</header>
        {settingsOpen ? (
          <div className="settings-layout">
            <nav aria-label="User settings"><button aria-current="page">Profile</button><button>Voice &amp; Video</button><button>Notifications</button><button>Sessions</button></nav>
            <section><p className="eyebrow">Member settings</p><h2>Profile</h2><p>Signed in as @{state.member.username}</p></section>
          </div>
        ) : searchResults ? (
          <div className="search-results"><h2>Search Results</h2><button type="button" onClick={() => setSearchResults(null)}>Close Search</button>{searchResults.length ? searchResults.map((result) => <article key={result.message.id}><strong>#{result.channel_name} · {result.message.author_name}</strong><p>{result.snippet}</p></article>) : <p>No results found.</p>}</div>
        ) : conversation ? (
          conversation.type === 'voice' ? (
            <div className="welcome"><h2>{conversation.name}</h2><p>Join this Voice Room to talk with Members.</p></div>
          ) : (
            <div className="message-list" aria-label={`${conversation.name} Messages`}>
              {(state.messages[conversation.id] || []).length > 0 && <button className="load-older" type="button" onClick={() => {
                const first = state.messages[conversation.id]?.[0];
                void onAction({ type: 'load_messages', conversationId: conversation.id, direct: conversation.type === 'dm', before: first?.sequence, limit: 50 });
              }}>Load older Messages</button>}
              {(state.messages[conversation.id] || []).filter((message) => !showPins || message.pinned).map((message) => (
                <article className="message" key={message.id}>
                  <span className="avatar">{message.author_name.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{message.author_name}</strong><time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>{message.reply && <blockquote>Replying to {message.reply.author_name}: {message.reply.deleted ? 'Message deleted' : message.reply.body}</blockquote>}<p>{message.deleted ? 'Message deleted' : message.body}</p>{message.body && <LinkPreview body={message.body} onAction={onAction} />}{message.attachments?.map((attachment) => <AttachmentView attachment={attachment} key={attachment.id} onAction={onAction} />)}{message.reactions?.map((reaction) => <button className="reaction" key={reaction.emoji} aria-pressed={reaction.me} onClick={() => void onAction({ type: 'set_reaction', messageId: message.id, emoji: reaction.emoji, active: !reaction.me })}>{reaction.emoji} {reaction.count}</button>)}{message.pinned && <span className="pinned">Pinned</span>}{!message.deleted && <span className="message-actions"><button type="button" onClick={() => setReplyTo(message.id)}>Reply</button><button type="button" onClick={() => void onAction({ type: 'set_reaction', messageId: message.id, emoji: '👍', active: true })}>React</button><button type="button" onClick={() => void onAction({ type: 'set_pinned', messageId: message.id, active: !message.pinned })}>{message.pinned ? 'Unpin' : 'Pin'}</button>{message.author_id === state.member.id && <><button type="button" onClick={() => { setDraft(message.body || ''); setEditingMessageId(message.id); }}>Edit</button><button type="button" onClick={() => void onAction({ type: 'delete_message', messageId: message.id, conversationId: conversation.id })}>Delete</button></>}</span>}</div>
                </article>
              ))}
              <form className="message-composer" onSubmit={(event) => void sendMessage(event)}>
                {replyTo && <div className="composer-context">Replying to a Message <button type="button" onClick={() => setReplyTo(null)}>Cancel</button></div>}
                <textarea aria-label={`Message ${conversation.name}`} value={draft} onChange={(event) => {
                  setDraft(event.target.value);
                  localStorage.setItem(draftKey(instanceId, conversation.id), event.target.value);
                  if (Date.now() - lastTypingAt.current > 3_000) {
                    lastTypingAt.current = Date.now();
                    void onAction({ type: 'send_typing', conversationId: conversation.id });
                  }
                }} />
                <label className="attach-button">Attach<input type="file" multiple onChange={(event) => setAttachments([...event.target.files || []])} /></label>
                <button type="submit" aria-label={editingMessageId ? 'Save Message' : 'Send Message'}>{editingMessageId ? 'Save' : 'Send'}</button>
                {attachments.length > 0 && <small>{attachments.map(({ name }) => name).join(', ')}</small>}
              </form>
            </div>
          )
        ) : (
          <div className="welcome">
            <p className="eyebrow">{state.community.name}</p>
            <h2>Welcome, {memberName(state.member)}</h2>
            <p>Select a Text Channel or Direct Message to start chatting.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function memberName(member: InstanceViewState['member']): string {
  return member.displayName || member.username;
}

function byPosition<T extends { position: number }>(left: T, right: T): number {
  return left.position - right.position;
}

function formatMessageTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function draftKey(instanceId: string, conversationId: string): string {
  return `allchat:draft:${instanceId}:${conversationId}`;
}

function mergeMessage(messages: InstanceViewState['messages'][string], incoming: InstanceViewState['messages'][string][number]) {
  return [...messages.filter(({ id }) => id !== incoming.id), incoming].sort((left, right) => left.sequence - right.sequence);
}

function mergeMessages(current: InstanceViewState['messages'][string], incoming: InstanceViewState['messages'][string]) {
  const messages = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => messages.set(message.id, message));
  return [...messages.values()].sort((left, right) => left.sequence - right.sequence);
}

function formatBytes(size: number): string {
  return size < 1024 ? `${size} B` : `${Math.ceil(size / 1024)} KiB`;
}

function LinkPreview({ body, onAction }: { body: string; onAction(action: InstanceAction): Promise<InstanceActionResult | undefined> }) {
  const [preview, setPreview] = useState<{ url: string; site_name?: string; title?: string; description?: string } | null>(null);
  const url = body.match(/https?:\/\/[^\s<]+/)?.[0];
  useEffect(() => {
    if (!url) return;
    let current = true;
    void onAction({ type: 'link_preview', url }).then((result) => { if (current && result?.type === 'link_preview') setPreview(result.preview); }).catch(() => undefined);
    return () => { current = false; };
  }, [url]);
  return preview ? <a className="link-preview" href={preview.url} target="_blank" rel="noreferrer"><small>{preview.site_name || new URL(preview.url).hostname}</small><strong>{preview.title || preview.url}</strong>{preview.description && <span>{preview.description}</span>}</a> : null;
}

function AttachmentView({ attachment, onAction }: { attachment: Attachment; onAction(action: InstanceAction): Promise<InstanceActionResult | undefined> }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const path = attachment.preview_url || attachment.url || `/api/v1/attachments/${attachment.id}`;

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  async function load(): Promise<void> {
    const result = await onAction({ type: 'load_asset', path });
    if (result?.type !== 'asset') return;
    const nextUrl = URL.createObjectURL(new Blob([result.data as BlobPart], { type: result.contentType }));
    setObjectUrl(nextUrl);
  }

  const type = attachment.content_type;
  return (
    <figure className="attachment">
      {objectUrl && type.startsWith('image/') && <img src={objectUrl} alt={attachment.name} />}
      {objectUrl && type.startsWith('audio/') && <audio src={objectUrl} controls />}
      {objectUrl && type.startsWith('video/') && <video src={objectUrl} controls />}
      <figcaption><strong>{attachment.name}</strong><small>{formatBytes(attachment.size)}</small></figcaption>
      <button type="button" onClick={() => void load()}>{objectUrl ? 'Reload' : 'Open'}</button>
      {objectUrl && <a href={objectUrl} download={attachment.name}>Download</a>}
    </figure>
  );
}
