import { contextBridge, ipcRenderer } from 'electron';

import {
  IPC_CHANNELS,
  type AddInstanceInput,
  type DesktopBridge,
  type ShellState,
} from '../shared/desktop-bridge';

const bridge: DesktopBridge = Object.freeze({
  getShellState: () => ipcRenderer.invoke(IPC_CHANNELS.getShellState) as Promise<ShellState>,
  addInstance: (input: AddInstanceInput) => ipcRenderer.invoke(IPC_CHANNELS.addInstance, input),
  selectInstance: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.selectInstance, id),
});

contextBridge.exposeInMainWorld('allchatDesktop', bridge);
