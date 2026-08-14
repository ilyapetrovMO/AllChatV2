import { NativeModules } from 'react-native';

type MediaSaverModule = {
  save(
    url: string,
    token: string,
    filename: string,
    mimeType: string,
  ): Promise<'download' | 'share'>;
};

export async function saveMedia(
  url: string,
  token: string,
  filename: string,
  mimeType: string,
) {
  const saver = NativeModules.AllChatMediaSaver as MediaSaverModule | undefined;
  if (!saver?.save)
    throw new Error('Media saving is unavailable in this build.');
  return saver.save(url, token, filename, mimeType);
}
