import * as Keychain from 'react-native-keychain';

export type VoiceVideoSettings = {
  version: 1;
  microphoneID: string;
  speakerID: string;
  cameraID: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  noiseSuppressionMode: 'standard' | 'enhanced' | 'off';
  autoGainControl: boolean;
  inputGain: number;
  outputVolume: number;
  memberVolumes: Record<string, number>;
  noiseGate: boolean;
  noiseGateThresholdDB: number;
};

export const DEFAULT_VOICE_VIDEO_SETTINGS: VoiceVideoSettings = Object.freeze({
  version: 1, microphoneID: '', speakerID: '', cameraID: '',
  echoCancellation: true, noiseSuppression: true, noiseSuppressionMode: 'standard', autoGainControl: false,
  inputGain: 1, outputVolume: 1, memberVolumes: {}, noiseGate: true, noiseGateThresholdDB: -50,
});

const clamp = (value: unknown, minimum: number, maximum: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
const text = (value: unknown) => typeof value === 'string' ? value : '';
const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;

export function normalizeVoiceVideoSettings(value: unknown): VoiceVideoSettings {
  const source = value && typeof value === 'object' ? value as Partial<VoiceVideoSettings> : {};
  const memberVolumes = source.memberVolumes && typeof source.memberVolumes === 'object' ? Object.fromEntries(Object.entries(source.memberVolumes).map(([id, volume]) => [id, clamp(volume, 0, 1, 1)])) : {};
  return {
    version: 1, microphoneID: text(source.microphoneID), speakerID: text(source.speakerID), cameraID: text(source.cameraID),
    echoCancellation: bool(source.echoCancellation, true), noiseSuppression: bool(source.noiseSuppression, true), noiseSuppressionMode: source.noiseSuppressionMode === 'enhanced' || source.noiseSuppressionMode === 'off' ? source.noiseSuppressionMode : 'standard', autoGainControl: bool(source.autoGainControl, false),
    inputGain: clamp(source.inputGain, 0, 2, 1), outputVolume: clamp(source.outputVolume, 0, 1, 1), memberVolumes,
    noiseGate: bool(source.noiseGate, true), noiseGateThresholdDB: clamp(source.noiseGateThresholdDB, -80, -20, -50),
  };
}

export function voiceAudioConstraints(settings: VoiceVideoSettings) {
  return {
    ...(settings.microphoneID ? {deviceId: {ideal: settings.microphoneID}} : {}),
    // react-native-webrtc forwards these directly to native WebRTC's
    // MediaConstraints parser, which uses the legacy `goog*` audio keys.
    googEchoCancellation: settings.echoCancellation,
    // Until the owned WebRTC fork confirms enhanced processing on the native
    // audio thread, keep baseline WebRTC suppression enabled. The fork consumes
    // googAllChatRNNoise and atomically disables its standard NS only after the
    // RNNoise state is ready, so an unsupported wrapper always fails open.
    googNoiseSuppression: settings.noiseSuppressionMode !== 'off' && settings.noiseSuppression,
    googAllChatRNNoise: settings.noiseSuppressionMode === 'enhanced' && settings.noiseSuppression,
    googAllChatNoiseGate: settings.noiseGate,
    googAllChatNoiseGateThresholdDB: settings.noiseGateThresholdDB,
    googAutoGainControl: settings.autoGainControl,
  };
}

export interface VoiceVideoSettingsStore {
  load(instanceURL: string, memberID: string): Promise<VoiceVideoSettings>;
  save(instanceURL: string, memberID: string, settings: VoiceVideoSettings): Promise<void>;
}

const service = (instanceURL: string, memberID: string) => `org.allchat.mobile.voice-video.v1:${instanceURL}:${memberID}`;

export class KeychainVoiceVideoSettingsStore implements VoiceVideoSettingsStore {
  async load(instanceURL: string, memberID: string) {
    try {
      const stored = await Keychain.getGenericPassword({service: service(instanceURL, memberID)});
      return normalizeVoiceVideoSettings(stored ? JSON.parse(stored.password) : undefined);
    } catch { return {...DEFAULT_VOICE_VIDEO_SETTINGS}; }
  }
  async save(instanceURL: string, memberID: string, settings: VoiceVideoSettings) {
    await Keychain.setGenericPassword('voice-video', JSON.stringify(normalizeVoiceVideoSettings(settings)), {service: service(instanceURL, memberID), accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY});
  }
}

export class MemoryVoiceVideoSettingsStore implements VoiceVideoSettingsStore {
  private values = new Map<string, VoiceVideoSettings>();
  async load(instanceURL: string, memberID: string) { return normalizeVoiceVideoSettings(this.values.get(service(instanceURL, memberID))); }
  async save(instanceURL: string, memberID: string, settings: VoiceVideoSettings) { this.values.set(service(instanceURL, memberID), normalizeVoiceVideoSettings(settings)); }
}
