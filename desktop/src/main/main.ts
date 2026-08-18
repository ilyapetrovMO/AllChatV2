import path from 'node:path';

import { app, BrowserWindow, ipcMain, safeStorage, session } from 'electron';

import { DesktopAccountManager } from './desktop-account-manager';
import { EncryptedFileCredentialVault } from './desktop-credential-vault';
import { SQLiteInstanceProfileStore } from './instance-profile-store';
import { InstanceCoordinator } from './instance-coordinator';
import { SQLiteInstanceStateCache } from './instance-state-cache';
import { InstanceRegistry } from './instance-registry';
import { createWindowOptions, isAllowedAppNavigation } from './window-policy';
import {
  IPC_CHANNELS,
  type AddInstanceInput,
  type LoginInstanceInput,
} from '../shared/desktop-bridge';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let registry: InstanceRegistry;
let accounts: DesktopAccountManager;
let coordinator: InstanceCoordinator;

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
  const dataPath = app.getPath('userData');
  registry = new InstanceRegistry(undefined, new SQLiteInstanceProfileStore(path.join(dataPath, 'desktop.db')));
  const vault = new EncryptedFileCredentialVault(path.join(dataPath, 'credentials.vault'), {
    isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptStringAsync(value),
    decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result,
  });
  accounts = new DesktopAccountManager(registry, vault);
  coordinator = new InstanceCoordinator(registry, vault, fetch, new SQLiteInstanceStateCache(path.join(dataPath, 'desktop.db')));
  void accounts.validateStoredSessions();
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
  const realtimeListeners = new Map<string, (state: import('../shared/instance-state').InstanceViewState) => void>();
  ipcMain.handle(IPC_CHANNELS.getShellState, () => registry.state());
  ipcMain.handle(IPC_CHANNELS.addInstance, (_event, input: AddInstanceInput) => {
    assertAddInstanceInput(input);
    registry.add(input);
    return registry.state();
  });
  ipcMain.handle(IPC_CHANNELS.selectInstance, (_event, id: string) => {
    assertString(id, 'Instance identity');
    registry.select(id);
    return registry.state();
  });
  ipcMain.handle(IPC_CHANNELS.loginInstance, (_event, input: LoginInstanceInput) => {
    assertLoginInput(input);
    return accounts.login(input);
  });
  ipcMain.handle(IPC_CHANNELS.logoutInstance, (_event, id: string) => {
    assertString(id, 'Instance identity');
    return accounts.logout(id);
  });
  ipcMain.handle(IPC_CHANNELS.loadInstance, (_event, id: string) => {
    assertString(id, 'Instance identity');
    return coordinator.load(id);
  });
  ipcMain.on(IPC_CHANNELS.watchInstance, (event, id: string) => {
    assertString(id, 'Instance identity');
    const key = `${event.sender.id}:${id}`;
    const previous = realtimeListeners.get(key);
    if (previous) coordinator.unwatch(id, previous);
    const listener = (state: import('../shared/instance-state').InstanceViewState) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.instanceStateChanged, id, state);
    };
    realtimeListeners.set(key, listener);
    coordinator.watch(id, listener);
  });
  ipcMain.on(IPC_CHANNELS.unwatchInstance, (event, id: string) => {
    const key = `${event.sender.id}:${id}`;
    const listener = realtimeListeners.get(key);
    if (listener) coordinator.unwatch(id, listener);
    realtimeListeners.delete(key);
  });
  ipcMain.handle(IPC_CHANNELS.executeInstance, (_event, id: string, action: import('../shared/instance-actions').InstanceAction) => {
    assertString(id, 'Instance identity');
    assertInstanceAction(action);
    return coordinator.execute(id, action);
  });
}

function assertAddInstanceInput(value: AddInstanceInput): void {
  if (!value || typeof value !== 'object') throw new Error('Invalid Instance Profile');
  assertString(value.displayName, 'Instance display name');
  assertString(value.baseUrl, 'Instance address');
}

function assertLoginInput(value: LoginInstanceInput): void {
  if (!value || typeof value !== 'object') throw new Error('Invalid sign-in request');
  assertString(value.instanceId, 'Instance identity');
  assertString(value.username, 'Username');
  assertString(value.password, 'Password');
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) {
    throw new Error(`${label} is invalid`);
  }
}

function assertInstanceAction(value: import('../shared/instance-actions').InstanceAction): void {
  if (!value || typeof value !== 'object' || typeof value.type !== 'string') throw new Error('Invalid Instance action');
  if ('conversationId' in value) assertString(value.conversationId, 'Conversation identity');
  if (value.type === 'send_message' || value.type === 'edit_message') {
    if (value.type === 'edit_message') assertString(value.messageId, 'Message identity');
    if (value.type === 'send_message' && typeof value.direct !== 'boolean') throw new Error('Conversation type is invalid');
    if (typeof value.body !== 'string' || value.body.length > 8_000) throw new Error('Message body is invalid');
    if (value.type === 'edit_message' && !value.body.trim()) throw new Error('Message body is invalid');
    if (value.type === 'send_message') {
      const attachmentIds = value.attachmentIds || [];
      if (!Array.isArray(attachmentIds) || attachmentIds.length > 10) throw new Error('Attachments are invalid');
      attachmentIds.forEach((id) => assertString(id, 'Attachment identity'));
      if (!value.body.trim() && attachmentIds.length === 0) throw new Error('Message body is invalid');
      if (value.replyTo !== undefined) assertString(value.replyTo, 'Reply identity');
    }
    return;
  }
  if (value.type === 'delete_message') { assertString(value.messageId, 'Message identity'); return; }
  if (value.type === 'load_messages') {
    if (typeof value.direct !== 'boolean' || (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100))) throw new Error('Message page is invalid');
    return;
  }
  if (value.type === 'update_read_position') {
    if (typeof value.direct !== 'boolean' || !Number.isSafeInteger(value.sequence) || value.sequence < 0) throw new Error('Read Position is invalid');
    return;
  }
  if (value.type === 'send_typing') return;
  if (value.type === 'set_reaction') {
    assertString(value.messageId, 'Message identity'); assertString(value.emoji, 'Reaction');
    if (typeof value.active !== 'boolean' || value.emoji.length > 32) throw new Error('Reaction is invalid');
    return;
  }
  if (value.type === 'set_pinned') { assertString(value.messageId, 'Message identity'); if (typeof value.active !== 'boolean') throw new Error('Pin state is invalid'); return; }
  if (value.type === 'list_pins') { assertString(value.channelId, 'Channel identity'); return; }
  if (value.type === 'search_messages') { assertString(value.query, 'Search query'); if (value.query.length > 500) throw new Error('Search query is invalid'); return; }
  if (value.type === 'upload_attachment') {
    assertString(value.name, 'Attachment name'); assertString(value.contentType, 'Attachment content type');
    if (!(value.data instanceof Uint8Array) || value.data.byteLength > 25 * 1024 * 1024) throw new Error('Attachment is invalid');
    return;
  }
  if (value.type === 'link_preview') { assertString(value.url, 'Preview URL'); if (!/^https?:\/\//.test(value.url)) throw new Error('Preview URL is invalid'); return; }
  if (value.type === 'load_asset') {
    assertString(value.path, 'Asset path');
    const asset = new URL(value.path, 'https://allchat.invalid');
    const allowed = asset.pathname.startsWith('/api/v1/attachments/') || /^\/api\/v1\/members\/[^/]+\/(avatar|banner)$/.test(asset.pathname);
    if (asset.origin !== 'https://allchat.invalid' || !allowed) throw new Error('Asset path is invalid');
    return;
  }
  if (value.type === 'update_profile') { assertString(value.username, 'Username'); if (typeof value.displayName !== 'string' || value.displayName.length > 80) throw new Error('Display Name is invalid'); return; }
  if (value.type === 'update_profile_image') {
    if (value.kind !== 'avatar' && value.kind !== 'banner') throw new Error('Profile image kind is invalid');
    assertString(value.contentType, 'Profile image content type');
    if (!(value.data instanceof Uint8Array) || value.data.byteLength < 1 || value.data.byteLength > 8 * 1024 * 1024) throw new Error('Profile image is invalid');
    return;
  }
  if (value.type === 'remove_profile_image') { if (value.kind !== 'avatar' && value.kind !== 'banner') throw new Error('Profile image kind is invalid'); return; }
  if (value.type === 'set_presence') { if (value.mode !== 'available' && value.mode !== 'dnd') throw new Error('Presence mode is invalid'); return; }
  if (value.type === 'open_dm' || value.type === 'set_block') { assertString(value.memberId, 'Member identity'); if (value.type === 'set_block' && typeof value.blocked !== 'boolean') throw new Error('Block state is invalid'); return; }
  if (value.type === 'list_sessions') return;
  if (value.type === 'revoke_session') { assertString(value.sessionId, 'Session identity'); return; }
  if (value.type === 'create_report') {
    if ((value.targetMemberId ? 1 : 0) + (value.targetMessageId ? 1 : 0) !== 1) throw new Error('Report target is invalid');
    if (value.targetMemberId) assertString(value.targetMemberId, 'Member identity');
    if (value.targetMessageId) assertString(value.targetMessageId, 'Message identity');
    assertBoundedText(value.reason, 'Report reason', 3, 1_000); return;
  }
  if (value.type === 'list_reports' || value.type === 'list_moderation_records' || value.type === 'export_account') return;
  if (value.type === 'purge_moderation_records') { assertString(value.before, 'Moderation cutoff'); if (Number.isNaN(Date.parse(value.before))) throw new Error('Moderation cutoff is invalid'); return; }
  if (value.type === 'resolve_report') { assertString(value.reportId, 'Report identity'); assertBoundedText(value.outcome, 'Report outcome', 3, 1_000); return; }
  if (value.type === 'moderate') {
    assertString(value.action, 'Moderation action'); assertBoundedText(value.reason, 'Moderation reason', 3, 1_000);
    if (value.targetMemberId) assertString(value.targetMemberId, 'Member identity');
    if (value.targetMessageId) assertString(value.targetMessageId, 'Message identity');
    if (value.invitationId) assertString(value.invitationId, 'Invitation identity');
    if (value.durationMinutes !== undefined && (!Number.isInteger(value.durationMinutes) || value.durationMinutes < 0 || value.durationMinutes > 525_600)) throw new Error('Moderation duration is invalid');
    return;
  }
  if (value.type === 'delete_account') { assertString(value.password, 'Password'); if (value.confirmation !== 'DELETE') throw new Error('Account deletion confirmation is invalid'); return; }
  throw new Error('Unsupported Instance action');
}

function assertBoundedText(value: unknown, label: string, minimum: number, maximum: number): asserts value is string {
  if (typeof value !== 'string' || value.trim().length < minimum || value.length > maximum) throw new Error(`${label} is invalid`);
}

function lockPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}
