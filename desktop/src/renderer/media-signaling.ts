export type DesktopMediaFrame = {
  type?: string;
  code?: string;
  resume_token?: string;
  negotiation_id?: string;
  member_id?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  error?: string;
};

export function serializeSessionDescription(sdp: RTCSessionDescriptionInit | null) {
  return sdp ? { type: sdp.type, sdp: sdp.sdp || '' } : null;
}

export function createMediaJoinFrame(roomID: string, sdp: RTCSessionDescriptionInit | null, resumeToken = '', takeover = true) {
  return { version: 1, type: 'join', room_id: roomID, resume_token: resumeToken, takeover, capabilities: ['negotiation-id'], negotiation_id: 'client-1', sdp: serializeSessionDescription(sdp) } as const;
}

export function mediaDisconnectMessage(firstFailure: string, closeReason: string): string {
  return firstFailure || closeReason || 'Media signaling disconnected.';
}

export function createMediaConnectionWatchdog(
  setStatus: (status: string) => void,
  state: () => { connection: RTCPeerConnectionState; ice: RTCIceConnectionState },
  timeoutMs = 15_000,
  schedule: (callback: () => void, delay: number) => number = window.setTimeout,
  cancel: (timer: number) => void = window.clearTimeout,
  onFailure?: (message: string) => void,
) {
  let timer: number | null = null;
  let active = false;
  const clear = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  return {
    start() {
      clear();
      active = true;
      timer = schedule(() => {
        timer = null;
        if (!active || state().connection === 'connected') return;
        const current = state();
        const message = `Media connection timed out (${current.ice || current.connection || 'unknown'}).`; setStatus(message); onFailure?.(message);
      }, timeoutMs);
    },
    stateChanged() {
      if (!active) return;
      const current = state();
      if (current.connection === 'connected') {
        clear();
        setStatus('Call connected');
      } else if (current.connection === 'failed' || current.connection === 'disconnected' || current.ice === 'failed') {
        setStatus(`Media ${current.connection || current.ice}`); onFailure?.(`Media ${current.connection || current.ice}`);
      }
    },
    stop() {
      active = false;
      clear();
    },
  };
}

export function desktopMediaOwnerID(trackID: string, streamID = ''): string {
  for (const value of [streamID, trackID]) {
    const match = /^(?:member|audio|screen)-(.+)$/.exec(value);
    if (match) return match[1];
  }
  return '';
}

export function createMediaFrameQueue(
  peer: RTCPeerConnection,
  send: (frame: object) => void,
  callbacks: {
    onFailure?(error: Error): void;
    onAnswer?(frame: DesktopMediaFrame): void;
    onCommandError?(frame: DesktopMediaFrame): void;
    onVideoStopped?(memberID: string): void;
    onVideoStarted?(memberID: string): void;
    onScreenQuality?(quality: 'low' | 'medium' | 'high'): void;
  } = {},
) {
  const pendingRemote: RTCIceCandidateInit[] = [];
  let queue = Promise.resolve();
  let offerTimer: ReturnType<typeof setTimeout> | undefined;
  const sendOffer = (frame: object) => {
    clearTimeout(offerTimer);
    if (callbacks.onFailure) offerTimer = setTimeout(() => { if (!closed) callbacks.onFailure?.(new Error('Media negotiation timed out')); }, 10000);
    send(frame);
  };
  let offerNumber = 1, localOfferID = 'client-1', pending = false, closed = false;
  const offer = async () => {
    if (closed) return;
    if (peer.signalingState && peer.signalingState !== 'stable') { pending = true; return; }
    localOfferID = `client-${++offerNumber}`;
    const description = await peer.createOffer();
    if (closed) return;
    await peer.setLocalDescription(description);
    if (!closed) sendOffer({version: 1, type: 'offer', negotiation_id: localOfferID, sdp: serializeSessionDescription(peer.localDescription)});
  };

  const flushRemote = async () => {
    for (const candidate of pendingRemote.splice(0)) await peer.addIceCandidate(candidate);
  };
  const handle = async (frame: DesktopMediaFrame) => {
    if (closed) return;
    if (frame.type === 'command-error') { callbacks.onCommandError?.(frame); return; }
    if (frame.type === 'heartbeat-ack') return;
    if (frame.type === 'error') throw Object.assign(new Error(frame.error || 'Media signaling failed.'), {code: frame.code});
    if (frame.type === 'video-stopped' && frame.member_id) { callbacks.onVideoStopped?.(frame.member_id); return; }
    if (frame.type === 'video-started' && frame.member_id) { callbacks.onVideoStarted?.(frame.member_id); return; }
    if (frame.type === 'screen-low') { callbacks.onScreenQuality?.('low'); return; }
    if (frame.type === 'screen-medium') { callbacks.onScreenQuality?.('medium'); return; }
    if (frame.type === 'screen-high') { callbacks.onScreenQuality?.('high'); return; }
    if (frame.type === 'answer' && frame.sdp) {
      if (frame.negotiation_id && frame.negotiation_id !== localOfferID) return;
      if (peer.signalingState && peer.signalingState !== 'have-local-offer') return;
      await peer.setRemoteDescription(frame.sdp);
      await flushRemote();
      localOfferID = ''; clearTimeout(offerTimer);
      callbacks.onAnswer?.(frame);
      if (pending) { pending = false; await offer(); }
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
      if (closed) return;
      send({ version: 1, type: 'answer', negotiation_id: frame.negotiation_id, sdp: serializeSessionDescription(peer.localDescription) });
      if (retryLocalOffer || pending) { pending = false; await offer(); }
    }
  };

  return {
    close() { closed = true; clearTimeout(offerTimer); },
    renegotiate(): Promise<void> {
      const current = queue.then(offer);
      queue = current.catch(() => undefined);
      return current;
    },
    push(frame: DesktopMediaFrame): Promise<void> {
      const current = queue.then(() => handle(frame));
      queue = current.catch(() => undefined);
      return current;
    },
  };
}
