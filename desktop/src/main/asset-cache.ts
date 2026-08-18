import { DatabaseSync } from 'node:sqlite';

const MAX_ASSET_CACHE_ENTRIES = 512;
const MAX_ASSET_CACHE_BYTES = 512 * 1024 * 1024;

export interface CachedAsset {
  contentType: string;
  data: Uint8Array;
  cachedAt: number;
}

export interface AssetCache {
  get(instanceId: string, assetPath: string): CachedAsset | null;
  put(instanceId: string, assetPath: string, asset: CachedAsset): void;
  clearInstance(instanceId: string): void;
}

export class MemoryAssetCache implements AssetCache {
  readonly #assets = new Map<string, CachedAsset>();

  get(instanceId: string, assetPath: string): CachedAsset | null {
    const asset = this.#assets.get(`${instanceId}:${assetPath}`);
    return asset ? { ...asset, data: new Uint8Array(asset.data) } : null;
  }

  put(instanceId: string, assetPath: string, asset: CachedAsset): void {
    this.#assets.set(`${instanceId}:${assetPath}`, { ...asset, data: new Uint8Array(asset.data) });
  }

  clearInstance(instanceId: string): void {
    for (const key of this.#assets.keys()) {
      if (key.startsWith(`${instanceId}:`)) this.#assets.delete(key);
    }
  }
}

export class SQLiteAssetCache implements AssetCache {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    this.#database = new DatabaseSync(path, { timeout: 5_000 });
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS desktop_asset_cache (
        instance_id TEXT NOT NULL,
        asset_path TEXT NOT NULL,
        content_type TEXT NOT NULL,
        asset_data BLOB NOT NULL,
        cached_at INTEGER NOT NULL,
        PRIMARY KEY(instance_id, asset_path)
      ) STRICT;
    `);
  }

  get(instanceId: string, assetPath: string): CachedAsset | null {
    const row = this.#database.prepare(`
      SELECT content_type, asset_data, cached_at
      FROM desktop_asset_cache
      WHERE instance_id = ? AND asset_path = ?
    `).get(instanceId, assetPath) as { content_type: string; asset_data: Uint8Array; cached_at: number } | undefined;
    return row ? { contentType: row.content_type, data: new Uint8Array(row.asset_data), cachedAt: row.cached_at } : null;
  }

  put(instanceId: string, assetPath: string, asset: CachedAsset): void {
    this.#database.prepare(`
      INSERT INTO desktop_asset_cache(instance_id, asset_path, content_type, asset_data, cached_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(instance_id, asset_path) DO UPDATE SET
        content_type = excluded.content_type,
        asset_data = excluded.asset_data,
        cached_at = excluded.cached_at
    `).run(instanceId, assetPath, asset.contentType, asset.data, asset.cachedAt);
    this.#database.prepare(`
      DELETE FROM desktop_asset_cache
      WHERE instance_id = ? AND asset_path NOT IN (
        SELECT asset_path FROM desktop_asset_cache
        WHERE instance_id = ? ORDER BY cached_at DESC LIMIT ${MAX_ASSET_CACHE_ENTRIES}
      )
    `).run(instanceId, instanceId);
    this.#database.prepare(`
      DELETE FROM desktop_asset_cache
      WHERE instance_id = ? AND asset_path IN (
        SELECT asset_path FROM (
          SELECT asset_path, SUM(length(asset_data)) OVER (
            ORDER BY cached_at DESC, asset_path DESC
          ) AS running_bytes
          FROM desktop_asset_cache WHERE instance_id = ?
        ) WHERE running_bytes > ?
      )
    `).run(instanceId, instanceId, MAX_ASSET_CACHE_BYTES);
  }

  clearInstance(instanceId: string): void {
    this.#database.prepare('DELETE FROM desktop_asset_cache WHERE instance_id = ?').run(instanceId);
  }

  close(): void {
    this.#database.close();
  }
}
