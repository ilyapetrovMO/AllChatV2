export interface InstanceProfile {
  id: string;
  displayName: string;
  baseUrl: string;
  partition: string;
  credentialRef: string | null;
}

export interface AddInstanceInput {
  displayName: string;
  baseUrl: string;
}

export interface ShellState {
  instances: InstanceProfile[];
  activeInstanceId: string | null;
}

export interface DesktopBridge {
  getShellState(): Promise<ShellState>;
  addInstance(input: AddInstanceInput): Promise<void>;
  selectInstance(id: string): Promise<void>;
}

export const DESKTOP_BRIDGE_METHODS = [
  'getShellState',
  'addInstance',
  'selectInstance',
] as const satisfies readonly (keyof DesktopBridge)[];

export const IPC_CHANNELS = {
  getShellState: 'allchat:shell:get-state',
  addInstance: 'allchat:instance:add',
  selectInstance: 'allchat:instance:select',
} as const;

export function isDesktopBridge(value: unknown): value is DesktopBridge {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const allowed = [...DESKTOP_BRIDGE_METHODS].sort();
  return keys.length === allowed.length &&
    keys.every((key, index) => key === allowed[index]) &&
    allowed.every((key) => typeof record[key] === 'function');
}
