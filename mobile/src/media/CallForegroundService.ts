import notifee, {AndroidCategory, AndroidForegroundServiceType, AndroidImportance} from '@notifee/react-native';

let registered = false;
let finish: (() => void) | undefined;
let currentLabel = 'Active media session';

function register() {
  if (registered) return;
  registered = true;
  notifee.registerForegroundService(() => new Promise<void>(resolve => { finish = resolve; }));
}

export async function startCallForegroundService(label: string): Promise<void> {
  register();
  currentLabel = label;
  await updateCallForegroundService(false, false);
}

export async function updateCallForegroundService(camera: boolean, screen: boolean): Promise<void> {
  const channelId = await notifee.createChannel({id: 'calls', name: 'Calls', importance: AndroidImportance.LOW});
  const foregroundServiceTypes = [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE];
  if (camera) foregroundServiceTypes.push(AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_CAMERA);
  if (screen) foregroundServiceTypes.push(AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
  await notifee.displayNotification({id: 'active-media-session', title: 'AllChat call in progress', body: currentLabel, android: {channelId, asForegroundService: true, category: AndroidCategory.CALL, foregroundServiceTypes, ongoing: true, pressAction: {id: 'default'}}});
}

export async function stopCallForegroundService(): Promise<void> {
  await notifee.stopForegroundService();
  finish?.(); finish = undefined;
}
