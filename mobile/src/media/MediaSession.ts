import {mediaDevices, MediaStream, RTCPeerConnection, RTCRtpSender, RTCSessionDescription} from 'react-native-webrtc';
import {DEFAULT_VOICE_VIDEO_SETTINGS, voiceAudioConstraints, type VoiceVideoSettings} from './VoiceVideoSettings';
import {AudioGate} from './AudioGate';

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
type MediaFrame = {type: string; code?: string; error?: string; member_id?: string; sdp?: object; candidate?: object; resume_token?: string; participants?: MediaParticipant[]; sound?: {id: string; name: string; emoji?: string; audio_url: string}};
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
  schedule?(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
};

export class MediaSession {
  private peer?: RTCPeerConnection; private socket?: SocketLike; private local?: MediaStream;
  private outgoingAudio?: RTCRtpSender;
  private outgoingVideo?: ReturnType<RTCPeerConnection['addTransceiver']>;
  private screen?: MediaStream; private remote = new Map<string, RemoteMedia>(); private suspendedRemote = new Map<string, RemoteMedia>(); private resumeToken = '';
  private screenVisible = false;
  private negotiation = Promise.resolve();
  private audioUpdate = Promise.resolve();
  private stopped = true; private generation = 0; private heartbeat?: ReturnType<typeof setInterval>; private diagnostics?: ReturnType<typeof setInterval>; private gateTimer?: ReturnType<typeof setInterval>; private reconnect?: ReturnType<typeof setTimeout>; private retry = 0; private manuallyMuted = false;
  constructor(private readonly options: MediaSessionOptions) {}

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false; this.retry = 0; this.options.onStatus?.('connecting');
    try { const settings = this.options.settings || DEFAULT_VOICE_VIDEO_SETTINGS; this.local = await (this.options.getUserMedia || mediaDevices.getUserMedia)({audio: voiceAudioConstraints(settings), video: false}) as MediaStream; setTrackVolume(this.local.getAudioTracks()[0], settings.inputGain); await this.connect(false); }
    catch (caught) { this.fail(caught); }
  }

  stop(explicit = true): void {
    if (explicit && this.socket?.readyState === 1) this.send({type: 'leave'});
    this.stopped = true; this.generation += 1; this.clearTimers(); this.socket?.close(); this.peer?.close();
    this.socket = undefined; this.peer = undefined; this.outgoingAudio = undefined; this.release(this.screen); this.release(this.local); this.screen = undefined; this.local = undefined; this.remote.clear(); this.suspendedRemote.clear(); this.options.onRemote?.([]); this.options.onStatus?.('idle');
  }

  setMuted(muted: boolean): Promise<void> {
    this.manuallyMuted = muted;
    const track = this.local?.getAudioTracks()[0];
    if (track) track.enabled = !muted;
    this.send({type: 'mute-state', muted});
    const apply = async () => { if (this.outgoingAudio) await this.outgoingAudio.replaceTrack(muted ? null : track || null); };
    this.audioUpdate = this.audioUpdate.catch(() => {}).then(apply);
    return this.audioUpdate;
  }
  updateAudioSettings(settings: VoiceVideoSettings): Promise<void> {
    const previous = this.options.settings || DEFAULT_VOICE_VIDEO_SETTINGS;
    this.options.settings = settings;
    setTrackVolume(this.local?.getAudioTracks()[0], settings.inputGain);
    for (const item of this.remote.values()) if (item.kind === 'audio') setTrackVolume(item.stream.getAudioTracks()[0], settings.outputVolume * (settings.memberVolumes[item.ownerID] ?? 1));
    if (!this.local || !this.peer || sameCaptureSettings(previous, settings)) return this.audioUpdate;
    const apply = async () => {
      if (this.stopped || !this.local || !this.peer) return;
      const replacement = await (this.options.getUserMedia || mediaDevices.getUserMedia)({audio: voiceAudioConstraints(settings), video: false}) as MediaStream;
      const next = replacement.getAudioTracks()[0], current = this.local.getAudioTracks()[0];
      if (!next || this.stopped || !this.peer) { this.release(replacement); return; }
      const sender = this.outgoingAudio;
      if (!sender) { this.release(replacement); throw new Error('The active microphone sender is unavailable. Rejoin to apply processing changes.'); }
      next.enabled = !this.manuallyMuted; setTrackVolume(next, settings.inputGain);
      await sender.replaceTrack(this.manuallyMuted ? null : next);
      if (current) { this.local.removeTrack(current); current.stop(); }
      this.local.addTrack(next);
    };
    this.audioUpdate = this.audioUpdate.catch(() => {}).then(apply);
    return this.audioUpdate;
  }
  setScreenVisible(visible: boolean): void { this.screenVisible = visible; this.send({type: 'screen-visibility', visible}); }
  playSound(soundID: string): void { this.send({type: 'soundboard-play', sound_id: soundID}); }

  async setCamera(enabled: boolean): Promise<void> {
    if (!this.peer || !this.local) throw new Error('Media Session is not connected.');
    if (enabled && this.screen) await this.setScreenSharing(false);
    const existing = this.local.getVideoTracks()[0];
    if (!enabled && existing) { this.send({type: 'video-stopped'}); await this.clearVideoTrack(); existing.stop(); this.local.removeTrack(existing); return; }
    if (enabled && !existing) { const cameraID = (this.options.settings || DEFAULT_VOICE_VIDEO_SETTINGS).cameraID; const camera = await (this.options.getUserMedia || mediaDevices.getUserMedia)({audio: false, video: cameraID ? {deviceId: {ideal: cameraID}} : {facingMode: 'user'}}) as MediaStream; const track = camera.getVideoTracks()[0]; if (track) { this.local.addTrack(track); await this.setVideoTrack(track, this.local); } }
  }

  switchCamera(): void {
    const track = this.local?.getVideoTracks()[0] as (MediaStream['getVideoTracks'] extends () => Array<infer T> ? T : never) & {_switchCamera?: () => void};
    if (!track?._switchCamera) throw new Error('Camera switching is unavailable on this device.');
    track._switchCamera();
  }

  async setScreenSharing(enabled: boolean): Promise<void> {
    if (!this.peer) throw new Error('Media Session is not connected.');
    if (!enabled) { const stream = this.screen; this.screen = undefined; if (stream) { this.send({type: 'video-stopped'}); await this.clearVideoTrack(); } stream?.getTracks().forEach(track => track.stop()); return; }
    if (this.screen) return;
    if (this.local?.getVideoTracks()[0]) await this.setCamera(false);
    const stream = await (this.options.getDisplayMedia || mediaDevices.getDisplayMedia)({android: {resolutionScale: 1}}) as MediaStream; this.screen = stream;
    const videoTrack = stream.getVideoTracks()[0]; if (videoTrack) await this.setVideoTrack(videoTrack, stream);
    stream.getAudioTracks().forEach(track => this.peer?.addTrack(track, stream));
    if (videoTrack) (videoTrack as unknown as {onended?: () => void}).onended = () => { if (this.screen === stream) this.setScreenSharing(false).catch(() => {}); };
  }

  localStream(): MediaStream | undefined { return this.local; }
  screenStream(): MediaStream | undefined { return this.screen; }

  private async connect(takeover: boolean): Promise<void> {
    const generation = ++this.generation; this.clearTimers(); this.socket?.close(); this.peer?.close(); this.outgoingAudio = undefined; this.outgoingVideo = undefined;
    this.options.onProgress?.('Fetching relay configuration…');
    const iceServers = this.options.fetchICE ? await this.options.fetchICE() : await this.fetchICE();
    if (this.stopped || generation !== this.generation) return;
    this.options.onProgress?.('Preparing encrypted media…');
    const pendingLocal: object[] = []; const pendingRemote: object[] = [];
    let frameQueue = Promise.resolve();
    const peer = (this.options.createPeer || (configuration => new RTCPeerConnection(configuration)))({iceServers}); this.peer = peer;
    for(const track of this.local?.getTracks()||[]){const sender=peer.addTrack(track,this.local!);if(track.kind==='audio'){this.outgoingAudio=sender;if(this.manuallyMuted)await sender.replaceTrack(null)}} peer.addTransceiver('audio', {direction: 'sendrecv'}); peer.addTransceiver('video', {direction: 'recvonly'});
    peer.ontrack = (event: {streams: MediaStream[]; track: {id: string; kind: string; muted?: boolean; onended?: () => void; onmute?: () => void; onunmute?: () => void}}) => {
      const stream = (event.streams[0] || new MediaStream([event.track as never])) as MediaStream; const id = event.track.id || `${event.track.kind}-${this.remote.size}`; const ownerID = mediaOwnerID(id, stream.id); const item = {id, ownerID, stream, kind: event.track.kind as 'audio' | 'video'};
      const remove = () => { if (this.remote.get(id) === item) this.remote.delete(id); if (this.suspendedRemote.get(id) === item) this.suspendedRemote.delete(id); this.options.onRemote?.([...this.remote.values()]); };
      const suspend = () => { if (this.remote.get(id) === item) this.remote.delete(id); this.suspendedRemote.set(id, item); this.options.onRemote?.([...this.remote.values()]); };
      const publish = () => { if (event.track.kind === 'video' && ownerID) for (const [remoteID, current] of this.remote) if (current.kind === 'video' && current.ownerID === ownerID) this.remote.delete(remoteID); this.suspendedRemote.delete(id); this.remote.set(id, item); this.options.onRemote?.([...this.remote.values()]); };
      event.track.onended = remove;
      if (event.track.kind === 'video') { event.track.onmute = suspend; event.track.onunmute = publish; if (!event.track.muted) publish(); }
      else { const settings = this.options.settings || DEFAULT_VOICE_VIDEO_SETTINGS; setTrackVolume(event.track, settings.outputVolume * (settings.memberVolumes[ownerID] ?? 1)); publish(); }
    };
    peer.onicecandidate = (event: {candidate?: {toJSON(): object}}) => { if (!event.candidate) return; const frame = {type: 'candidate', candidate: event.candidate.toJSON()}; if (this.socket?.readyState === 1) this.send(frame); else pendingLocal.push(frame); };
    peer.onconnectionstatechange = () => { if (peer.connectionState === 'connected') { this.retry = 0; this.options.onStatus?.('connected'); this.startDiagnostics(peer, generation); } else if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') this.recover(new Error(`WebRTC ${peer.connectionState}`)); };
    this.startNoiseGate(peer, generation);
    const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
    this.options.onProgress?.('Opening media signaling…');
    const socket = (this.options.createSocket || nativeSocket)(this.mediaURL(), this.options.token); this.socket = socket;
    socket.onopen = () => { this.options.onProgress?.('Waiting for the media server…'); this.send({type: 'join', room_id: this.options.roomID, resume_token: this.resumeToken, takeover, sdp: peer.localDescription}); for (const frame of pendingLocal.splice(0)) this.send(frame); this.heartbeat = setInterval(() => this.send({type: 'heartbeat'}), 10000); };
    socket.onmessage = event => {
      const frame = JSON.parse(event.data) as MediaFrame;
      frameQueue = frameQueue.then(() => this.handleFrame(frame, peer, generation, pendingRemote)).catch(caught => this.recover(asError(caught)));
      return frameQueue;
    };
    socket.onerror = () => socket.close(); socket.onclose = () => { if (!this.stopped && generation === this.generation) this.recover(new Error('Media signaling closed')); };
  }

  private async handleFrame(frame: MediaFrame, peer: RTCPeerConnection, generation: number, pendingRemote: object[]) {
    if (this.stopped || generation !== this.generation || frame.type === 'heartbeat-ack') return;
    if (frame.type === 'error') { const error = new Error(frame.error || 'Media signaling failed') as Error & {code?: string}; error.code = frame.code; throw error; }
    if (frame.type === 'answer' && frame.sdp) { if (peer.signalingState && peer.signalingState !== 'have-local-offer') return; this.options.onProgress?.('Finishing media connection…'); await peer.setRemoteDescription(new RTCSessionDescription(frame.sdp as never)); await this.flushRemoteCandidates(peer, pendingRemote); if (frame.resume_token) this.resumeToken = frame.resume_token; if (frame.participants) this.options.onParticipants?.(frame.participants); this.send({type: 'screen-visibility', visible: this.screenVisible}); return; }
    if (frame.type === 'participants' && frame.participants) { this.options.onParticipants?.(frame.participants); return; }
    if (frame.type === 'candidate' && frame.candidate) { if (peer.remoteDescription) peer.addIceCandidate(frame.candidate as never).catch(() => {}); else pendingRemote.push(frame.candidate); return; }
    if (frame.type === 'offer' && frame.sdp) { await this.withNegotiation(async () => { const retryLocalOffer = peer.signalingState === 'have-local-offer'; if (retryLocalOffer) await peer.setLocalDescription({type: 'rollback'} as never); await peer.setRemoteDescription(new RTCSessionDescription(frame.sdp as never)); await this.flushRemoteCandidates(peer, pendingRemote); const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); this.send({type: 'answer', sdp: peer.localDescription}); if (retryLocalOffer) { const offer = await peer.createOffer(); await peer.setLocalDescription(offer); this.send({type: 'offer', sdp: peer.localDescription}); } }); }
    else if (frame.type === 'video-stopped' && frame.member_id) { for (const [id, item] of this.remote) if (item.kind === 'video' && item.ownerID === frame.member_id) { this.remote.delete(id); this.suspendedRemote.set(id, item); } this.options.onRemote?.([...this.remote.values()]); }
    else if (frame.type === 'video-started' && frame.member_id) { for (const [id, item] of this.suspendedRemote) if (item.kind === 'video' && item.ownerID === frame.member_id) { this.suspendedRemote.delete(id); this.remote.set(id, item); } this.options.onRemote?.([...this.remote.values()]); }
    else this.options.onFrame?.(frame);
  }

  private async flushRemoteCandidates(peer: RTCPeerConnection, pending: object[]) { for (const candidate of pending.splice(0)) peer.addIceCandidate(candidate as never).catch(() => {}); }

  private async renegotiate() { return this.withNegotiation(async () => { if (!this.peer) return; const offer = await this.peer.createOffer(); await this.peer.setLocalDescription(offer); this.send({type: 'offer', sdp: this.peer.localDescription}); }); }
  private withNegotiation(action: () => Promise<void>) { const result = this.negotiation.catch(() => {}).then(action); this.negotiation = result.catch(() => {}); return result; }
  private async setVideoTrack(track: MediaStream['getVideoTracks'] extends () => Array<infer T> ? T : never, stream: MediaStream) {
    if (!this.peer) return;
    if (this.outgoingVideo) { await this.outgoingVideo.sender.replaceTrack(track); this.send({type: 'video-started'}); return; }
    const transceiver = this.peer.addTransceiver(track, {direction: 'sendonly', streams: [stream]}); this.outgoingVideo = transceiver;
    const capabilities = RTCRtpSender.getCapabilities('video').codecs;
    const preferred = [...capabilities.filter(codec => codec.mimeType.toLowerCase() === 'video/vp8'), ...capabilities.filter(codec => codec.mimeType.toLowerCase() !== 'video/vp8')];
    if (preferred.length) transceiver.setCodecPreferences(preferred);
    await this.renegotiate(); this.send({type: 'video-started'});
  }
  private async clearVideoTrack() { if (!this.outgoingVideo) return; await this.outgoingVideo.sender.replaceTrack(null); }
  private recover(error: Error) { if (this.stopped || this.reconnect) return; this.options.onStatus?.('recovering', error); const delay = Math.min(4000, 500 * 2 ** Math.min(this.retry++, 3)); this.reconnect = (this.options.schedule || setTimeout)(() => { this.reconnect = undefined; this.connect(this.retry > 2).catch(caught => this.fail(caught)); }, delay); }
  private fail(caught: unknown) { const error = asError(caught); this.stopped = true; this.clearTimers(); this.release(this.screen); this.release(this.local); this.screen = undefined; this.local = undefined; this.peer?.close(); this.socket?.close(); this.options.onStatus?.('failed', error); }
  private send(frame: object) { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({version: 1, ...frame})); }
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
  private startNoiseGate(peer: RTCPeerConnection, generation: number) {
    if (this.gateTimer) clearInterval(this.gateTimer);
    let threshold = (this.options.settings || DEFAULT_VOICE_VIDEO_SETTINGS).noiseGateThresholdDB, gate = new AudioGate(threshold), running = false;
    this.gateTimer = setInterval(async () => {
      const settings = this.options.settings || DEFAULT_VOICE_VIDEO_SETTINGS, track = this.local?.getAudioTracks()[0];
      if (!track || this.stopped || generation !== this.generation || running) return;
      if (!settings.noiseGate) { if (!this.manuallyMuted) track.enabled = true; return; }
      if (threshold !== settings.noiseGateThresholdDB) { threshold = settings.noiseGateThresholdDB; gate = new AudioGate(threshold); }
      running = true;
      try {
        const reports = await peer.getStats(); let level: number | undefined;
        reports.forEach((report: {type?: string; kind?: string; audioLevel?: number}) => { if ((report.type === 'media-source' || report.type === 'track') && report.kind === 'audio' && typeof report.audioLevel === 'number') level = report.audioLevel; });
        if (level !== undefined && !this.manuallyMuted) track.enabled = gate.observe(level > 0 ? 20 * Math.log10(level) : -100, Date.now());
      } catch {} finally { running = false; }
    }, 100);
  }
  private clearTimers() { if (this.heartbeat) clearInterval(this.heartbeat); if (this.diagnostics) clearInterval(this.diagnostics); if (this.gateTimer) clearInterval(this.gateTimer); if (this.reconnect) clearTimeout(this.reconnect); this.heartbeat = undefined; this.diagnostics = undefined; this.gateTimer = undefined; this.reconnect = undefined; }
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
  return left.microphoneID === right.microphoneID && left.echoCancellation === right.echoCancellation && left.noiseSuppression === right.noiseSuppression && left.noiseSuppressionMode === right.noiseSuppressionMode && left.autoGainControl === right.autoGainControl;
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
