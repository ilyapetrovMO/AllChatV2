import {NativeModules} from 'react-native';

type NativeUpdater = {
  appVersion: string;
  download(url: string, token: string, filename: string): Promise<string>;
};

const nativeUpdater = NativeModules.AllChatUpdater as NativeUpdater | undefined;

export const APP_VERSION = nativeUpdater?.appVersion || 'dev';

export function isNewerVersion(server: string, client = APP_VERSION): boolean {
  const parse = (value: string) => value.replace(/^v/, '').split('.').map(part => Number(part));
  if (!/^v?\d+\.\d+\.\d+$/.test(server) || !/^v?\d+\.\d+\.\d+$/.test(client)) return false;
  const left = parse(server), right = parse(client);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

export async function downloadUpdate(instanceURL: string, token: string, version: string): Promise<string> {
  if (!nativeUpdater) throw new Error('Android updates are unavailable in this build.');
  const filename = `AllChat-mobile-${version.replace(/^v/, '')}-android-universal.apk`;
  return nativeUpdater.download(`${instanceURL}/api/v1/updates/android.apk`, token, filename);
}
