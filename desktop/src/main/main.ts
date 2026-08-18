import path from 'node:path';

import { app, BrowserWindow, ipcMain, session } from 'electron';

import { InstanceRegistry } from './instance-registry';
import { createWindowOptions, isAllowedAppNavigation } from './window-policy';
import { IPC_CHANNELS, type AddInstanceInput } from '../shared/desktop-bridge';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const registry = new InstanceRegistry();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.show());
  app.whenReady().then(start);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

async function start(): Promise<void> {
  registerIpc();
  lockPermissions();
  await createMainWindow();
}

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow(
    createWindowOptions(path.join(__dirname, 'preload.js')),
  );
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => {
    if (!isAllowedAppNavigation(target) && target !== MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      event.preventDefault();
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  return window;
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getShellState, () => registry.state());
  ipcMain.handle(IPC_CHANNELS.addInstance, (_event, input: AddInstanceInput) => {
    registry.add(input);
  });
  ipcMain.handle(IPC_CHANNELS.selectInstance, (_event, id: string) => registry.select(id));
}

function lockPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}
