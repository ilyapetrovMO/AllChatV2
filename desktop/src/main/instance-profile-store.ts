import { DatabaseSync } from 'node:sqlite';

import type { InstanceProfile, ShellState } from '../shared/desktop-bridge';

export interface InstanceProfileStore {
  load(): ShellState;
  save(state: ShellState): void;
}

export class MemoryInstanceProfileStore implements InstanceProfileStore {
  #state: ShellState = { instances: [], activeInstanceId: null };

  load(): ShellState {
    return cloneState(this.#state);
  }

  save(state: ShellState): void {
    this.#state = cloneState(state);
  }
}

export class SQLiteInstanceProfileStore implements InstanceProfileStore {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    this.#database = new DatabaseSync(path, { timeout: 5_000 });
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS desktop_instance_profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        base_url TEXT NOT NULL UNIQUE,
        partition_name TEXT NOT NULL UNIQUE,
        credential_ref TEXT,
        session_json TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS desktop_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
    `);
	const columns = this.#database.prepare('PRAGMA table_info(desktop_instance_profiles)').all() as Array<{ name: string }>;
	if (!columns.some(({ name }) => name === 'avatar_url')) this.#database.exec('ALTER TABLE desktop_instance_profiles ADD COLUMN avatar_url TEXT');
  }

  load(): ShellState {
    const instances = this.#database
	  .prepare(`SELECT id, display_name, avatar_url, base_url, partition_name, credential_ref, session_json
                FROM desktop_instance_profiles ORDER BY rowid`)
      .all()
      .map((row) => rowToProfile(row as Record<string, unknown>));
    const setting = this.#database
      .prepare("SELECT value FROM desktop_settings WHERE key = 'active_instance_id'")
      .get() as { value?: string } | undefined;
    const activeInstanceId = setting?.value && instances.some(({ id }) => id === setting.value)
      ? setting.value
      : instances[0]?.id ?? null;
    return { instances, activeInstanceId };
  }

  save(state: ShellState): void {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.#database.exec('DELETE FROM desktop_instance_profiles');
      const insert = this.#database.prepare(`
		INSERT INTO desktop_instance_profiles(id, display_name, avatar_url, base_url, partition_name, credential_ref, session_json)
		VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const profile of state.instances) {
        insert.run(
          profile.id,
          profile.displayName,
		  profile.avatarUrl || null,
          profile.baseUrl,
          profile.partition,
          profile.credentialRef,
          profile.session ? JSON.stringify(profile.session) : null,
        );
      }
      if (state.activeInstanceId) {
        this.#database.prepare(`
          INSERT INTO desktop_settings(key, value) VALUES ('active_instance_id', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(state.activeInstanceId);
      } else {
        this.#database.prepare("DELETE FROM desktop_settings WHERE key = 'active_instance_id'").run();
      }
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }
}

function rowToProfile(row: Record<string, unknown>): InstanceProfile {
  const session = typeof row.session_json === 'string'
    ? JSON.parse(row.session_json) as InstanceProfile['session']
    : undefined;
  return {
    id: String(row.id),
    displayName: String(row.display_name),
	...(typeof row.avatar_url === 'string' ? { avatarUrl: row.avatar_url } : {}),
    baseUrl: String(row.base_url),
    partition: String(row.partition_name),
    credentialRef: row.credential_ref === null ? null : String(row.credential_ref),
    ...(session ? { session } : {}),
  };
}

function cloneState(state: ShellState): ShellState {
  return {
    instances: state.instances.map((profile) => ({ ...profile })),
    activeInstanceId: state.activeInstanceId,
  };
}
