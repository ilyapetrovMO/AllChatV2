import * as Keychain from 'react-native-keychain';

import type {MobileBootstrap} from '../client/bootstrap';

export interface ConversationCache {
  load(instanceURL: string, memberID: string): Promise<MobileBootstrap | undefined>;
  save(instanceURL: string, memberID: string, snapshot: MobileBootstrap): Promise<void>;
  clear(instanceURL: string, memberID: string): Promise<void>;
}

export class KeychainConversationCache implements ConversationCache {
  async load(instanceURL: string, memberID: string): Promise<MobileBootstrap | undefined> {
    const stored = await Keychain.getGenericPassword({service: cacheService(instanceURL, memberID)});
    if (!stored) return undefined;
    const decoded: unknown = JSON.parse(stored.password);
    if (!isBootstrap(decoded, memberID)) {
      await this.clear(instanceURL, memberID);
      return undefined;
    }
    return decoded;
  }

  async save(instanceURL: string, memberID: string, snapshot: MobileBootstrap): Promise<void> {
    const stored = await Keychain.setGenericPassword('snapshot', JSON.stringify(snapshotForCache(snapshot)), {
      service: cacheService(instanceURL, memberID),
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    if (!stored) throw new Error('Could not cache conversations securely.');
  }

  async clear(instanceURL: string, memberID: string): Promise<void> {
    await Keychain.resetGenericPassword({service: cacheService(instanceURL, memberID)});
  }
}

export class MemoryConversationCache implements ConversationCache {
  private snapshots = new Map<string, MobileBootstrap>();
  async load(instanceURL: string, memberID: string) { return this.snapshots.get(cacheService(instanceURL, memberID)); }
  async save(instanceURL: string, memberID: string, snapshot: MobileBootstrap) { this.snapshots.set(cacheService(instanceURL, memberID), snapshotForCache(snapshot)); }
  async clear(instanceURL: string, memberID: string) { this.snapshots.delete(cacheService(instanceURL, memberID)); }
}

function snapshotForCache(snapshot: MobileBootstrap): MobileBootstrap {
  const messages = Object.fromEntries(Object.entries(snapshot.messages).map(([channelID, items]) => [channelID, items.slice(-50)]));
  return {...snapshot, messages, presence: {}, typing: []};
}

function cacheService(instanceURL: string, memberID: string) {
  return `org.allchat.mobile.cache.v1.${encodeURIComponent(instanceURL)}.${encodeURIComponent(memberID)}`;
}

function isBootstrap(value: unknown, memberID: string): value is MobileBootstrap {
  if (!value || typeof value !== 'object') return false;
  const bootstrap = value as Partial<MobileBootstrap>;
  return bootstrap.version === 1 && bootstrap.member?.id === memberID && !!bootstrap.messages && Array.isArray(bootstrap.channels);
}
