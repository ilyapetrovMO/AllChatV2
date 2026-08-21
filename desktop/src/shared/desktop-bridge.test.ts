import { describe, expect, it } from 'vitest';

import { DESKTOP_BRIDGE_METHODS, isDesktopBridge } from './desktop-bridge';

describe('DesktopBridge', () => {
  it('has a deliberately small, explicit capability list', () => {
    expect(DESKTOP_BRIDGE_METHODS).toEqual([
      'controlWindow',
      'getUpdateState',
      'watchUpdateState',
      'installUpdate',
      'setNotificationContext',
      'setIncomingCallNotification',
      'reportDiagnostic',
      'getShellState',
      'addInstance',
      'selectInstance',
      'loginInstance',
      'registerInstance',
      'recoverInstance',
      'logoutInstance',
      'loadInstance',
      'watchInstance',
      'executeInstance',
      'connectMedia',
    ]);
  });

  it('rejects missing and additional renderer capabilities', () => {
    const valid = {
      controlWindow: async () => undefined,
      getUpdateState: async () => ({ status: 'idle' as const }),
      watchUpdateState: () => () => undefined,
      installUpdate: async () => undefined,
      setNotificationContext: () => undefined,
      setIncomingCallNotification: () => undefined,
      reportDiagnostic: () => undefined,
      getShellState: async () => ({ instances: [], activeInstanceId: null }),
      addInstance: async () => undefined,
      selectInstance: async () => undefined,
      loginInstance: async () => ({ instances: [], activeInstanceId: null }),
      registerInstance: async () => ({ instances: [], activeInstanceId: null }),
      recoverInstance: async () => ({ instances: [], activeInstanceId: null }),
      logoutInstance: async () => ({ instances: [], activeInstanceId: null }),
      loadInstance: async () => { throw new Error('not authenticated'); },
      watchInstance: () => () => undefined,
      executeInstance: async () => { throw new Error('unused'); },
      connectMedia: async () => ({ send: () => undefined, close: () => undefined }),
    };

    expect(isDesktopBridge(valid)).toBe(true);
    expect(isDesktopBridge({ ...valid, readFile: async () => '' })).toBe(false);
    expect(isDesktopBridge({ getShellState: valid.getShellState })).toBe(false);
  });
});
