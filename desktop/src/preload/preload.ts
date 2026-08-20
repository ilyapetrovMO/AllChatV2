import { contextBridge, ipcRenderer } from 'electron';

import {
  IPC_CHANNELS,
  type AddInstanceInput,
  type DesktopBridge,
  type LoginInstanceInput,
  type RecoverInstanceInput,
  type RegisterInstanceInput,
  type ShellState,
  type WindowControlAction,
} from '../shared/desktop-bridge';
import type { InstanceViewState } from '../shared/instance-state';
import type { InstanceAction } from '../shared/instance-actions';

const bridge: DesktopBridge = Object.freeze({
  controlWindow: (action: WindowControlAction) => ipcRenderer.invoke(IPC_CHANNELS.windowControl, action),
  setNotificationContext: (instanceId: string, conversationId: string | null) => ipcRenderer.send(IPC_CHANNELS.notificationContext, instanceId, conversationId),
  getShellState: () => ipcRenderer.invoke(IPC_CHANNELS.getShellState) as Promise<ShellState>,
  addInstance: (input: AddInstanceInput) => ipcRenderer.invoke(IPC_CHANNELS.addInstance, input),
  selectInstance: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.selectInstance, id),
  loginInstance: (input: LoginInstanceInput) => ipcRenderer.invoke(IPC_CHANNELS.loginInstance, input),
  registerInstance: (input: RegisterInstanceInput) => ipcRenderer.invoke(IPC_CHANNELS.registerInstance, input),
  recoverInstance: (input: RecoverInstanceInput) => ipcRenderer.invoke(IPC_CHANNELS.recoverInstance, input),
  logoutInstance: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.logoutInstance, instanceId),
  loadInstance: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.loadInstance, instanceId),
  watchInstance: (instanceId: string, listener: (state: InstanceViewState) => void) => {
    const receive = (_event: Electron.IpcRendererEvent, changedId: string, state: InstanceViewState) => {
      if (changedId === instanceId) listener(state);
    };
    ipcRenderer.on(IPC_CHANNELS.instanceStateChanged, receive);
    ipcRenderer.send(IPC_CHANNELS.watchInstance, instanceId);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.instanceStateChanged, receive);
      ipcRenderer.send(IPC_CHANNELS.unwatchInstance, instanceId);
    };
  },
  executeInstance: (instanceId: string, action: InstanceAction) => ipcRenderer.invoke(IPC_CHANNELS.executeInstance, instanceId, action),
  connectMedia: async (instanceId: string, listener: (frame: unknown) => void, closed: (reason: string) => void) => {
    const socketId = await ipcRenderer.invoke(IPC_CHANNELS.mediaOpen, instanceId) as string;
    const receive = (_event: Electron.IpcRendererEvent, changedId: string, encoded: string) => {
      if (changedId === socketId) listener(JSON.parse(encoded));
    };
    const receiveClose = (_event: Electron.IpcRendererEvent, changedId: string, reason: string) => {
      if (changedId === socketId) closed(reason);
    };
    ipcRenderer.on(IPC_CHANNELS.mediaFrame, receive);
    ipcRenderer.on(IPC_CHANNELS.mediaClosed, receiveClose);
    return {
      send: (frame: unknown) => ipcRenderer.send(IPC_CHANNELS.mediaSend, socketId, frame),
      close: () => {
        ipcRenderer.removeListener(IPC_CHANNELS.mediaFrame, receive);
        ipcRenderer.removeListener(IPC_CHANNELS.mediaClosed, receiveClose);
        ipcRenderer.send(IPC_CHANNELS.mediaClose, socketId);
      },
    };
  },
});

contextBridge.exposeInMainWorld('allchatDesktop', bridge);
