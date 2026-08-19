import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SQLiteAssetCache } from './asset-cache';

describe('SQLiteAssetCache', () => {
  it('persists avatar bytes between cache instances', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'allchat-asset-cache-'));
    const databasePath = path.join(directory, 'desktop.db');
    const writer = new SQLiteAssetCache(databasePath);
    writer.put('home', '/api/v1/members/alex/avatar', {
      contentType: 'image/png', data: new Uint8Array([1, 2, 3]), cachedAt: 42,
    });
    writer.close();

    const reader = new SQLiteAssetCache(databasePath);
    expect(reader.get('home', '/api/v1/members/alex/avatar')).toEqual({
      contentType: 'image/png', data: new Uint8Array([1, 2, 3]), cachedAt: 42,
    });
    reader.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
// @vitest-environment node
