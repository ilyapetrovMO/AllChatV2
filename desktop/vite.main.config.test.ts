// @vitest-environment node

import { describe, expect, it } from 'vitest';

import config from './vite.main.config.mts';

describe('Electron main Vite configuration', () => {
  it('keeps Electron and Node built-ins out of the application bundle', () => {
    const external = config.build?.rollupOptions?.external;
    if (!Array.isArray(external)) throw new Error('main-process externals are not configured');

    const matches = (id: string) => external.some((entry) =>
      typeof entry === 'string' ? entry === id : entry instanceof RegExp && entry.test(id));
    expect(matches('electron')).toBe(true);
    expect(matches('node:sqlite')).toBe(true);
    expect(matches('node:path')).toBe(true);
    expect(matches('ws')).toBe(false);
  });
});
