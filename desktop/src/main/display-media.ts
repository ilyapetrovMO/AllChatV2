import type { DesktopCapturerSource, WebFrameMain } from 'electron';

type DisplayMediaRequest = {
  frame: WebFrameMain | null;
  videoRequested: boolean;
  audioRequested: boolean;
};

type DisplayMediaStreams = {
  video?: DesktopCapturerSource;
  audio?: 'loopback';
};

type DisplayMediaHandler = (
  request: DisplayMediaRequest,
  callback: (streams: DisplayMediaStreams) => void,
) => void;

export type DisplayMediaDependencies = {
  setHandler(handler: DisplayMediaHandler): void;
  getSources(): Promise<DesktopCapturerSource[]>;
  showPicker(sources: DesktopCapturerSource[]): Promise<number | null>;
  isAllowedFrame(frame: WebFrameMain): boolean;
  platform: NodeJS.Platform;
};

export function registerDisplayMediaHandler(dependencies: DisplayMediaDependencies): void {
  dependencies.setHandler((request, callback) => {
    void handleDisplayMediaRequest(request, callback, dependencies);
  });
}

async function handleDisplayMediaRequest(
  request: DisplayMediaRequest,
  callback: (streams: DisplayMediaStreams) => void,
  dependencies: DisplayMediaDependencies,
): Promise<void> {
  if (!request.videoRequested || !request.frame || !dependencies.isAllowedFrame(request.frame)) {
    callback({});
    return;
  }

  try {
    const sources = await dependencies.getSources();
    if (!sources.length) {
      callback({});
      return;
    }
    const selectedIndex = await dependencies.showPicker(sources);
    const selected = selectedIndex === null ? undefined : sources[selectedIndex];
    if (!selected) {
      callback({});
      return;
    }
    callback({
      video: selected,
      ...(request.audioRequested && dependencies.platform === 'win32' ? { audio: 'loopback' as const } : {}),
    });
  } catch (error) {
    console.warn('AllChat desktop screen-source selection failed:', error instanceof Error ? error.message : String(error));
    callback({});
  }
}
