import { describe, expect, it } from 'vitest';

import { DESKTOP_BRIDGE_METHODS, isDesktopBridge } from './desktop-bridge';

describe('DesktopBridge', () => {
  it('has a deliberately small, explicit capability list', () => {
    expect(DESKTOP_BRIDGE_METHODS).toEqual([
      'getShellState',
      'addInstance',
      'selectInstance',
      'loginInstance',
      'logoutInstance',
      'loadInstance',
    ]);
  });

  it('rejects missing and additional renderer capabilities', () => {
    const valid = {
      getShellState: async () => ({ instances: [], activeInstanceId: null }),
      addInstance: async () => undefined,
      selectInstance: async () => undefined,
      loginInstance: async () => ({ instances: [], activeInstanceId: null }),
      logoutInstance: async () => ({ instances: [], activeInstanceId: null }),
      loadInstance: async () => { throw new Error('not authenticated'); },
    };

    expect(isDesktopBridge(valid)).toBe(true);
    expect(isDesktopBridge({ ...valid, readFile: async () => '' })).toBe(false);
    expect(isDesktopBridge({ getShellState: valid.getShellState })).toBe(false);
  });
});
