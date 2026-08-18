import { FormEvent, useEffect, useState } from 'react';

import type { DesktopBridge, ShellState } from '../shared/desktop-bridge';

export function App({ bridge }: { bridge: DesktopBridge }) {
  const [state, setState] = useState<ShellState | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void bridge.getShellState().then(setState);
  }, [bridge]);

  const active = state?.instances.find(({ id }) => id === state.activeInstanceId);

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
        ) : (
          <div className="empty-state">
            <p className="eyebrow">Connected</p>
            <h1>{active?.displayName}</h1>
            <p>Signed in as @{active?.session?.member.username}</p>
          </div>
        )}
      </section>
    </main>
  );
}
