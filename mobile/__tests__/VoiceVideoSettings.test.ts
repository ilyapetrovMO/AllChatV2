import {DEFAULT_VOICE_VIDEO_SETTINGS, MemoryVoiceVideoSettingsStore, normalizeVoiceVideoSettings, voiceAudioConstraints} from '../src/media/VoiceVideoSettings';

describe('Voice & Video settings', () => {
  it('uses a conservative clean-voice profile and clamps persisted values', () => {
    expect(DEFAULT_VOICE_VIDEO_SETTINGS).toMatchObject({echoCancellation: true, noiseSuppression: true, noiseSuppressionMode: 'standard', autoGainControl: false, noiseGate: true, noiseGateThresholdDB: -50, inputGain: 1, outputVolume: 1});
    expect(normalizeVoiceVideoSettings({inputGain: 9, outputVolume: -1, noiseGateThresholdDB: -100})).toMatchObject({inputGain: 2, outputVolume: 0, noiseGateThresholdDB: -80});
  });

  it('scopes preferences by Instance and Member and recovers corrupt values', async () => {
    const store = new MemoryVoiceVideoSettingsStore();
    await store.save('https://one.test', 'member-1', {...DEFAULT_VOICE_VIDEO_SETTINGS, inputGain: 1.5});
    expect((await store.load('https://one.test', 'member-1')).inputGain).toBe(1.5);
    expect(await store.load('https://one.test', 'member-2')).toEqual(DEFAULT_VOICE_VIDEO_SETTINGS);
  });

  it('generates settings-driven microphone constraints', () => {
    expect(voiceAudioConstraints({...DEFAULT_VOICE_VIDEO_SETTINGS, microphoneID: 'mic-2'})).toEqual({deviceId: {ideal: 'mic-2'}, googEchoCancellation: true, googNoiseSuppression: true, googAllChatRNNoise: false, googAllChatNoiseGate: true, googAllChatNoiseGateThresholdDB: -50, googAutoGainControl: false});
  });

  it('preserves enhanced intent while failing open to standard suppression', () => {
    const normalized = normalizeVoiceVideoSettings({...DEFAULT_VOICE_VIDEO_SETTINGS, noiseSuppressionMode: 'enhanced'});
    expect(normalized).toMatchObject({noiseSuppressionMode: 'enhanced', noiseSuppression: true});
    expect(voiceAudioConstraints(normalized)).toMatchObject({googEchoCancellation: true, googNoiseSuppression: true, googAllChatRNNoise: true});
    expect(voiceAudioConstraints({...DEFAULT_VOICE_VIDEO_SETTINGS, noiseSuppressionMode: 'off'})).toMatchObject({googEchoCancellation: true, googNoiseSuppression: false, googAllChatRNNoise: false});
  });
});
