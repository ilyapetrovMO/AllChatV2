jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {registerForegroundService: jest.fn(), createChannel: jest.fn(async () => 'calls'), displayNotification: jest.fn(async () => {}), stopForegroundService: jest.fn(async () => {})},
  AndroidCategory: {CALL: 'call'}, AndroidImportance: {LOW: 2},
  AndroidForegroundServiceType: {FOREGROUND_SERVICE_TYPE_MICROPHONE: 128, FOREGROUND_SERVICE_TYPE_CAMERA: 64},
}));

import notifee from '@notifee/react-native';
import {startCallForegroundService, stopCallForegroundService, updateCallForegroundService} from '../src/media/CallForegroundService';

beforeEach(() => jest.clearAllMocks());
afterEach(() => stopCallForegroundService());

it('does not display a notification after stop overtakes channel creation', async () => {
  let finish!: (channel: string) => void;
  jest.mocked(notifee.createChannel).mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const starting = startCallForegroundService('Room');
  await Promise.resolve(); await Promise.resolve();
  const stopping = stopCallForegroundService();
  finish('calls');
  await Promise.all([starting, stopping]);
  expect(notifee.displayNotification).not.toHaveBeenCalled();
  expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
});

it('keeps projection ownership separate and ignores updates after stop', async () => {
  await startCallForegroundService('Room');
  await updateCallForegroundService(true, true);
  expect(notifee.displayNotification).toHaveBeenLastCalledWith(expect.objectContaining({android: expect.objectContaining({foregroundServiceTypes: [128, 64]})}));
  await stopCallForegroundService();
  const displayed = jest.mocked(notifee.displayNotification).mock.calls.length;
  await updateCallForegroundService(true, true);
  expect(notifee.displayNotification).toHaveBeenCalledTimes(displayed);
});
