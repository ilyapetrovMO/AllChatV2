import {mediaDevices, MediaStream, RTCPeerConnection, RTCRtpSender, RTCSessionDescription} from 'react-native-webrtc';
import {DEFAULT_VOICE_VIDEO_SETTINGS, voiceAudioConstraints, type VoiceVideoSettings} from './VoiceVideoSettings';

export type MediaStatus = 'idle' | 'connecting' | 'connected' | 'recovering' | 'failed';
export type MediaDiagnostics = {
  schema: 'allchat.media.test/v1'; at: string; roomID: string; generation: number;
  connectionState: string; iceConnectionState: string; signalingState: string;
  inbound: {audioPackets: number; videoPackets: number; videoFrames: number; packetsLost: number; jitter: number};
  outbound: {audioPackets: number; videoPackets: number; bytesSent: number};
  processing?: {requested: VoiceVideoSettings; applied: object};
};
export type MediaParticipant = {member_id: string; connected?: boolean; muted?: boolean; server_muted?: boolean; speaking?: boolean; screen_sharing?: boolean};
export type RemoteMedia = {id: string; ownerID: string; stream: MediaStream; kind: 'audio' | 'video'};
type SocketLike = {readyState: number; onopen: null | (() => void); onmessage: null | ((event: {data: string}) => void); onerror: null | (() => void); onclose: null | (() => void); send(value: string): void; close(): void};
type MediaFrame = {type: string; scope?: string; negotiation_id?: string; capabilities?: string[]; code?: string; error?: string; member_id?: string; sdp?: object; candidate?: object; resume_token?: string; participants?: MediaParticipant[]; sound?: {id: string; name: string; emoji?: string; audio_url: string}};
type IceServer = {urls: string | string[]; username?: string; credential?: string};
type PeerConfiguration = {iceServers: IceServer[]};

export type MediaSessionOptions = {
  instanceURL: string; token: string; roomID: string;
  settings?: VoiceVideoSettings;
  onStatus?(status: MediaStatus, error?: Error): void;
  onProgress?(message: string): void;
  onRemote?(media: RemoteMedia[]): void;
  onParticipants?(participants: MediaParticipant[]): void;
  onFrame?(frame: MediaFrame): void;
  onDiagnostics?(snapshot: MediaDiagnostics): void;
  fetchICE?(): Promise<IceServer[]>;
  createPeer?(configuration: PeerConfiguration): RTCPeerConnection;
  createSocket?(url: string, token: string): SocketLike;
  getUserMedia?(constraints: object): Promise<MediaStream>;
  getDisplayMedia?(constraints: object): Promise<MediaStream>;
  onVideoStopped?(): void;
  schedule?(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
};

export class MediaSession {
  private peer?: RTCPeerConnection; private socket?: SocketLike; private local?: MediaStream;
  private outgoingAudio?: RTCRtpSender;
  private displayAudioSender?: RTCRtpSender;
  private outgoingVideo?: ReturnType<RTCPeerConnection['addTransceiver']>;
  private screen?: MediaStream; private remote = new Map<string, RemoteMedia>(); private suspendedRemote = new Map<string, RemoteMedia>(); private resumeToken = '';
  private stoppedVideoOwners = new Set<string>();
  private screenVisible = false;
  private negotiation = Promise.resolve();
  private audioUpdate = Promise.resolve();
  private videoUpdate = Promise.resolve();
  private screenAudio: RTCRtpSender[] = [];
  private offerTimer?: ReturnType<typeof setTimeout>;
  private attemptTimer?: ReturnType<typeof setTimeout>;
  private recoveryDeadline = 0;
  private lastAck = 0;
  private offerNumber = 0;
  private localOfferID = '';
  private correlated = false;
  private negotiationPending = false;
  private audioSettingsRevision = 0;
  private stopped = true; private generation = 0; private heartbeat?: ReturnType<typeof setInterval>; private diagnostics?: ReturnType<typeof setInterval>; private reconnect?: ReturnType<typeof setTimeout>; private retry = 0; private manuallyMuted = false;
  constructor(private readonly options: MediaSessionOptions) {}

  async start(): Promise<void> {
    if (!this.stopped) return;
    const generation = ++this.generation;
    this.stopped = false; this.retry = 0; this.recoveryDeadline = 0;
    this.options.onStatus?.('connecting');
    this.armAttempt();
    try {
      const settings = this.options.settings || DEFAULT_VOICE_VIDEO_SETTINGS;
      const local = await (this.options.getUserMedia || mediaDevices.getUserMedia)({audio: voiceAudioConstraints(settings), video: false}) as MediaStream;
      if (!this.current(generation)) { this.release(local); return; }
      this.local = local;
      local.getAudioTracks().forEach(track => { track.enabled = !this.manuallyMuted; });
      setTrackVolume(local.getAudioTracks()[0], settings.inputGain);
      await this.connect(true);
    } catch (caught) { if (this.current(generation)) this.fail(caught); else if (!this.stopped) this.recover(asError(caught)); }
  }

  stop(explicit = true): void {
    if (explicit) this.send({type: 'leave'});
    this.stopped = true; this.generation += 1; this.audioSettingsRevision++;
    this.clearTimers(); this.recoveryDeadline = 0; this.videoUpdate = Promise.resolve(); this.audioUpdate = Promise.resolve();
    this.closePeer(); this.stopVideoCapture(); this.release(this.local); this.local = undefined;
    this.options.onStatus?.('idle');
  }

  private current(generation: number) { return !this.stopped && generation === this.generation; }
  private closePeer() {
    const socket = this.socket, peer = this.peer;
    this.socket = undefined; this.peer = undefined; this.outgoingAudio = undefined; this.outgoingVideo = undefined; this.displayAudioSender = undefined;
    socket?.close(); peer?.close();
    this.negotiation = Promise.resolve(); this.negotiationPending = false; this.localOfferID = ''; this.correlated = false;
    this.remote.clear(); this.suspendedRemote.clear(); this.stoppedVideoOwners.clear(); this.options.onRemote?.([]);
  }
  private stopVideoCapture() {
    this.release(this.screen); this.screen = undefined; this.screenAudio = [];
    for (const track of this.local?.getVideoTracks() || []) { track.stop(); this.local?.removeTrack(track); }
    this.options.onVideoStopped?.();
  }
  private armAttempt() {
    if (this.attemptTimer) clearTimeout(this.attemptTimer);
    const remaining = this.recoveryDeadline ? this.recoveryDeadline - Date.now() : 10000;
    this.attemptTimer = setTimeout(() => this.recover(new Error('Media connection timed out')), Math.max(0, Math.min(10000, remaining)));
  }

  setMuted(muted: boolean): Promise<void> {
    this.manuallyMuted = muted;
    const track = this.local?.getAudioTracks()[0];
    if (track) track.enabled = !muted;
    this.send({type: 'mute-state', muted});
    const generation = this.generation;
    const apply = async () => { if (this.current(generation) && this.outgoingAudio) await this.outgoingAudio.replaceTrack(this.manuallyMuted ? null : this.local?.getAudioTracks()[0] || null); };
    this.audioUpdate = this.audioUpdate.catch(() => {}).then(apply);
    return this.audioUpdate;
  }
  updateAudioSettings(settings: VoiceVideoSettings): Promise<void> {
    const previous = this.options.settings || DEFAULT_VOICE_VIDEO_SETTINGS;
    this.options.settings = settings;
    setTrackVolume(this.local?.getAudioTracks()[0], settings.inputGain);
    for (const item of this.remote.values()) if (item.kind === 'audio') setTrackVolume(item.stream.getAudioTracks()[0], settings.outputVolume * (settings.memberVolumes[item.ownerID] ?? 1));
    if (!this.local || !this.peer || sameCaptureSettings(previous, settings)) return this.audioUpdate;
    const revision = ++this.audioSettingsRevision, generation = this.generation;
    const apply = async () => {
      if (!this.current(generation) || !this.local || !this.peer) return;
      const replacement = await (this.options.getUserMedia || mediaDevices.getUserMedia)({audio: voiceAudioConstraints(settings), video: false}) as MediaStream;
      const next = replacement.getAudioTracks()[0];
      if (!next || revision !== this.audioSettingsRevision || !this.current(generation) || !this.local || !this.peer) { this.release(replacement); return; }
      const current = this.local.getAudioTracks()[0];
      const sender = this.outgoingAudio;
      if (!sender) { this.release(replacement); throw new Error('The active microphone sender is unavailable. Rejoin to apply processing changes.'); }
      next.enabled = !this.manuallyMuted; setTrackVolume(next, settings.inputGain);
      try { await sender.replaceTrack(this.manuallyMuted ? null : next); }
      catch (error) { this.release(replacement); throw error; }
      if (!this.current(generation) || !this.local) { this.release(replacement); return; }
      if (current) { this.local.removeTrack(current); current.stop(); }
      this.local.addTrack(next);
    };
    this.audioUpdate = this.audioUpdate.catch(() => {}).then(apply);
    return this.audioUpdate;
  }
  setScreenVisible(visible: boolean): void { this.screenVisible = visible; this.send({type: 'screen-visibility', visible}); }
  setScreenQuality(ownerID: string, quality: 'low' | 'medium' | 'high'): void { this.send({type: 'screen-quality', owner_id: ownerID, quality}); }
  playSound(soundID: string): void { this.send({type: 'soundboard-play', sound_id: soundID}); }

  setCamera(enabled: boolean): Promise<void> { return this.changeVideo(enabled ? 'camera' : 'off'); }
  setScreenSharing(enabled: boolean): Promise<void> { return this.changeVideo(enabled ? 'screen' : 'off'); }

  switchCamera(): void {
    const track = this.local?.getVideoTracks()[0] as unknown as {_switchCamera?: () => void};
    if (!track?._switchCamera) throw new Error('Camera switching is unavailable on this device.');
    track._switchCamera();
  }

  private changeVideo(source: 'camera' | 'screen' | 'off'): Promise<void> {
    const generation = this.generation;
    const apply = async () => {
      if (!this.current(generation) || !this.peer || !this.local) return;
      const peer = this.peer, local = this.local;
      this.send({type: 'video-stopped'});
      await this.clearVideoTrack();
      if (!this.current(generation)) return;
      const hadAudio = this.screenAudio.some(sender => sender !== this.displayAudioSender);
      for (const sender of this.screenAudio) { if(sender === this.displayAudioSender) await sender.replaceTrack(null); else peer.removeTrack(sender); }
      this.stopVideoCapture();
      if (source === 'off') { if (hadAudio) await this.renegotiate(); return; }
      const settings = this.options.settings || DEFAULT_VOICE_VIDEO_SETTINGS;
      const stream = source === 'camera'
        ? await (this.options.getUserMedia || mediaDevices.getUserMedia)({audio: false, video: settings.cameraID ? {deviceId: {ideal: settings.cameraID}} : {facingMode: 'user'}}) as MediaStream
        : await (this.options.getDisplayMedia || mediaDevices.getDisplayMedia)({android: {resolutionScale: settings.screenShareMode === 'data-saver' ? .5 : settings.screenShareMode === 'motion' ? .67 : 1}}) as MediaStream;
      if (!this.current(generation)) { this.release(stream); return; }
      const track = stream.getVideoTracks()[0];
      if (!track) { this.release(stream); throw new Error('No video source was selected.'); }
      try {
        if (source === 'camera') local.addTrack(track); else this.screen = stream;
        this.screenAudio = [];
        const audio = stream.getAudioTracks()[0];
        if(audio && this.displayAudioSender) { await this.displayAudioSender.replaceTrack(audio); if (!this.current(generation)) { this.release(stream); return; } this.screenAudio = [this.displayAudioSender]; }
        await this.setVideoTrack(track, source === 'camera' ? local : stream);
        if (!this.current(generation)) { this.release(stream); return; }
        (track as unknown as {onended?: () => void}).onended = () => { if (this.current(generation)) this.changeVideo('off').catch(() => {}); };
      } catch (error) {
        this.release(stream);
        if (this.current(generation)) {
          for (const sender of this.screenAudio) { if(sender === this.displayAudioSender) await sender.replaceTrack(null); else peer.removeTrack(sender); }
          this.stopVideoCapture();
          await this.clearVideoTrack().catch(() => {});
        }
        throw error;
      }
    };
    const result = this.videoUpdate.catch(() => {}).then(apply);
    this.videoUpdate = result.catch(() => {});
    return result;
  }

  localStream(): MediaStream | undefined { return this.local; }
  screenStream(): MediaStream | undefined { return this.screen; }

  private async connect(takeover: boolean): Promise<void> {
    const generation = ++this.generation; this.clearTimers(); this.closePeer(); this.stopVideoCapture(); this.videoUpdate = Promise.resolve(); this.armAttempt();
    this.options.onProgress?.('Fetching relay configuration…');
    const iceServers = this.options.fetchICE ? await this.options.fetchICE() : await this.fetchICE();
    if (this.stopped || generation !== this.generation) return;
    this.options.onProgress?.('Preparing encrypted media…');
    const pendingLocal: object[] = []; const pendingRemote: object[] = [];
    let frameQueue = Promise.resolve();
    const peer = (this.options.createPeer || (configuration => new RTCPeerConnection(configuration)))({iceServers}); this.peer = peer;
    for(const track of this.local?.getTracks()||[]){const sender=peer.addTrack(track,this.local!);if(track.kind==='audio'){this.outgoingAudio=sender;if(this.manuallyMuted)await sender.replaceTrack(null)}} this.displayAudioSender = peer.addTransceiver('audio', {direction: 'sendrecv'}).sender; this.outgoingVideo = peer.addTransceiver('video', {direction: 'sendrecv'});
    const codecs = RTCRtpSender.getCapabilities('video').codecs;
    if (codecs.length) this.outgoingVideo.setCodecPreferences([...codecs.filter(codec => codec.mimeType.toLowerCase() === 'video/vp8'), ...codecs.filter(codec => codec.mimeType.toLowerCase() !== 'video/vp8')]);
    peer.ontrack = (event: {streams: MediaStream[]; track: {id: string; kind: string; muted?: boolean; onended?: () => void; onmute?: () => void; onunmute?: () => void}}) => {
      if (!this.current(generation)) return;
      const stream = (event.streams[0] || new MediaStream([event.track as never])) as MediaStream; const id = event.track.id || `${event.track.kind}-${this.remote.size}`; const ownerID = mediaOwnerID(id, stream.id); const item = {id, ownerID, stream, kind: event.track.kind as 'audio' | 'video'};
      const remove = () => { if (!this.current(generation)) return; if (this.remote.get(id) === item) this.remote.delete(id); if (this.suspendedRemote.get(id) === item) this.suspendedRemote.delete(id); this.options.onRemote?.([...this.remote.values()]); };
      const suspend = () => { if (!this.current(generation)) return; if (this.remote.get(id) === item) this.remote.delete(id); this.suspendedRemote.set(id, item); this.options.onRemote?.([...this.remote.values()]); };
      const publish = () => { if (!this.current(generation)) return; if (event.track.kind === 'video' && this.stoppedVideoOwners.has(ownerID)) return; if (event.track.kind === 'video' && ownerID) for (const [remoteID, current] of this.remote) if (current.kind === 'video' && current.ownerID === ownerID) this.remote.delete(remoteID); this.suspendedRemote.delete(id); this.remote.set(id, item); this.options.onRemote?.([...this.remote.values()]); };
      event.track.onended = remove;
      if (event.track.kind === 'video') { event.track.onmute = suspend; event.track.onunmute = publish; if (!event.track.muted) publish(); }
      else { const settings = this.options.settings || DEFAULT_VOICE_VIDEO_SETTINGS; setTrackVolume(event.track, settings.outputVolume * (settings.memberVolumes[ownerID] ?? 1)); publish(); }
    };
    peer.onicecandidate = (event: {candidate?: {toJSON(): object}}) => { if (!this.current(generation) || !event.candidate) return; const frame = {type: 'candidate', candidate: event.candidate.toJSON()}; if (this.socket?.readyState === 1) this.send(frame); else pendingLocal.push(frame); };
    peer.onconnectionstatechange = () => { if (!this.current(generation)) return; if (peer.connectionState === 'connected') { if (this.attemptTimer) clearTimeout(this.attemptTimer); this.recoveryDeadline = 0; this.retry = 0; this.options.onStatus?.('connected'); this.startDiagnostics(peer, generation); } else if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') this.recover(new Error(`WebRTC ${peer.connectionState}`)); };
    const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
    if (!this.current(generation)) return;
    this.localOfferID = `client-${++this.offerNumber}`;
    this.options.onProgress?.('Opening media signaling…');
    const socket = (this.options.createSocket || nativeSocket)(this.mediaURL(), this.options.token); this.socket = socket;
    socket.onopen = () => { if (!this.current(generation)) { socket.close(); return; } this.options.onProgress?.('Waiting for the media server…'); this.send({type: 'join', room_id: this.options.roomID, resume_token: this.resumeToken, takeover, capabilities: ['negotiation-id'], negotiation_id: this.localOfferID, sdp: peer.localDescription}); for (const frame of pendingLocal.splice(0)) this.send(frame); this.lastAck = Date.now(); this.heartbeat = setInterval(() => { if (!this.current(generation)) return; if (Date.now() - this.lastAck > 25000) this.recover(new Error('Media heartbeat timed out')); else this.send({type: 'heartbeat'}); }, 10000); };
    socket.onmessage = event => {
      frameQueue = frameQueue.then(() => this.handleFrame(JSON.parse(event.data) as MediaFrame, peer, generation, pendingRemote)).catch(caught => { if (this.current(generation)) this.recover(asError(caught)); });
      return frameQueue;
    };
    socket.onerror = () => socket.close(); socket.onclose = () => { if (!this.stopped && generation === this.generation) this.recover(new Error('Media signaling closed')); };
  }

  private async handleFrame(frame: MediaFrame, peer: RTCPeerConnection, generation: number, pendingRemote: object[]) {
    if (!this.current(generation)) return;
    if (frame.type === 'heartbeat-ack') { this.lastAck = Date.now(); return; }
    if (frame.type === 'command-error') { this.options.onFrame?.(frame); return; }
    if (frame.type === 'error') { const error = new Error(frame.error || 'Media signaling failed') as Error & {code?: string}; error.code = frame.code; throw error; }
    if (frame.type === 'answer' && frame.sdp) { if (frame.negotiation_id && frame.negotiation_id !== this.localOfferID) return; this.correlated ||= frame.capabilities?.includes('negotiation-id') || false; if (peer.signalingState && peer.signalingState !== 'have-local-offer') return; this.options.onProgress?.('Finishing media connection…'); await peer.setRemoteDescription(new RTCSessionDescription(frame.sdp as never)); if (!this.current(generation)) return; await this.flushRemoteCandidates(peer, pendingRemote); if (!this.current(generation)) return; if (frame.resume_token) this.resumeToken = frame.resume_token; if (frame.participants) this.options.onParticipants?.(frame.participants); this.localOfferID = ''; clearTimeout(this.offerTimer); this.send({type: 'mute-state', muted: this.manuallyMuted}); this.send({type: 'screen-visibility', visible: this.screenVisible}); if (this.negotiationPending) { this.negotiationPending = false; await this.renegotiate(); } return; }
    if (frame.type === 'participants' && frame.participants) { this.options.onParticipants?.(frame.participants); return; }
    if (frame.type === 'candidate' && frame.candidate) { if (peer.remoteDescription) peer.addIceCandidate(frame.candidate as never).catch(() => {}); else pendingRemote.push(frame.candidate); return; }
    if (frame.type === 'offer' && frame.sdp) { await this.withNegotiation(async () => { const retryLocalOffer = peer.signalingState === 'have-local-offer'; if (retryLocalOffer) await peer.setLocalDescription({type: 'rollback'} as never); await peer.setRemoteDescription(new RTCSessionDescription(frame.sdp as never)); if (!this.current(generation)) return; await this.flushRemoteCandidates(peer, pendingRemote); if (!this.current(generation)) return; const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); if (!this.current(generation)) return; this.send({type: 'answer', negotiation_id: frame.negotiation_id, sdp: peer.localDescription}); if (retryLocalOffer) { this.localOfferID = `client-${++this.offerNumber}`; const offer = await peer.createOffer(); if (!this.current(generation)) return; await peer.setLocalDescription(offer); if (!this.current(generation)) return; this.send({type: 'offer', negotiation_id: this.localOfferID, sdp: peer.localDescription}); } }); }
    else if (frame.type === 'video-stopped' && frame.member_id) { this.stoppedVideoOwners.add(frame.member_id); for (const [id, item] of this.remote) if (item.kind === 'video' && item.ownerID === frame.member_id) { this.remote.delete(id); this.suspendedRemote.set(id, item); } this.options.onRemote?.([...this.remote.values()]); }
    else if (frame.type === 'video-started' && frame.member_id) { this.stoppedVideoOwners.delete(frame.member_id); for (const [id, item] of this.suspendedRemote) if (item.kind === 'video' && item.ownerID === frame.member_id) { this.suspendedRemote.delete(id); this.remote.set(id, item); } this.options.onRemote?.([...this.remote.values()]); }
    else this.options.onFrame?.(frame);
  }

  private async flushRemoteCandidates(peer: RTCPeerConnection, pending: object[]) { for (const candidate of pending.splice(0)) peer.addIceCandidate(candidate as never).catch(() => {}); }

  private async renegotiate() {
    const generation = this.generation;
    return this.withNegotiation(async () => {
      const peer = this.peer;
      if (!peer || !this.current(generation)) return;
      if (peer.signalingState && peer.signalingState !== 'stable') { this.negotiationPending = true; return; }
      this.localOfferID = `client-${++this.offerNumber}`;
      const offer = await peer.createOffer();
      if (!this.current(generation)) return;
      await peer.setLocalDescription(offer);
      if (this.current(generation)) this.send({type: 'offer', negotiation_id: this.localOfferID, sdp: peer.localDescription});
    });
  }
  private withNegotiation(action: () => Promise<void>) { const generation = this.generation; const result = this.negotiation.catch(() => {}).then(() => { if(this.current(generation)) return action(); }); this.negotiation = result.catch(() => {}); return result; }
  private async setVideoTrack(track: MediaStream['getVideoTracks'] extends () => Array<infer T> ? T : never, stream: MediaStream) {
    if (!this.peer) return;
    const generation = this.generation;
    if (this.outgoingVideo) { await this.outgoingVideo.sender.replaceTrack(track); if (this.current(generation)) this.send({type: 'video-started'}); return; }
    const transceiver = this.peer.addTransceiver(track, {direction: 'sendonly', streams: [stream]}); this.outgoingVideo = transceiver;
    const capabilities = RTCRtpSender.getCapabilities('video').codecs;
    const preferred = [...capabilities.filter(codec => codec.mimeType.toLowerCase() === 'video/vp8'), ...capabilities.filter(codec => codec.mimeType.toLowerCase() !== 'video/vp8')];
    if (preferred.length) transceiver.setCodecPreferences(preferred);
    await this.renegotiate(); if (this.current(generation)) this.send({type: 'video-started'});
  }
  private async clearVideoTrack() { if (!this.outgoingVideo) return; await this.outgoingVideo.sender.replaceTrack(null); }
  private recover(error: Error) {
    if (this.stopped) return;
    const code = (error as Error & {code?: string}).code;
    if (['moderated', 'superseded', 'already_active', 'unauthorized', 'join_failed'].includes(code || '')) { this.fail(error); return; }
    if (code === 'invalid_resume') this.resumeToken = '';
    if (this.reconnect) return;
    this.recoveryDeadline ||= Date.now() + 30000;
    if (Date.now() >= this.recoveryDeadline) { this.fail(error); return; }
    this.generation++; this.clearTimers(); this.closePeer(); this.stopVideoCapture();
    this.options.onStatus?.('recovering', error);
    const delay = Math.min(this.recoveryDeadline - Date.now(), 4000, 500 * 2 ** Math.min(this.retry++, 3));
    this.reconnect = (this.options.schedule || setTimeout)(() => {
      this.reconnect = undefined;
      if (this.stopped) return;
      if (Date.now() >= this.recoveryDeadline) { this.fail(error); return; }
      this.connect(false).catch(caught => this.recover(asError(caught)));
    }, delay);
  }
  private fail(caught: unknown) { const error = asError(caught); this.stop(false); this.options.onStatus?.('failed', error); }
  private send(frame: object) {
    if (this.socket?.readyState !== 1) return;
    if ((frame as MediaFrame).type === 'offer') {
      clearTimeout(this.offerTimer); const generation = this.generation;
      this.offerTimer = setTimeout(() => { if (this.current(generation)) this.recover(new Error('Media negotiation timed out')); }, 10000);
    }
    this.socket.send(JSON.stringify({version: 1, ...frame}));
  }
  private startDiagnostics(peer: RTCPeerConnection, generation: number) {
    if (!this.options.onDiagnostics) return;
    if (this.diagnostics) clearInterval(this.diagnostics);
    const collect = async () => {
      if (this.stopped || this.peer !== peer || this.generation !== generation) return;
      try {
        const inbound = {audioPackets: 0, videoPackets: 0, videoFrames: 0, packetsLost: 0, jitter: 0};
        const outbound = {audioPackets: 0, videoPackets: 0, bytesSent: 0};
        const report = await peer.getStats();
        report.forEach((item: {type?: string; kind?: string; mediaType?: string; packetsReceived?: number; packetsSent?: number; packetsLost?: number; framesDecoded?: number; jitter?: number; bytesSent?: number}) => {
          const kind = item.kind || item.mediaType;
          if (item.type === 'inbound-rtp') { if (kind === 'audio') inbound.audioPackets += item.packetsReceived || 0; if (kind === 'video') { inbound.videoPackets += item.packetsReceived || 0; inbound.videoFrames += item.framesDecoded || 0; } inbound.packetsLost += item.packetsLost || 0; inbound.jitter = Math.max(inbound.jitter, item.jitter || 0); }
          if (item.type === 'outbound-rtp') { if (kind === 'audio') outbound.audioPackets += item.packetsSent || 0; if (kind === 'video') outbound.videoPackets += item.packetsSent || 0; outbound.bytesSent += item.bytesSent || 0; }
        });
        const requested = this.options.settings || DEFAULT_VOICE_VIDEO_SETTINGS, applied = this.local?.getAudioTracks()[0]?.getSettings?.() || {};
        this.options.onDiagnostics?.({schema: 'allchat.media.test/v1', at: new Date().toISOString(), roomID: this.options.roomID, generation, connectionState: peer.connectionState || '', iceConnectionState: peer.iceConnectionState || '', signalingState: peer.signalingState || '', inbound, outbound, processing: {requested, applied}});
      } catch {}
    };
    collect(); this.diagnostics = setInterval(collect, 1000);
  }
  private clearTimers() { clearTimeout(this.offerTimer); if (this.attemptTimer) clearTimeout(this.attemptTimer); this.attemptTimer = undefined; if (this.heartbeat) clearInterval(this.heartbeat); if (this.diagnostics) clearInterval(this.diagnostics); if (this.reconnect) clearTimeout(this.reconnect); this.heartbeat = undefined; this.diagnostics = undefined; this.reconnect = undefined; }
  private release(stream?: MediaStream) { stream?.getTracks().forEach(track => track.stop()); }
  private mediaURL() { const url = new URL(this.options.instanceURL); return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/api/v1/media`; }
  private async fetchICE(): Promise<IceServer[]> {
    const response = await fetch(`${this.options.instanceURL}/api/v1/turn-credentials`, {headers: {Authorization: `Bearer ${this.options.token}`}});
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as {error?: string};
      throw new Error(`TURN credentials unavailable${body.error ? `: ${body.error}` : ''} (HTTP ${response.status}).`);
    }
    return ((await response.json()) as {ice_servers: IceServer[]}).ice_servers;
  }
}

function setTrackVolume(track: unknown, volume: number) {
  (track as {_setVolume?(value: number): void} | undefined)?._setVolume?.(volume);
}

function sameCaptureSettings(left: VoiceVideoSettings, right: VoiceVideoSettings) {
  return left.microphoneID === right.microphoneID && left.echoCancellation === right.echoCancellation && left.noiseSuppression === right.noiseSuppression && left.noiseSuppressionMode === right.noiseSuppressionMode && left.autoGainControl === right.autoGainControl && left.noiseGate === right.noiseGate && left.noiseGateThresholdDB === right.noiseGateThresholdDB;
}

function nativeSocket(url: string, token: string) { return new WebSocket(url, null, {headers: {Authorization: `Bearer ${token}`}}) as unknown as SocketLike; }
function asError(value: unknown) { return value instanceof Error ? value : new Error('Media Session failed.'); }
export function mediaOwnerID(trackID: string, streamID = '') {
  for (const value of [streamID, trackID]) {
    const match = /^(?:member|audio|screen)-(.+)$/.exec(value);
    if (match) return match[1];
  }
  return '';
}
