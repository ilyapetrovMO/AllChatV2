import { describe, expect, it, vi } from 'vitest';
import { createScreenShareAutoController, lowestScreenShareTier, prepareScreenShareTrack, screenSharePreset, screenShareStats, setScreenShareTier } from './screen-share-quality';

describe('desktop screen-share quality', () => {
  it('uses semantic text and motion envelopes', () => {
    expect(screenSharePreset('text')).toMatchObject({ width: 1920, height: 1080, frameRate: 10, contentHint: 'text' });
    expect(screenSharePreset('motion')).toMatchObject({ width: 1280, height: 720, frameRate: 30, contentHint: 'motion' });
    expect(screenSharePreset('data-saver').encodings[2].maxFramerate).toBe(12);
  });
  it('applies capture constraints and selects negotiated layers', async () => {
    const track = { contentHint: '', applyConstraints: vi.fn(async () => undefined) };
    await prepareScreenShareTrack(track as unknown as MediaStreamTrack, screenSharePreset('balanced'));
    expect(track.contentHint).toBe('detail');
    expect(track.applyConstraints).toHaveBeenCalledWith({ width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 20 } });
    const parameters: { encodings: Array<{ active?: boolean }> } = { encodings: [{}, {}, {}] };
    const sender = { getParameters: () => parameters, setParameters: vi.fn(async () => undefined) };
    await setScreenShareTier(sender as unknown as RTCRtpSender, 'medium');
    expect(parameters.encodings.map(({ active }) => active)).toEqual([true, true, false]);
  });
  it('downgrades quickly and upgrades with hysteresis', () => {
    const controller = createScreenShareAutoController();
    expect(controller.sample({ qualityLimitationReason: 'cpu' })).toBe('high');
    expect(controller.sample({ qualityLimitationReason: 'cpu' })).toBe('medium');
    for (let index = 0; index < 4; index += 1) expect(controller.sample({ qualityLimitationReason: 'none' })).toBe('medium');
    expect(controller.sample({ qualityLimitationReason: 'none' })).toBe('high');
    expect(lowestScreenShareTier('high', 'medium')).toBe('medium');
  });
  it('extracts bounded screen-share diagnostics without signaling details', () => {
    const entries = [{ type: 'inbound-rtp', kind: 'video', frameWidth: 1280, frameHeight: 720, framesPerSecond: 24, framesDecoded: 10, framesDropped: 2, bytesReceived: 500 }];
    const report = { forEach: (visit: (entry: object) => void) => entries.forEach(visit) } as unknown as RTCStatsReport;
    expect(screenShareStats(report)).toMatchObject({ direction: 'inbound', width: 1280, height: 720, framesDecoded: 10, framesDropped: 2, bytes: 500 });
  });
});
