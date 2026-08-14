import {NativeModules, Platform} from 'react-native';
import notifee, {AuthorizationStatus} from '@notifee/react-native';

import {AllChatClient, type MobilePushRegistration} from '../client/AllChatClient';
import type {InstanceAccount} from '../session/SessionVault';

type NativePush = {getRegistration(): Promise<Omit<MobilePushRegistration, 'instance_url'> | null>};
const nativePush = NativeModules.AllChatPush as NativePush | undefined;

export async function currentMobilePushRegistration(instanceURL: string): Promise<MobilePushRegistration | undefined> {
  if (Platform.OS !== 'android' || !nativePush) return undefined;
  const permission = await notifee.requestPermission();
  if (permission.authorizationStatus === AuthorizationStatus.DENIED) return undefined;
  const registration = await nativePush.getRegistration();
  return registration ? {...registration, instance_url: instanceURL} : undefined;
}

export async function syncMobilePush(account: InstanceAccount): Promise<void> {
  const registration = await currentMobilePushRegistration(account.instance_url);
  if (!registration) return;
  await new AllChatClient(account.instance_url).registerMobilePush(account.session_token, registration);
}

export async function removeMobilePush(account: InstanceAccount): Promise<void> {
  const registration = await currentMobilePushRegistration(account.instance_url);
  if (!registration) return;
  await new AllChatClient(account.instance_url).unregisterMobilePush(account.session_token, registration.token);
}
