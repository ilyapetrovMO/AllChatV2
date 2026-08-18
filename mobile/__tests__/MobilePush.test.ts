import notifee, {AuthorizationStatus} from '@notifee/react-native';
import {NativeModules, Platform} from 'react-native';

const getNotificationSettings = notifee.getNotificationSettings as jest.Mock;
const requestPermission = notifee.requestPermission as jest.Mock;
const getRegistration = jest.fn();
NativeModules.AllChatPush = {getRegistration};
const {currentMobilePushRegistration} = require('../src/notifications/MobilePush') as typeof import('../src/notifications/MobilePush');

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', {configurable: true, value: 'android'});
  getRegistration.mockResolvedValue({platform: 'android', token: 'device-token', public_key: 'public-key'});
});

test('does not reopen the permission flow after notifications are authorized', async () => {
  getNotificationSettings.mockResolvedValue({authorizationStatus: AuthorizationStatus.AUTHORIZED});

  await expect(currentMobilePushRegistration('https://community.example')).resolves.toEqual({
    platform: 'android', token: 'device-token', public_key: 'public-key', instance_url: 'https://community.example',
  });
  expect(requestPermission).not.toHaveBeenCalled();
});

test('requests notification permission only when authorization is undetermined', async () => {
  getNotificationSettings.mockResolvedValue({authorizationStatus: AuthorizationStatus.NOT_DETERMINED});
  requestPermission.mockResolvedValue({authorizationStatus: AuthorizationStatus.AUTHORIZED});

  await currentMobilePushRegistration('https://community.example');

  expect(requestPermission).toHaveBeenCalledTimes(1);
});
