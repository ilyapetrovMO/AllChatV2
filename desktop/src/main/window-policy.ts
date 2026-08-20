import type { BrowserWindowConstructorOptions } from 'electron';

export function createWindowOptions(preload: string, icon: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f111a',
    show: false,
    frame: false,
    autoHideMenuBar: true,
    icon,
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

export function isAllowedExternalNavigation(target: string): boolean {
  try {
    const url = new URL(target);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isAllowedRendererPermission(permission: string, belongsToAppWindow: boolean): boolean {
  return belongsToAppWindow && permission === 'media';
}
