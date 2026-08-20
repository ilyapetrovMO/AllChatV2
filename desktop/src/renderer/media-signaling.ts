export type DesktopMediaFrame = {
  type?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  error?: string;
};

export function createMediaJoinFrame(roomID: string, sdp: RTCSessionDescriptionInit | null) {
  return { version: 1, type: 'join', room_id: roomID, takeover: true, sdp } as const;
}

export function mediaDisconnectMessage(firstFailure: string, closeReason: string): string {
  return firstFailure || closeReason || 'Media signaling disconnected.';
}

export function createMediaFrameQueue(
  peer: RTCPeerConnection,
  send: (frame: object) => void,
  callbacks: { onAnswer?(): void } = {},
) {
  const pendingRemote: RTCIceCandidateInit[] = [];
  let queue = Promise.resolve();

  const flushRemote = async () => {
    for (const candidate of pendingRemote.splice(0)) await peer.addIceCandidate(candidate);
  };
  const handle = async (frame: DesktopMediaFrame) => {
    if (frame.type === 'heartbeat-ack') return;
    if (frame.type === 'error') throw new Error(frame.error || 'Media signaling failed.');
    if (frame.type === 'answer' && frame.sdp) {
      if (peer.signalingState && peer.signalingState !== 'have-local-offer') return;
      await peer.setRemoteDescription(frame.sdp);
      await flushRemote();
      callbacks.onAnswer?.();
      return;
    }
    if (frame.type === 'candidate' && frame.candidate) {
      if (peer.remoteDescription) await peer.addIceCandidate(frame.candidate);
      else pendingRemote.push(frame.candidate);
      return;
    }
    if (frame.type === 'offer' && frame.sdp) {
      const retryLocalOffer = peer.signalingState === 'have-local-offer';
      if (retryLocalOffer) await peer.setLocalDescription({ type: 'rollback' });
      await peer.setRemoteDescription(frame.sdp);
      await flushRemote();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      send({ version: 1, type: 'answer', sdp: peer.localDescription });
      if (retryLocalOffer) {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        send({ version: 1, type: 'offer', sdp: peer.localDescription });
      }
    }
  };

  return {
    push(frame: DesktopMediaFrame): Promise<void> {
      const current = queue.then(() => handle(frame));
      queue = current.catch(() => undefined);
      return current;
    },
  };
}
