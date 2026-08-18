import { useEffect, useState } from 'react';

import type { DesktopBridge, ShellState } from '../shared/desktop-bridge';

export function App({ bridge }: { bridge: DesktopBridge }) {
  const [state, setState] = useState<ShellState | null>(null);

  useEffect(() => {
    void bridge.getShellState().then(setState);
  }, [bridge]);

  return (
    <main className="shell">
      <aside className="instance-rail" aria-label="Instances">
        <div className="brand-mark" aria-label="AllChat">A</div>
        {state?.instances.map((instance) => (
          <button
            className="instance-button"
            key={instance.id}
            onClick={() => void bridge.selectInstance(instance.id)}
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
            <button type="button">Add Instance</button>
          </div>
        ) : (
          <h1>{state.instances.find(({ id }) => id === state.activeInstanceId)?.displayName}</h1>
        )}
      </section>
    </main>
  );
}
