import { NativeModules } from 'react-native';

import { saveMedia } from '../src/media/MediaSaver';

describe('saveMedia', () => {
  afterEach(() => {
    delete NativeModules.AllChatMediaSaver;
  });

  it('passes authentication and attachment metadata to the native saver', async () => {
    const save = jest.fn().mockResolvedValue('download');
    NativeModules.AllChatMediaSaver = { save };

    await expect(
      saveMedia(
        'https://chat.test/media/1',
        'secret',
        'photo.webp',
        'image/webp',
      ),
    ).resolves.toBe('download');
    expect(save).toHaveBeenCalledWith(
      'https://chat.test/media/1',
      'secret',
      'photo.webp',
      'image/webp',
    );
  });

  it('reports builds without the native saver', async () => {
    await expect(
      saveMedia(
        'https://chat.test/media/1',
        'secret',
        'photo.webp',
        'image/webp',
      ),
    ).rejects.toThrow('Media saving is unavailable in this build.');
  });
});
