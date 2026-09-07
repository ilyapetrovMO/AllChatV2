import notifee, {AndroidCategory, AndroidForegroundServiceType, AndroidImportance} from '@notifee/react-native';

let registered = false;
let finish: (() => void) | undefined;
let currentLabel = 'Active media session';
let active = false, revision = 0;
let operations = Promise.resolve();
const enqueue = (operation: () => Promise<void>) => { const result = operations.catch(() => {}).then(operation); operations = result.catch(() => {}); return result; };

function register() {
  if (registered) return;
  registered = true;
  notifee.registerForegroundService(() => new Promise<void>(resolve => { finish = resolve; }));
}

export async function startCallForegroundService(label: string): Promise<void> {
  register();
  active = true; revision++;
  currentLabel = label;
  await updateCallForegroundService(false, false);
}

export async function updateCallForegroundService(camera: boolean, screen: boolean): Promise<void> {
  const generation = revision;
  return enqueue(async () => {
  if (!active || generation !== revision) return;
  const channelId = await notifee.createChannel({id: 'calls', name: 'Calls', importance: AndroidImportance.LOW});
  const foregroundServiceTypes = [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE];
  if (camera) foregroundServiceTypes.push(AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_CAMERA);
  // react-native-webrtc owns the projection service and its consent lifetime.
  void screen;
  if (!active || generation !== revision) return;
  await notifee.displayNotification({id: 'active-media-session', title: 'AllChat call in progress', body: currentLabel, android: {channelId, asForegroundService: true, category: AndroidCategory.CALL, foregroundServiceTypes, ongoing: true, pressAction: {id: 'default'}}});
  });
}

export async function stopCallForegroundService(): Promise<void> {
  active = false; const generation = ++revision;
  return enqueue(async () => {
    if (generation !== revision) return;
    await notifee.stopForegroundService();
    finish?.(); finish = undefined;
  });
}
