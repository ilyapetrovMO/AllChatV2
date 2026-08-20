import {NativeModules, Platform} from 'react-native';

type NativeInCallManager = {
  start?(media: 'audio' | 'video', auto: boolean, ringback: string): void;
  stop?(busytone: string): void;
  setForceSpeakerphoneOn?(flag: number): void;
  requestAudioFocusJS?(): Promise<unknown>;
  abandonAudioFocusJS?(): Promise<unknown>;
  setMicrophoneMute?(enable: boolean): void;
};

function manager(): NativeInCallManager | undefined {
  return NativeModules.InCallManager as NativeInCallManager | undefined;
}

export function startCallAudioSession(): void {
  const native = manager();
  if (!native) return;
  native.start?.('video', true, '');
  native.setMicrophoneMute?.(false);
  native.setForceSpeakerphoneOn?.(1);
  if (Platform.OS === 'android') native.requestAudioFocusJS?.().catch(() => {});
}

export function stopCallAudioSession(): void {
  const native = manager();
  if (!native) return;
  native.setMicrophoneMute?.(false);
  native.setForceSpeakerphoneOn?.(-1);
  if (Platform.OS === 'android') native.abandonAudioFocusJS?.().catch(() => {});
  native.stop?.('');
}

export function setCallMicrophoneMuted(muted: boolean): void {
  manager()?.setMicrophoneMute?.(muted);
}
