import { describe, expect, it, vi } from 'vitest';

import { registerDisplayMediaHandler } from './display-media';

describe('desktop display media', () => {
  it('registers a handler that lets the user choose a source and shares Windows audio', async () => {
    let handler: ((request: any, callback: (streams: any) => void) => void) | undefined;
    const source = { id: 'screen:1:0', name: 'Entire Screen' };
    const callback = vi.fn();
    registerDisplayMediaHandler({
      setHandler: (value) => { handler = value; },
      getSources: vi.fn(async () => [source] as any),
      showPicker: vi.fn(async () => 0),
      isAllowedFrame: () => true,
      platform: 'win32',
    });

    handler?.({ frame: {}, videoRequested: true, audioRequested: true }, callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith({ video: source, audio: 'loopback' }));
  });

  it('denies capture when the request is not from the app', async () => {
    let handler: ((request: any, callback: (streams: any) => void) => void) | undefined;
    const callback = vi.fn();
    registerDisplayMediaHandler({
      setHandler: (value) => { handler = value; },
      getSources: vi.fn(async () => [{ id: 'screen:1:0', name: 'Entire Screen' }] as any),
      showPicker: vi.fn(async () => null),
      isAllowedFrame: () => false,
      platform: 'win32',
    });

    handler?.({ frame: {}, videoRequested: true, audioRequested: true }, callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith({}));
  });

  it('denies capture when the user cancels the picker', async () => {
    let handler: ((request: any, callback: (streams: any) => void) => void) | undefined;
    const callback = vi.fn();
    registerDisplayMediaHandler({
      setHandler: (value) => { handler = value; },
      getSources: vi.fn(async () => [{ id: 'screen:1:0', name: 'Entire Screen' }] as any),
      showPicker: vi.fn(async () => null),
      isAllowedFrame: () => true,
      platform: 'win32',
    });

    handler?.({ frame: {}, videoRequested: true, audioRequested: true }, callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith({}));
  });
});
