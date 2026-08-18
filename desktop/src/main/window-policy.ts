import type { BrowserWindowConstructorOptions } from 'electron';

export function createWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f111a',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload,
    },
  };
}

export function isAllowedAppNavigation(target: string): boolean {
  try {
    return new URL(target).protocol === 'file:';
  } catch {
    return false;
  }
}
