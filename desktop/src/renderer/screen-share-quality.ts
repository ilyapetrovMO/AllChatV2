import type { ScreenShareMode } from './voice-capture';

export type ScreenShareTier = 'low' | 'medium' | 'high';
export type ScreenSharePreset = {
  width: number; height: number; frameRate: number; contentHint: 'text' | 'detail' | 'motion';
  encodings: RTCRtpEncodingParameters[];
};

export function screenSharePreset(mode: ScreenShareMode, maximumBitrate = 2_500_000): ScreenSharePreset {
  const selected = mode === 'auto' ? 'balanced' : mode;
  const dimensions = selected === 'motion' ? [1280, 720, 30] : selected === 'data-saver' ? [960, 540, 12] : selected === 'text' ? [1920, 1080, 10] : [1920, 1080, 20];
  const hint = selected === 'motion' ? 'motion' : selected === 'text' ? 'text' : 'detail';
  return {
    width: dimensions[0], height: dimensions[1], frameRate: dimensions[2], contentHint: hint,
    encodings: [
      { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: Math.min(250_000, maximumBitrate), maxFramerate: Math.min(12, dimensions[2]) },
      { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: Math.min(750_000, maximumBitrate), maxFramerate: Math.min(20, dimensions[2]) },
      { rid: 'f', scaleResolutionDownBy: 1, maxBitrate: maximumBitrate, maxFramerate: dimensions[2] },
    ],
  };
}

export async function prepareScreenShareTrack(track: MediaStreamTrack, preset: ScreenSharePreset): Promise<void> {
  track.contentHint = preset.contentHint;
  await track.applyConstraints?.({ width: { max: preset.width }, height: { max: preset.height }, frameRate: { max: preset.frameRate } });
}

export function setScreenShareTier(sender: RTCRtpSender, tier: ScreenShareTier): Promise<void> {
  const parameters = sender.getParameters();
  const maximum = tier === 'low' ? 0 : tier === 'medium' ? 1 : 2;
  (parameters.encodings || []).forEach((encoding, index) => { encoding.active = index <= maximum; });
  return sender.setParameters(parameters);
}

export function lowestScreenShareTier(left: ScreenShareTier, right: ScreenShareTier): ScreenShareTier {
  const order: ScreenShareTier[] = ['low', 'medium', 'high'];
  return order[Math.min(order.indexOf(left), order.indexOf(right))];
}

export function createScreenShareAutoController(initial: ScreenShareTier = 'high') {
  const order: ScreenShareTier[] = ['low', 'medium', 'high'];
  let tier = initial, unhealthy = 0, healthy = 0;
  return {
    sample(input: { qualityLimitationReason?: string; droppedRatio?: number }): ScreenShareTier {
      const constrained = input.qualityLimitationReason === 'cpu' || input.qualityLimitationReason === 'bandwidth' || (input.droppedRatio || 0) > .15;
      unhealthy = constrained ? unhealthy + 1 : 0;
      healthy = constrained ? 0 : healthy + 1;
      let index = order.indexOf(tier);
      if (unhealthy >= 2 && index > 0) { tier = order[index - 1]; unhealthy = healthy = 0; }
      else if (healthy >= 5 && index < order.length - 1) { tier = order[index + 1]; unhealthy = healthy = 0; }
      return tier;
    },
    current: () => tier,
  };
}

export function screenShareStats(report: RTCStatsReport) {
  const result = { direction: '', width: 0, height: 0, framesPerSecond: 0, framesEncoded: 0, framesDecoded: 0, framesDropped: 0, bytes: 0, qualityLimitationReason: '' };
  report.forEach((entry) => {
    if (entry.type !== 'outbound-rtp' && entry.type !== 'inbound-rtp') return;
    if (entry.kind !== 'video' && entry.mediaType !== 'video') return;
    result.direction = entry.type === 'outbound-rtp' ? 'outbound' : 'inbound';
    result.width = entry.frameWidth || 0; result.height = entry.frameHeight || 0; result.framesPerSecond = entry.framesPerSecond || 0;
    result.framesEncoded = entry.framesEncoded || 0; result.framesDecoded = entry.framesDecoded || 0; result.framesDropped = entry.framesDropped || 0;
    result.bytes = entry.bytesSent || entry.bytesReceived || 0; result.qualityLimitationReason = entry.qualityLimitationReason || '';
  });
  return result;
}
