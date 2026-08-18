import { contextBridge, ipcRenderer } from 'electron';

import {
  IPC_CHANNELS,
  type AddInstanceInput,
  type DesktopBridge,
  type LoginInstanceInput,
  type ShellState,
} from '../shared/desktop-bridge';
import type { InstanceViewState } from '../shared/instance-state';
import type { InstanceAction } from '../shared/instance-actions';

const bridge: DesktopBridge = Object.freeze({
  getShellState: () => ipcRenderer.invoke(IPC_CHANNELS.getShellState) as Promise<ShellState>,
  addInstance: (input: AddInstanceInput) => ipcRenderer.invoke(IPC_CHANNELS.addInstance, input),
  selectInstance: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.selectInstance, id),
  loginInstance: (input: LoginInstanceInput) => ipcRenderer.invoke(IPC_CHANNELS.loginInstance, input),
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
});

contextBridge.exposeInMainWorld('allchatDesktop', bridge);
