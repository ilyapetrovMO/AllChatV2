export interface InstanceProfile {
  id: string;
  displayName: string;
  baseUrl: string;
  partition: string;
  credentialRef: string | null;
  session?: DesktopSessionSummary;
}

export interface MemberSummary {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  owner: boolean;
}

export interface DesktopSessionSummary {
  member: MemberSummary;
  sessionId: string;
  expiresAt: string;
}

export interface LoginInstanceInput {
  instanceId: string;
  username: string;
  password: string;
}
export interface RegisterInstanceInput extends LoginInstanceInput { invitationToken: string }
export interface RecoverInstanceInput { instanceId: string; recoveryToken: string; password: string }

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
  addInstance(input: AddInstanceInput): Promise<ShellState>;
  selectInstance(id: string): Promise<ShellState>;
  loginInstance(input: LoginInstanceInput): Promise<ShellState>;
  registerInstance(input: RegisterInstanceInput): Promise<ShellState>;
  recoverInstance(input: RecoverInstanceInput): Promise<ShellState>;
  logoutInstance(instanceId: string): Promise<ShellState>;
  loadInstance(instanceId: string): Promise<import('./instance-state').InstanceViewState>;
  watchInstance(instanceId: string, listener: (state: import('./instance-state').InstanceViewState) => void): () => void;
  executeInstance(instanceId: string, action: import('./instance-actions').InstanceAction): Promise<import('./instance-actions').InstanceActionResult>;
  connectMedia?(instanceId: string, listener: (frame: unknown) => void, closed: (reason: string) => void): Promise<DesktopMediaConnection>;
}

export interface DesktopMediaConnection { send(frame: unknown): void; close(): void }

export const DESKTOP_BRIDGE_METHODS = [
  'getShellState',
  'addInstance',
  'selectInstance',
  'loginInstance',
  'registerInstance',
  'recoverInstance',
  'logoutInstance',
  'loadInstance',
  'watchInstance',
  'executeInstance',
  'connectMedia',
] as const satisfies readonly (keyof DesktopBridge)[];

export const IPC_CHANNELS = {
  getShellState: 'allchat:shell:get-state',
  addInstance: 'allchat:instance:add',
  selectInstance: 'allchat:instance:select',
  loginInstance: 'allchat:instance:login',
  registerInstance: 'allchat:instance:register',
  recoverInstance: 'allchat:instance:recover',
  logoutInstance: 'allchat:instance:logout',
  loadInstance: 'allchat:instance:load',
  watchInstance: 'allchat:instance:watch',
  unwatchInstance: 'allchat:instance:unwatch',
  instanceStateChanged: 'allchat:instance:state-changed',
  executeInstance: 'allchat:instance:execute',
  mediaOpen: 'allchat:media:open',
  mediaSend: 'allchat:media:send',
  mediaClose: 'allchat:media:close',
  mediaFrame: 'allchat:media:frame',
  mediaClosed: 'allchat:media:closed',
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
