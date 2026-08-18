import { FormEvent, useEffect, useState } from 'react';

import type { DesktopBridge, ShellState } from '../shared/desktop-bridge';
import type { InstanceViewState } from '../shared/instance-state';

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
          <CommunityShell state={instanceState} />
        ) : (
          <div className="empty-state"><p>Synchronizing {active?.displayName}…</p>{error && <p role="alert">{error}</p>}</div>
        )}
      </section>
    </main>
  );
}

function CommunityShell({ state }: { state: InstanceViewState }) {
  const [conversation, setConversation] = useState<{ id: string; name: string; type: 'text' | 'voice' | 'dm' } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const categories = [...state.categories].filter(({ archived }) => !archived).sort(byPosition);
  const channels = [...state.channels].filter(({ archived }) => !archived);
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
        <header><h1>{settingsOpen ? 'User Settings' : conversation?.name || 'Home'}</h1></header>
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
              {(state.messages[conversation.id] || []).map((message) => (
                <article className="message" key={message.id}>
                  <span className="avatar">{message.author_name.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{message.author_name}</strong><time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time><p>{message.deleted ? 'Message deleted' : message.body}</p></div>
                </article>
              ))}
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
