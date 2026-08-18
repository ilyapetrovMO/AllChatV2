import { DatabaseSync } from 'node:sqlite';

import type { InstanceViewState } from '../shared/instance-state';

export interface InstanceStateCache {
  get(instanceId: string): InstanceViewState | null;
  put(instanceId: string, state: InstanceViewState): void;
}

export class MemoryInstanceStateCache implements InstanceStateCache {
  readonly #states = new Map<string, InstanceViewState>();

  get(instanceId: string): InstanceViewState | null {
    const state = this.#states.get(instanceId);
    return state ? structuredClone(state) : null;
  }

  put(instanceId: string, state: InstanceViewState): void {
    this.#states.set(instanceId, structuredClone(state));
  }
}

export class SQLiteInstanceStateCache implements InstanceStateCache {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    this.#database = new DatabaseSync(path, { timeout: 5_000 });
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS desktop_instance_state (
        instance_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
  }

  get(instanceId: string): InstanceViewState | null {
    const row = this.#database.prepare(
      'SELECT state_json FROM desktop_instance_state WHERE instance_id = ?',
    ).get(instanceId) as { state_json?: string } | undefined;
    if (!row?.state_json) return null;
    const value: unknown = JSON.parse(row.state_json);
    return isCachedState(value) ? value : null;
  }

  put(instanceId: string, state: InstanceViewState): void {
    this.#database.prepare(`
      INSERT INTO desktop_instance_state(instance_id, state_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(instance_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
    `).run(instanceId, JSON.stringify(state), new Date().toISOString());
  }
}

function isCachedState(value: unknown): value is InstanceViewState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<InstanceViewState>;
  return state.version === 1 && (state.connection === 'online' || state.connection === 'offline') &&
    !!state.community && typeof state.community.name === 'string' && typeof state.cursor === 'number';
}
