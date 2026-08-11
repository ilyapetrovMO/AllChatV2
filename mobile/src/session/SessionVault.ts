import * as Keychain from 'react-native-keychain';

import type {Member, NativeSession} from '../client/AllChatClient';

const vaultService = 'org.allchat.mobile.instances.v1';

export type InstanceAccount = {
  instance_url: string;
  member: Member;
  session_token: string;
  session_id: string;
  expires_at: string;
};

export interface SessionVault {
  list(): Promise<InstanceAccount[]>;
  put(instanceURL: string, session: NativeSession): Promise<InstanceAccount[]>;
  remove(instanceURL: string): Promise<InstanceAccount[]>;
}

export class KeychainSessionVault implements SessionVault {
  async list(): Promise<InstanceAccount[]> {
    const credentials = await Keychain.getGenericPassword({service: vaultService});
    if (!credentials) {
      return [];
    }
    const decoded: unknown = JSON.parse(credentials.password);
    if (!Array.isArray(decoded) || !decoded.every(isInstanceAccount)) {
      throw new Error('Secure account storage contains invalid data.');
    }
    return decoded;
  }

  async put(instanceURL: string, session: NativeSession): Promise<InstanceAccount[]> {
    const current = await this.list();
    const account = accountFromSession(instanceURL, session);
    return this.save([account, ...current.filter(item => item.instance_url !== instanceURL)]);
  }

  async remove(instanceURL: string): Promise<InstanceAccount[]> {
    const remaining = (await this.list()).filter(item => item.instance_url !== instanceURL);
    if (remaining.length === 0) {
      await Keychain.resetGenericPassword({service: vaultService});
      return [];
    }
    return this.save(remaining);
  }

  private async save(accounts: InstanceAccount[]): Promise<InstanceAccount[]> {
    const stored = await Keychain.setGenericPassword('instances', JSON.stringify(accounts), {
      service: vaultService,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    if (!stored) {
      throw new Error('Could not store accounts securely.');
    }
    return accounts;
  }
}

export class MemorySessionVault implements SessionVault {
  constructor(private accounts: InstanceAccount[] = []) {}

  async list(): Promise<InstanceAccount[]> {
    return [...this.accounts];
  }

  async put(instanceURL: string, session: NativeSession): Promise<InstanceAccount[]> {
    const account = accountFromSession(instanceURL, session);
    this.accounts = [account, ...this.accounts.filter(item => item.instance_url !== instanceURL)];
    return this.list();
  }

  async remove(instanceURL: string): Promise<InstanceAccount[]> {
    this.accounts = this.accounts.filter(item => item.instance_url !== instanceURL);
    return this.list();
  }
}

function accountFromSession(instanceURL: string, session: NativeSession): InstanceAccount {
  return {
    instance_url: instanceURL,
    member: session.member,
    session_token: session.session_token,
    session_id: session.session_id,
    expires_at: session.expires_at,
  };
}

function isInstanceAccount(value: unknown): value is InstanceAccount {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const account = value as Partial<InstanceAccount>;
  return typeof account.instance_url === 'string' &&
    typeof account.session_token === 'string' &&
    typeof account.session_id === 'string' &&
    typeof account.expires_at === 'string' &&
    !!account.member && typeof account.member.id === 'string' && typeof account.member.username === 'string';
}
