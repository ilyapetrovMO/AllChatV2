import { describe, expect, it, vi } from 'vitest';

import { createMediaFrameQueue, createMediaJoinFrame, mediaDisconnectMessage } from './media-signaling';

describe('desktop media signaling', () => {
  it('takes over a stale media lease when the user explicitly joins', () => {
    expect(createMediaJoinFrame('voice-room', { type: 'offer', sdp: 'offer' })).toMatchObject({
      type: 'join', room_id: 'voice-room', takeover: true,
    });
  });
  it('does not overwrite a useful signaling failure when the socket closes', () => {
    expect(mediaDisconnectMessage('Voice Room unavailable', 'WebSocket closed (1008)'))
      .toBe('Voice Room unavailable');
    expect(mediaDisconnectMessage('', 'WebSocket closed (1006)')).toBe('WebSocket closed (1006)');
  });
  it('waits for the SDP answer before applying an immediately following ICE candidate', async () => {
    let finishRemoteDescription!: () => void;
    const remoteDescription = new Promise<void>((resolve) => { finishRemoteDescription = resolve; });
    const peer = {
      signalingState: 'have-local-offer',
      remoteDescription: null as object | null,
      setRemoteDescription: vi.fn(async () => {
        await remoteDescription;
        peer.remoteDescription = { type: 'answer' };
      }),
      addIceCandidate: vi.fn(async () => undefined),
      setLocalDescription: vi.fn(async () => undefined),
      createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'local-answer' })),
      createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'local-offer' })),
      localDescription: { type: 'offer', sdp: 'local-offer' },
    };
    const send = vi.fn();
    const frames = createMediaFrameQueue(peer as unknown as RTCPeerConnection, send);

    const answer = frames.push({ type: 'answer', sdp: { type: 'answer', sdp: 'remote-answer' } });
    const candidate = frames.push({ type: 'candidate', candidate: { candidate: 'candidate:1' } });
    await Promise.resolve();
    expect(peer.addIceCandidate).not.toHaveBeenCalled();

    finishRemoteDescription();
    await Promise.all([answer, candidate]);
    expect(peer.setRemoteDescription).toHaveBeenCalledTimes(1);
    expect(peer.addIceCandidate).toHaveBeenCalledWith({ candidate: 'candidate:1' });
  });

  it('queues a candidate that arrives before the answer frame', async () => {
    const peer = {
      signalingState: 'have-local-offer', remoteDescription: null as object | null,
      setRemoteDescription: vi.fn(async () => { peer.remoteDescription = { type: 'answer' }; }),
      addIceCandidate: vi.fn(async () => undefined),
      setLocalDescription: vi.fn(async () => undefined), createAnswer: vi.fn(), createOffer: vi.fn(),
      localDescription: { type: 'offer', sdp: 'local-offer' },
    };
    const frames = createMediaFrameQueue(peer as unknown as RTCPeerConnection, vi.fn());
    await frames.push({ type: 'candidate', candidate: { candidate: 'candidate:early' } });
    expect(peer.addIceCandidate).not.toHaveBeenCalled();
    await frames.push({ type: 'answer', sdp: { type: 'answer', sdp: 'remote-answer' } });
    expect(peer.addIceCandidate).toHaveBeenCalledWith({ candidate: 'candidate:early' });
  });
});
