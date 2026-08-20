import {NativeModules, Platform} from 'react-native';
import notifee, {AuthorizationStatus} from '@notifee/react-native';

import {AllChatClient, type MobilePushRegistration} from '../client/AllChatClient';
import type {InstanceAccount} from '../session/SessionVault';

type NativePush = {
  getRegistration(): Promise<Omit<MobilePushRegistration, 'instance_url'> | null>;
  cacheAvatar?(avatarURL: string, avatarVersion: string, dataURI: string): void;
};
const nativePush = NativeModules.AllChatPush as NativePush | undefined;

export function cachePushAvatar(avatarURL: string, avatarVersion: string, dataURI: string): void {
  if (Platform.OS === 'android') nativePush?.cacheAvatar?.(avatarURL, avatarVersion, dataURI);
}

export async function currentMobilePushRegistration(instanceURL: string): Promise<MobilePushRegistration | undefined> {
  if (Platform.OS !== 'android' || !nativePush) return undefined;
  let permission = await notifee.getNotificationSettings();
  if (permission.authorizationStatus === AuthorizationStatus.NOT_DETERMINED) {
    permission = await notifee.requestPermission();
  }
  if (permission.authorizationStatus === AuthorizationStatus.DENIED) return undefined;
  const registration = await nativePush.getRegistration();
  return registration ? {...registration, instance_url: instanceURL} : undefined;
}

export async function syncMobilePush(account: InstanceAccount): Promise<void> {
  const registration = await currentMobilePushRegistration(account.instance_url);
  if (!registration) {
    console.warn('[AllChatPush] Mobile push registration is unavailable');
    return;
  }
  try {
    await new AllChatClient(account.instance_url).registerMobilePush(account.session_token, registration);
    console.info('[AllChatPush] Mobile push subscription registered');
  } catch (error) {
    console.warn('[AllChatPush] Mobile push subscription registration failed', error);
    throw error;
  }
}

export async function removeMobilePush(account: InstanceAccount): Promise<void> {
  const registration = await currentMobilePushRegistration(account.instance_url);
  if (!registration) return;
  await new AllChatClient(account.instance_url).unregisterMobilePush(account.session_token, registration.token);
}
