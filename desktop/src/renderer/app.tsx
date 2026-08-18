import { FormEvent, useEffect, useRef, useState } from 'react';

import type { DesktopBridge, ShellState } from '../shared/desktop-bridge';
import type { InstanceViewState } from '../shared/instance-state';
import type { InstanceAction } from '../shared/instance-actions';

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

  async function executeAction(action: InstanceAction): Promise<void> {
    if (!active) return;
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
          [action.type === 'load_messages' ? action.conversationId : '']: mergeMessages(
            action.type === 'load_messages' ? current.messages[action.conversationId] || [] : [],
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

function CommunityShell({ instanceId, state, onAction }: { instanceId: string; state: InstanceViewState; onAction(action: InstanceAction): Promise<void> }) {
  const [conversation, setConversation] = useState<{ id: string; name: string; type: 'text' | 'voice' | 'dm' } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
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
    if (!conversation || conversation.type === 'voice' || !draft.trim()) return;
    const body = draft;
    await onAction(editingMessageId
      ? { type: 'edit_message', messageId: editingMessageId, body }
      : { type: 'send_message', conversationId: conversation.id, direct: conversation.type === 'dm', body });
    setDraft('');
    setEditingMessageId(null);
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
        <header><h1>{settingsOpen ? 'User Settings' : conversation?.name || 'Home'}</h1>{state.connection === 'offline' && <span className="offline-badge">Offline</span>}</header>
        {settingsOpen ? (
          <div className="settings-layout">
            <nav aria-label="User settings"><button aria-current="page">Profile</button><button>Voice &amp; Video</button><button>Notifications</button><button>Sessions</button></nav>
            <section><p className="eyebrow">Member settings</p><h2>Profile</h2><p>Signed in as @{state.member.username}</p></section>
          </div>
        ) : conversation ? (
          conversation.type === 'voice' ? (
            <div className="welcome"><h2>{conversation.name}</h2><p>Join this Voice Room to talk with Members.</p></div>
          ) : (
            <div className="message-list" aria-label={`${conversation.name} Messages`}>
              {(state.messages[conversation.id] || []).length > 0 && <button className="load-older" type="button" onClick={() => {
                const first = state.messages[conversation.id]?.[0];
                void onAction({ type: 'load_messages', conversationId: conversation.id, direct: conversation.type === 'dm', before: first?.sequence, limit: 50 });
              }}>Load older Messages</button>}
              {(state.messages[conversation.id] || []).map((message) => (
                <article className="message" key={message.id}>
                  <span className="avatar">{message.author_name.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{message.author_name}</strong><time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time><p>{message.deleted ? 'Message deleted' : message.body}</p>{message.author_id === state.member.id && !message.deleted && <span className="message-actions"><button type="button" onClick={() => { setDraft(message.body || ''); setEditingMessageId(message.id); }}>Edit</button><button type="button" onClick={() => void onAction({ type: 'delete_message', messageId: message.id, conversationId: conversation.id })}>Delete</button></span>}</div>
                </article>
              ))}
              <form className="message-composer" onSubmit={(event) => void sendMessage(event)}>
                <textarea aria-label={`Message ${conversation.name}`} value={draft} onChange={(event) => {
                  setDraft(event.target.value);
                  localStorage.setItem(draftKey(instanceId, conversation.id), event.target.value);
                  if (Date.now() - lastTypingAt.current > 3_000) {
                    lastTypingAt.current = Date.now();
                    void onAction({ type: 'send_typing', conversationId: conversation.id });
                  }
                }} />
                <button type="submit" aria-label={editingMessageId ? 'Save Message' : 'Send Message'}>{editingMessageId ? 'Save' : 'Send'}</button>
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
