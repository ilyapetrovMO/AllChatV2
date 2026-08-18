import { contextBridge, ipcRenderer } from 'electron';

import {
  IPC_CHANNELS,
  type AddInstanceInput,
  type DesktopBridge,
  type LoginInstanceInput,
  type ShellState,
} from '../shared/desktop-bridge';

const bridge: DesktopBridge = Object.freeze({
  getShellState: () => ipcRenderer.invoke(IPC_CHANNELS.getShellState) as Promise<ShellState>,
  addInstance: (input: AddInstanceInput) => ipcRenderer.invoke(IPC_CHANNELS.addInstance, input),
  selectInstance: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.selectInstance, id),
  loginInstance: (input: LoginInstanceInput) => ipcRenderer.invoke(IPC_CHANNELS.loginInstance, input),
  logoutInstance: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.logoutInstance, instanceId),
  loadInstance: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.loadInstance, instanceId),
});

contextBridge.exposeInMainWorld('allchatDesktop', bridge);
