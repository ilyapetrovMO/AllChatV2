import { beforeEach, describe, expect, it, vi } from 'vitest';

import { captureDesktopMicrophone, desktopVoiceConstraints, loadDesktopVoicePreferences, saveDesktopVoicePreferences } from './voice-capture';

describe('desktop voice capture', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'allchatDesktop', { configurable: true, value: { reportDiagnostic: vi.fn() } });
  });

  it('persists normalized preferences and builds standard WebRTC constraints', () => {
    const saved = saveDesktopVoicePreferences('member', {
      version: 1, microphoneID: 'microphone', speakerID: '', cameraID: '', inputGain: 9, outputVolume: -2, memberVolumes: { alex: 0.4 },
      noiseSuppressionMode: 'standard', echoCancellation: true, autoGainControl: false,
      noiseGate: true, noiseGateThresholdDB: -50,
      screenShareMode: 'auto',
    });
    expect(saved).toMatchObject({ inputGain: 2, outputVolume: 0, memberVolumes: { alex: 0.4 } });
    expect(loadDesktopVoicePreferences('member')).toEqual(saved);
    expect(desktopVoiceConstraints(saved)).toEqual({
      deviceId: { ideal: 'microphone' }, echoCancellation: true, noiseSuppression: true, autoGainControl: false,
    });
  });

  it('routes enhanced microphone audio through the RNNoise worklet', async () => {
    const rawTrack = { stop: vi.fn() };
    const processedTrack = { stop: vi.fn() };
    const raw = { getAudioTracks: () => [rawTrack], getTracks: () => [rawTrack] } as unknown as MediaStream;
    const processed = { getAudioTracks: () => [processedTrack], getTracks: () => [processedTrack] } as unknown as MediaStream;
    const addModule = vi.fn(async () => undefined);
    const connect = vi.fn(function (this: unknown) { return this; });
    const close = vi.fn(async () => undefined);
    class FakeAudioContext {
      audioWorklet = { addModule };
      currentTime = 0;
      createMediaStreamSource = () => ({ connect });
      createGain = () => ({ connect, gain: { value: 1, setTargetAtTime: vi.fn() } });
      createMediaStreamDestination = () => ({ stream: processed });
      createAnalyser = () => ({ fftSize: 0, getFloatTimeDomainData: vi.fn() });
      close = close;
    }
    class FakeWorkletNode {
      port = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: vi.fn() };
      connect = connect;
      constructor() { queueMicrotask(() => this.port.onmessage?.({ data: { type: 'ready' } } as MessageEvent)); }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => raw) } });
    saveDesktopVoicePreferences('member', {
      version: 1, microphoneID: '', speakerID: '', cameraID: '', inputGain: 1, outputVolume: 1, memberVolumes: {},
      noiseSuppressionMode: 'enhanced', echoCancellation: true, autoGainControl: false,
      noiseGate: false, noiseGateThresholdDB: -50,
      screenShareMode: 'auto',
    });

    const capture = await captureDesktopMicrophone('member');
    expect(capture.enhanced).toBe(true);
    expect(capture.stream).toBe(processed);
    expect(addModule).toHaveBeenCalledOnce();
    capture.stop();
    expect(rawTrack.stop).toHaveBeenCalledOnce();
    expect(processedTrack.stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('falls back to standard capture when RNNoise cannot initialize', async () => {
    const firstTrack = { stop: vi.fn() };
    const fallbackTrack = { stop: vi.fn() };
    const processedTrack = { stop: vi.fn() };
    const first = { getAudioTracks: () => [firstTrack], getTracks: () => [firstTrack] } as unknown as MediaStream;
    const fallback = { getAudioTracks: () => [fallbackTrack], getTracks: () => [fallbackTrack] } as unknown as MediaStream;
    const processed = { getAudioTracks: () => [processedTrack], getTracks: () => [processedTrack] } as unknown as MediaStream;
    const connect = vi.fn(function (this: unknown) { return this; });
    class FailingAudioContext {
      audioWorklet = { addModule: vi.fn(async () => { throw new Error('worklet unavailable'); }) };
      currentTime = 0;
      createMediaStreamSource = () => ({ connect });
      createGain = () => ({ connect, gain: { value: 1, setTargetAtTime: vi.fn() } });
      createMediaStreamDestination = () => ({ stream: processed });
      createAnalyser = () => ({ fftSize: 0, getFloatTimeDomainData: vi.fn() });
      close = vi.fn(async () => undefined);
    }
    vi.stubGlobal('AudioContext', FailingAudioContext);
    const getUserMedia = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(fallback);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    saveDesktopVoicePreferences('member', {
      version: 1, microphoneID: '', speakerID: '', cameraID: '', inputGain: 1, outputVolume: 1, memberVolumes: {},
      noiseSuppressionMode: 'enhanced', echoCancellation: true, autoGainControl: false,
      noiseGate: false, noiseGateThresholdDB: -50,
      screenShareMode: 'auto',
    });

    const capture = await captureDesktopMicrophone('member');
    expect(capture.stream).toBe(processed);
    expect(capture.enhanced).toBe(false);
    expect(capture.compatibilityNotice).toContain('standard WebRTC suppression is active');
    expect(firstTrack.stop).toHaveBeenCalledOnce();
    expect(window.allchatDesktop.reportDiagnostic).toHaveBeenCalledWith('rnnoise_initialization_failed', 'worklet_module_load: worklet unavailable');
  });
});
