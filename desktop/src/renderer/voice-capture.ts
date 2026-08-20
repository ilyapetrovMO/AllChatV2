import rnnoiseWorkletUrl from './rnnoise-worklet?worker&url';

export type DesktopVoicePreferences = {
  version: 1;
  microphoneID: string;
  speakerID: string;
  cameraID: string;
  inputGain: number;
  outputVolume: number;
  noiseSuppressionMode: 'standard' | 'enhanced' | 'off';
  echoCancellation: boolean;
  autoGainControl: boolean;
  noiseGate: boolean;
  noiseGateThresholdDB: number;
};

export const defaultDesktopVoicePreferences: DesktopVoicePreferences = {
  version: 1, microphoneID: '', speakerID: '', cameraID: '', inputGain: 1, outputVolume: 1,
  noiseSuppressionMode: 'standard', echoCancellation: true, autoGainControl: false,
  noiseGate: true, noiseGateThresholdDB: -50,
};

export interface DesktopMicrophoneCapture {
  stream: MediaStream;
  enhanced: boolean;
  compatibilityNotice?: string;
  stop(): void;
}

export function loadDesktopVoicePreferences(memberId: string): DesktopVoicePreferences {
  try {
    return normalizeDesktopVoicePreferences(JSON.parse(localStorage.getItem(storageKey(memberId)) || 'null'));
  } catch {
    return { ...defaultDesktopVoicePreferences };
  }
}

export function saveDesktopVoicePreferences(memberId: string, value: DesktopVoicePreferences): DesktopVoicePreferences {
  const preferences = normalizeDesktopVoicePreferences(value);
  localStorage.setItem(storageKey(memberId), JSON.stringify(preferences));
  window.dispatchEvent(new CustomEvent('allchat:voice-settings', { detail: preferences }));
  return preferences;
}

export function desktopVoiceConstraints(preferences: DesktopVoicePreferences): MediaTrackConstraints {
  return {
    ...(preferences.microphoneID ? { deviceId: { ideal: preferences.microphoneID } } : {}),
    echoCancellation: preferences.echoCancellation,
    noiseSuppression: preferences.noiseSuppressionMode === 'standard',
    autoGainControl: preferences.autoGainControl,
  };
}

export async function captureDesktopMicrophone(memberId: string): Promise<DesktopMicrophoneCapture> {
  return capture(loadDesktopVoicePreferences(memberId));
}

export function applyDesktopOutputPreferences(element: HTMLAudioElement, memberId: string, remoteMemberId = ''): void {
  const preferences = loadDesktopVoicePreferences(memberId);
  element.volume = clamp(preferences.outputVolume, 0, 1, 1);
  if (preferences.speakerID && typeof element.setSinkId === 'function') void element.setSinkId(preferences.speakerID).catch(() => undefined);
  void remoteMemberId;
}

async function capture(preferences: DesktopVoicePreferences): Promise<DesktopMicrophoneCapture> {
  let raw: MediaStream;
  try {
    raw = await navigator.mediaDevices.getUserMedia({ audio: desktopVoiceConstraints(preferences), video: false });
  } catch (error) {
    if (!preferences.microphoneID) throw error;
    raw = await navigator.mediaDevices.getUserMedia({ audio: desktopVoiceConstraints({ ...preferences, microphoneID: '' }), video: false });
  }
  if (!raw.getAudioTracks().length || typeof AudioContext === 'undefined') return rawCapture(raw);

  const context = new AudioContext();
  let enhanced: AudioWorkletNode | null = null;
  if (preferences.noiseSuppressionMode === 'enhanced') {
    try {
      enhanced = await createRNNoiseNode(context);
    } catch {
      raw.getTracks().forEach((track) => track.stop());
      await context.close().catch(() => undefined);
      const fallback = await capture({ ...preferences, noiseSuppressionMode: 'standard' });
      fallback.compatibilityNotice = 'Enhanced RNNoise is unavailable; standard WebRTC suppression is active.';
      return fallback;
    }
  }

  const source = context.createMediaStreamSource(raw);
  const gain = context.createGain();
  const destination = context.createMediaStreamDestination();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  if (enhanced) source.connect(enhanced).connect(gain); else source.connect(gain);
  gain.connect(destination);
  gain.gain.value = preferences.inputGain;

  const samples = new Float32Array(analyser.fftSize);
  let gateOpen = true, belowSince = 0;
  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const rms = Math.sqrt(sum / samples.length), decibels = rms ? 20 * Math.log10(rms) : -100, now = performance.now();
    if (!preferences.noiseGate) { gateOpen = true; belowSince = 0; }
    else if (gateOpen && decibels < preferences.noiseGateThresholdDB - 6) {
      belowSince ||= now;
      if (now - belowSince > 150) gateOpen = false;
    } else if (decibels >= preferences.noiseGateThresholdDB) { gateOpen = true; belowSince = 0; }
    gain.gain.setTargetAtTime(gateOpen ? preferences.inputGain : 0, context.currentTime, gateOpen ? 0.005 : 0.12);
  }, 50);
  return {
    stream: destination.stream,
    enhanced: Boolean(enhanced),
    stop() {
      window.clearInterval(timer);
      enhanced?.port.postMessage({ type: 'destroy' });
      raw.getTracks().forEach((track) => track.stop());
      destination.stream.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => undefined);
    },
  };
}

async function createRNNoiseNode(context: AudioContext): Promise<AudioWorkletNode> {
  await context.audioWorklet.addModule(rnnoiseWorkletUrl);
  const node = new AudioWorkletNode(context, 'allchat-desktop-rnnoise', { channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('RNNoise initialization timed out.')), 10_000);
    node.port.onmessage = (event) => {
      if (event.data?.type === 'ready') { window.clearTimeout(timeout); resolve(); }
      if (event.data?.type === 'error') { window.clearTimeout(timeout); reject(new Error(event.data.message || 'RNNoise initialization failed.')); }
    };
  });
  return node;
}

function rawCapture(stream: MediaStream): DesktopMicrophoneCapture {
  return { stream, enhanced: false, stop: () => stream.getTracks().forEach((track) => track.stop()) };
}

function normalizeDesktopVoicePreferences(value: unknown): DesktopVoicePreferences {
  const source = value && typeof value === 'object' ? value as Partial<DesktopVoicePreferences> : {};
  const mode = source.noiseSuppressionMode === 'enhanced' || source.noiseSuppressionMode === 'off' ? source.noiseSuppressionMode : 'standard';
  return {
    ...defaultDesktopVoicePreferences, ...source, version: 1,
    microphoneID: typeof source.microphoneID === 'string' ? source.microphoneID : '',
    speakerID: typeof source.speakerID === 'string' ? source.speakerID : '',
    cameraID: typeof source.cameraID === 'string' ? source.cameraID : '',
    inputGain: clamp(source.inputGain, 0, 2, 1), outputVolume: clamp(source.outputVolume, 0, 1, 1),
    noiseGateThresholdDB: clamp(source.noiseGateThresholdDB, -80, -20, -50), noiseSuppressionMode: mode,
  };
}

function storageKey(memberId: string): string { return `allchat:voice-video:v1:desktop:${memberId}`; }
function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}
