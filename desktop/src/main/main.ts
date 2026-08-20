import path from 'node:path';

import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, safeStorage, session, shell, Tray } from 'electron';
import WebSocket from 'ws';

import { DesktopAccountManager } from './desktop-account-manager';
import { EncryptedFileCredentialVault } from './desktop-credential-vault';
import type { DesktopCredentialVault } from './desktop-credential-vault';
import { SQLiteInstanceProfileStore } from './instance-profile-store';
import { InstanceCoordinator } from './instance-coordinator';
import { SQLiteInstanceStateCache } from './instance-state-cache';
import { SQLiteAssetCache } from './asset-cache';
import { InstanceRegistry } from './instance-registry';
import { createWindowOptions, isAllowedAppNavigation, isAllowedExternalNavigation, isAllowedRendererPermission } from './window-policy';
import { createTrayMenu, shouldHideOnClose, type TrayPresence } from './tray-menu';
import { downloadVerifiedUpdate, findDesktopUpdate } from './desktop-updater';
import { assertAllowedAssetPath } from './asset-policy';
import { notificationPreview, shouldNotifyForMessage } from '../shared/notification-policy';
import { configureApplicationIdentity } from './application-identity';
import {
  IPC_CHANNELS,
  type AddInstanceInput,
  type DesktopDiagnosticEvent,
  type DesktopUpdateState,
  type LoginInstanceInput,
  type RecoverInstanceInput,
  type RegisterInstanceInput,
} from '../shared/desktop-bridge';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let registry: InstanceRegistry;
let accounts: DesktopAccountManager;
let coordinator: InstanceCoordinator;
let vault: DesktopCredentialVault;
const mediaSockets = new Map<string, { owner: number; socket: WebSocket }>();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let trayPresence: TrayPresence = 'available';
let offeredUpdateVersion = '';
let desktopUpdateState: DesktopUpdateState = { status: 'idle' };
let downloadedUpdatePath = '';
let notificationContext = { instanceId: '', conversationId: '' };

configureApplicationIdentity(app);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(start).catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('AllChat desktop failed to start:', message);
    dialog.showErrorBox('AllChat could not start', message);
    app.quit();
  });
  app.on('activate', showMainWindow);
}

async function start(): Promise<void> {
  Menu.setApplicationMenu(null);
  const dataPath = app.getPath('userData');
  registry = new InstanceRegistry(undefined, new SQLiteInstanceProfileStore(path.join(dataPath, 'desktop.db')));
  vault = new EncryptedFileCredentialVault(path.join(dataPath, 'credentials.vault'), {
    isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptStringAsync(value),
    decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result,
  });
  accounts = new DesktopAccountManager(registry, vault);
  const databasePath = path.join(dataPath, 'desktop.db');
  coordinator = new InstanceCoordinator(
    registry,
    vault,
    fetch,
    new SQLiteInstanceStateCache(databasePath),
    new SQLiteAssetCache(databasePath),
  );
  coordinator.onMessage = (_instanceId, message, state) => {
    const activeConversation = notificationContext.instanceId === _instanceId ? notificationContext.conversationId : '';
    if (!Notification.isSupported() || !shouldNotifyForMessage(message, state, Boolean(mainWindow?.isFocused()), activeConversation)) return;
    const direct = state.direct_messages.some(({ id }) => id === message.channel_id);
    const channelName = state.channels.find(({ id }) => id === message.channel_id)?.name;
    const notification = new Notification({
      title: direct || !channelName ? message.author_name : `${message.author_name} · #${channelName}`,
      body: notificationPreview(message),
      silent: state.notifications.community.sound_enabled === false,
    });
    notification.on('click', showMainWindow);
    notification.show();
  };
  void accounts.validateStoredSessions();
  registerIpc();
  lockPermissions();
  mainWindow = await createMainWindow();
  createApplicationTray();
  if (process.env.ALLCHAT_DESKTOP_SMOKE_TEST === '1') {
    console.log('AllChat desktop packaged startup: PASS');
    app.quit();
    return;
  }
  scheduleUpdateChecks();
}

function scheduleUpdateChecks(): void {
  if (!app.isPackaged) return;
  const check = () => void checkForDesktopUpdate().catch((error: unknown) => {
    console.warn('AllChat desktop update check failed:', error instanceof Error ? error.message : String(error));
  });
  setTimeout(check, 10_000).unref();
  setInterval(check, 6 * 60 * 60 * 1_000).unref();
}

async function checkForDesktopUpdate(): Promise<void> {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  const update = await findDesktopUpdate(app.getVersion(), process.platform, process.arch);
  if (!update || update.version === offeredUpdateVersion) return;
  offeredUpdateVersion = update.version;
  const choice = await dialog.showMessageBox(window, {
    type: 'info',
    title: 'AllChat update available',
    message: `AllChat ${update.version} is available`,
    detail: `You are using ${app.getVersion()}. Download the verified update now?`,
    buttons: ['Download update', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (choice.response !== 0) return;
  try {
    setDesktopUpdateState({ status: 'downloading', version: update.version, receivedBytes: 0, totalBytes: null });
    let lastProgressAt = 0;
    let lastPercentage = -1;
    downloadedUpdatePath = await downloadVerifiedUpdate(update, app.getPath('downloads'), fetch, (progress) => {
      const now = Date.now();
      const percentage = progress.totalBytes ? Math.floor(progress.receivedBytes / progress.totalBytes * 100) : -1;
      if (percentage === lastPercentage && now - lastProgressAt < 250 && progress.receivedBytes !== progress.totalBytes) return;
      lastProgressAt = now;
      lastPercentage = percentage;
      setDesktopUpdateState({ status: 'downloading', version: update.version, ...progress });
    });
    setDesktopUpdateState({ status: 'ready', version: update.version });
  } catch (error) {
    console.error('AllChat desktop update download failed:', error);
    setDesktopUpdateState({ status: 'failed', version: update.version, message: error instanceof Error ? error.message : String(error) });
  }
}

function setDesktopUpdateState(state: DesktopUpdateState): void {
  desktopUpdateState = state;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.updateStateChanged, state);
}

async function installDownloadedUpdate(): Promise<void> {
  if (desktopUpdateState.status !== 'ready' || !downloadedUpdatePath) throw new Error('No verified update is ready.');
  const error = await shell.openPath(downloadedUpdatePath);
  if (error) throw new Error(error);
  if (process.platform === 'win32') {
    quitting = true;
    setTimeout(() => app.quit(), 750).unref();
  }
}

async function createMainWindow(): Promise<BrowserWindow> {
  const icon = runtimeApplicationIcon();
  const window = new BrowserWindow(
    createWindowOptions(path.join(__dirname, 'preload.js'), icon),
  );
  window.on('close', (event) => {
    if (!shouldHideOnClose(quitting)) return;
    event.preventDefault();
    window.hide();
  });
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalNavigation(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
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

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createApplicationTray(): void {
  if (tray) return;
  const icon = runtimeApplicationIcon();
  tray = new Tray(icon);
  tray.setToolTip('AllChat');
  tray.on('click', showMainWindow);
  refreshTrayMenu();
}

function runtimeApplicationIcon(): string {
  if (process.platform === 'win32') {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'allchat.ico')
      : path.resolve(app.getAppPath(), 'installer/allchat.ico');
  }
  return app.isPackaged
    ? path.join(process.resourcesPath, 'allchat-icon.png')
    : path.resolve(app.getAppPath(), '../assets/branding/allchat-icon.png');
}

function refreshTrayMenu(): void {
  tray?.setContextMenu(Menu.buildFromTemplate(createTrayMenu(
    trayPresence,
    (presence) => void updateTrayPresence(presence),
    showMainWindow,
    () => { quitting = true; app.quit(); },
  )));
}

async function updateTrayPresence(presence: TrayPresence): Promise<void> {
  const active = registry.state().activeInstanceId;
  const profile = active ? registry.get(active) : null;
  if (!active || !profile?.session) {
    showMainWindow();
    return;
  }
  try {
    await coordinator.execute(active, { type: 'set_presence', mode: presence });
    trayPresence = presence;
    refreshTrayMenu();
  } catch (error) {
    dialog.showErrorBox('Could not change status', error instanceof Error ? error.message : 'The Instance rejected the status change.');
  }
}

function registerIpc(): void {
  const realtimeListeners = new Map<string, (state: import('../shared/instance-state').InstanceViewState) => void>();
  ipcMain.handle(IPC_CHANNELS.getShellState, () => registry.state());
  ipcMain.handle(IPC_CHANNELS.updateGetState, () => desktopUpdateState);
  ipcMain.handle(IPC_CHANNELS.updateInstall, (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Update action is not authorized.');
    return installDownloadedUpdate();
  });
  ipcMain.on(IPC_CHANNELS.notificationContext, (event, instanceId: string, conversationId: string | null) => {
    if (event.sender !== mainWindow?.webContents) return;
    assertString(instanceId, 'Instance identity');
    if (conversationId !== null) assertString(conversationId, 'Conversation identity');
    notificationContext = { instanceId, conversationId: conversationId || '' };
  });
  ipcMain.on(IPC_CHANNELS.diagnostic, (event, diagnosticEvent: DesktopDiagnosticEvent, detail: string) => {
    if (event.sender !== mainWindow?.webContents) return;
    if (diagnosticEvent !== 'rnnoise_initialization_failed') return;
    if (typeof detail !== 'string') return;
    console.warn('[AllChat desktop diagnostic]', JSON.stringify({ event: diagnosticEvent, detail: detail.slice(0, 1_000) }));
  });
  ipcMain.handle(IPC_CHANNELS.windowControl, (event, action: import('../shared/desktop-bridge').WindowControlAction) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !['minimize', 'toggle-maximize', 'close'].includes(action)) throw new Error('Invalid window action');
    if (action === 'minimize') window.minimize();
    else if (action === 'toggle-maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    else window.close();
  });
  ipcMain.handle(IPC_CHANNELS.addInstance, (_event, input: AddInstanceInput) => {
    assertAddInstanceInput(input);
    const profile = registry.add(input);
    registry.select(profile.id);
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
  ipcMain.handle(IPC_CHANNELS.registerInstance, (_event, input: RegisterInstanceInput) => {
    assertLoginInput(input);
    assertString(input.invitationToken, 'Invitation token');
    return accounts.register(input);
  });
  ipcMain.handle(IPC_CHANNELS.recoverInstance, (_event, input: RecoverInstanceInput) => {
    assertString(input.instanceId, 'Instance identity');
    assertString(input.recoveryToken, 'Recovery token');
    assertString(input.password, 'Password');
    return accounts.recover(input);
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
  ipcMain.handle(IPC_CHANNELS.executeInstance, async (_event, id: string, action: import('../shared/instance-actions').InstanceAction) => {
    assertString(id, 'Instance identity');
    assertInstanceAction(action);
    const result = await coordinator.execute(id, action);
    if (action.type === 'set_presence' && id === registry.state().activeInstanceId) {
      trayPresence = action.mode;
      refreshTrayMenu();
    }
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.mediaOpen, async (event, id: string) => {
    assertString(id, 'Instance identity');
    const profile = registry.get(id);
    const token = profile.credentialRef ? await vault.get(profile.credentialRef) : null;
    if (!token) throw new Error('Sign in before starting a Call.');
    const url = new URL('/api/v1/media', profile.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socketId = crypto.randomUUID();
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    let closeReported = false;
    const reportClosed = (reason: string) => {
      if (closeReported) return;
      closeReported = true;
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.mediaClosed, socketId, reason);
    };
    mediaSockets.set(socketId, { owner: event.sender.id, socket });
    socket.on('message', (data) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.mediaFrame, socketId, String(data));
    });
    socket.on('close', (code, reason) => {
      mediaSockets.delete(socketId);
      const detail = reason.length ? `: ${String(reason)}` : '';
      reportClosed(`Media signaling closed (${code})${detail}`);
    });
    socket.on('error', (error) => {
      reportClosed(error.message);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return socketId;
  });
  ipcMain.on(IPC_CHANNELS.mediaSend, (event, socketId: string, frame: unknown) => {
    const entry = mediaSockets.get(socketId);
    if (entry?.owner === event.sender.id && entry.socket.readyState === WebSocket.OPEN) entry.socket.send(JSON.stringify(frame));
  });
  ipcMain.on(IPC_CHANNELS.mediaClose, (event, socketId: string) => {
    const entry = mediaSockets.get(socketId);
    if (entry?.owner === event.sender.id) { entry.socket.close(); mediaSockets.delete(socketId); }
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
    if (typeof value.direct !== 'boolean' || (value.before !== undefined && value.after !== undefined) || (value.before !== undefined && (!Number.isSafeInteger(value.before) || value.before < 1)) || (value.after !== undefined && (!Number.isSafeInteger(value.after) || value.after < 1)) || (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100))) throw new Error('Message page is invalid');
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
  if (value.type === 'set_community_notifications') {
    if (!['all_messages', 'mentions_only', 'nothing'].includes(value.level) || typeof value.muted !== 'boolean' || typeof value.soundEnabled !== 'boolean') throw new Error('Community notification policy is invalid');
    return;
  }
  if (value.type === 'set_channel_notifications') {
    assertString(value.channelId, 'Channel identity');
    if (!['default', 'all_messages', 'mentions_only', 'nothing'].includes(value.level) || typeof value.muted !== 'boolean') throw new Error('Channel notification policy is invalid');
    return;
  }
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
    assertAllowedAssetPath(value.path);
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
  if (value.type === 'report_activity') { if (typeof value.active !== 'boolean') throw new Error('Activity state is invalid'); return; }
  if (value.type === 'open_dm' || value.type === 'set_block') { assertString(value.memberId, 'Member identity'); if (value.type === 'set_block' && typeof value.blocked !== 'boolean') throw new Error('Block state is invalid'); return; }
  if (value.type === 'list_sessions') return;
  if (value.type === 'current_call' || value.type === 'turn_credentials') return;
  if (value.type === 'start_call') { assertString(value.directMessageId, 'Direct Message identity'); return; }
  if (value.type === 'call_action') {
    assertString(value.callId, 'Call identity');
    if (!['accept', 'decline', 'end'].includes(value.action)) throw new Error('Call action is invalid');
    return;
  }
  if (value.type === 'list_voice_participants') { assertString(value.channelId, 'Channel identity'); return; }
  if (value.type === 'moderate_voice_participant') {
    assertString(value.roomId, 'Voice Room identity'); assertString(value.memberId, 'Member identity');
    if (!['mute', 'unmute', 'disconnect'].includes(value.action)) throw new Error('Voice moderation action is invalid');
    return;
  }
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
  if (value.type === 'admin_dashboard' || value.type === 'list_roles' || value.type === 'list_invitations' || value.type === 'list_soundboard' || value.type === 'get_community_settings' || value.type === 'community_home') return;
  if (value.type === 'create_role' || value.type === 'update_role') {
    if (value.type === 'update_role') assertString(value.roleId, 'Role identity');
    assertString(value.name, 'Role name');
    if (!Number.isInteger(value.position) || !Array.isArray(value.permissions) || value.permissions.some((permission) => typeof permission !== 'string' || !permission)) throw new Error('Role is invalid');
    return;
  }
  if (value.type === 'retire_role') { assertString(value.roleId, 'Role identity'); return; }
  if (value.type === 'create_invitation') {
    if (!Number.isInteger(value.expiresInMinutes) || value.expiresInMinutes < 1 || !Number.isInteger(value.maxUses) || value.maxUses < 0) throw new Error('Invitation is invalid');
    return;
  }
  if (value.type === 'revoke_invitation') { assertString(value.invitationId, 'Invitation identity'); return; }
  if (value.type === 'create_category') { assertString(value.name, 'Category name'); if (!Number.isInteger(value.position)) throw new Error('Category is invalid'); return; }
  if (value.type === 'create_channel' || value.type === 'update_channel') {
    if (value.type === 'update_channel') assertString(value.channelId, 'Channel identity');
    assertString(value.categoryId, 'Category identity'); assertString(value.name, 'Channel name');
    if (!['text', 'voice'].includes(value.channelType) || !Number.isInteger(value.position)) throw new Error('Channel is invalid');
    return;
  }
  if (value.type === 'set_channel_archived') { assertString(value.channelId, 'Channel identity'); if (typeof value.archived !== 'boolean') throw new Error('Channel archive state is invalid'); return; }
  if (value.type === 'set_channel_override') {
    assertString(value.channelId, 'Channel identity'); assertString(value.roleId, 'Role identity'); assertString(value.permission, 'Permission');
    if (!['allow', 'deny', 'inherit'].includes(value.effect)) throw new Error('Channel override is invalid');
    return;
  }
  if (value.type === 'delete_channel') { assertString(value.channelId, 'Channel identity'); return; }
  if (value.type === 'upload_sound') {
    assertString(value.name, 'Sound name'); assertString(value.contentType, 'Sound content type');
    if (typeof value.emoji !== 'string' || !(value.data instanceof Uint8Array) || value.data.byteLength < 1 || value.data.byteLength > 1024 * 1024 || !Number.isInteger(value.position)) throw new Error('Sound is invalid');
    return;
  }
  if (value.type === 'update_sound') { assertString(value.soundId, 'Sound identity'); assertString(value.name, 'Sound name'); if (typeof value.emoji !== 'string' || !Number.isInteger(value.position)) throw new Error('Sound is invalid'); return; }
  if (value.type === 'delete_sound') { assertString(value.soundId, 'Sound identity'); return; }
  if (value.type === 'set_soundboard_limit') { if (!Number.isInteger(value.maxDurationMs) || value.maxDurationMs < 1_000 || value.maxDurationMs > 30_000) throw new Error('Soundboard limit is invalid'); return; }
  if (value.type === 'update_community_settings') {
    if (typeof value.name !== 'string' || value.name.trim().length < 1 || [...value.name].length > 100 || !Number.isInteger(value.maxAttachmentMiB) || value.maxAttachmentMiB < 1 || value.maxAttachmentMiB > 256 || typeof value.homeMarkdown !== 'string' || value.homeMarkdown.length > 100_000 || typeof value.pushRelayURL !== 'string') throw new Error('Community settings are invalid');
    if (value.pushRelayURL) { const relay = new URL(value.pushRelayURL); if (relay.protocol !== 'https:' && relay.protocol !== 'http:') throw new Error('Push relay URL is invalid'); }
    return;
  }
	if (value.type === 'update_community_avatar') { if (typeof value.contentType !== 'string' || !(value.data instanceof Uint8Array) || value.data.byteLength < 1 || value.data.byteLength > 8 * 1024 * 1024) throw new Error('Community avatar is invalid'); return; }
	if (value.type === 'remove_community_avatar') return;
  if (value.type === 'update_ringtone') { if (!['community','member'].includes(value.scope) || typeof value.contentType !== 'string' || !(value.data instanceof Uint8Array) || value.data.byteLength < 1 || value.data.byteLength > 2 * 1024 * 1024) throw new Error('Ringtone is invalid'); return; }
  if (value.type === 'remove_ringtone') { if (!['community','member'].includes(value.scope)) throw new Error('Ringtone scope is invalid'); return; }
  if (value.type === 'delete_account') { assertString(value.password, 'Password'); if (value.confirmation !== 'DELETE') throw new Error('Account deletion confirmation is invalid'); return; }
	if (value.type === 'set_member_disabled') { assertString(value.memberId, 'Member identity'); if (typeof value.disabled !== 'boolean') throw new Error('Member state is invalid'); return; }
	if (value.type === 'delete_member') { assertString(value.memberId, 'Member identity'); if (value.confirmation !== 'understood') throw new Error('Member deletion confirmation is invalid'); return; }
  throw new Error('Unsupported Instance action');
}

function assertBoundedText(value: unknown, label: string, minimum: number, maximum: number): asserts value is string {
  if (typeof value !== 'string' || value.trim().length < minimum || value.length > maximum) throw new Error(`${label} is invalid`);
}

function lockPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isAllowedRendererPermission(permission, BrowserWindow.fromWebContents(webContents) !== null));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    isAllowedRendererPermission(permission, !!webContents && BrowserWindow.fromWebContents(webContents) !== null));
}
