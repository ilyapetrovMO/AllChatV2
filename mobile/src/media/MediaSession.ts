import {mediaDevices, MediaStream, RTCPeerConnection, RTCRtpSender, RTCSessionDescription} from 'react-native-webrtc';

export type MediaStatus = 'idle' | 'connecting' | 'connected' | 'recovering' | 'failed';
export type MediaParticipant = {member_id: string; connected?: boolean; muted?: boolean; server_muted?: boolean; speaking?: boolean; screen_sharing?: boolean};
export type RemoteMedia = {id: string; ownerID: string; stream: MediaStream; kind: 'audio' | 'video'};
type SocketLike = {readyState: number; onopen: null | (() => void); onmessage: null | ((event: {data: string}) => void); onerror: null | (() => void); onclose: null | (() => void); send(value: string): void; close(): void};
type MediaFrame = {type: string; code?: string; error?: string; sdp?: object; candidate?: object; resume_token?: string; participants?: MediaParticipant[]; sound?: {id: string; name: string; emoji?: string; audio_url: string}};
type IceServer = {urls: string | string[]; username?: string; credential?: string};
type PeerConfiguration = {iceServers: IceServer[]};

export type MediaSessionOptions = {
  instanceURL: string; token: string; roomID: string;
  onStatus?(status: MediaStatus, error?: Error): void;
  onRemote?(media: RemoteMedia[]): void;
  onParticipants?(participants: MediaParticipant[]): void;
  onFrame?(frame: MediaFrame): void;
  fetchICE?(): Promise<IceServer[]>;
  createPeer?(configuration: PeerConfiguration): RTCPeerConnection;
  createSocket?(url: string, token: string): SocketLike;
  getUserMedia?(constraints: object): Promise<MediaStream>;
  schedule?(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
};

export class MediaSession {
  private peer?: RTCPeerConnection; private socket?: SocketLike; private local?: MediaStream;
  private screen?: MediaStream; private remote = new Map<string, RemoteMedia>(); private resumeToken = '';
  private stopped = true; private generation = 0; private heartbeat?: ReturnType<typeof setInterval>; private reconnect?: ReturnType<typeof setTimeout>; private retry = 0;
  constructor(private readonly options: MediaSessionOptions) {}

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false; this.retry = 0; this.options.onStatus?.('connecting');
    try { this.local = await (this.options.getUserMedia || mediaDevices.getUserMedia)({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}, video: false}) as MediaStream; await this.connect(false); }
    catch (caught) { this.fail(caught); }
  }

  stop(explicit = true): void {
    if (explicit && this.socket?.readyState === 1) this.send({type: 'leave'});
    this.stopped = true; this.generation += 1; this.clearTimers(); this.socket?.close(); this.peer?.close();
    this.socket = undefined; this.peer = undefined; this.release(this.screen); this.release(this.local); this.screen = undefined; this.local = undefined; this.remote.clear(); this.options.onRemote?.([]); this.options.onStatus?.('idle');
  }

  setMuted(muted: boolean): void { this.local?.getAudioTracks().forEach(track => { track.enabled = !muted; }); this.send({type: 'mute-state', muted}); }
  playSound(soundID: string): void { this.send({type: 'soundboard-play', sound_id: soundID}); }

  async setCamera(enabled: boolean): Promise<void> {
    if (!this.peer || !this.local) throw new Error('Media Session is not connected.');
    const existing = this.local.getVideoTracks()[0];
    if (!enabled && existing) { existing.stop(); this.local.removeTrack(existing); const sender = this.peer.getSenders().find(item => item.track?.id === existing.id); if (sender) this.peer.removeTrack(sender); await this.renegotiate(); return; }
    if (enabled && !existing) { const camera = await (this.options.getUserMedia || mediaDevices.getUserMedia)({audio: false, video: {facingMode: 'user'}}) as MediaStream; const track = camera.getVideoTracks()[0]; if (track) { this.local.addTrack(track); this.addVideoTrack(track, this.local); await this.renegotiate(); } }
  }

  async setScreenSharing(enabled: boolean): Promise<void> {
    if (!this.peer) throw new Error('Media Session is not connected.');
    if (!enabled) { const stream = this.screen; this.screen = undefined; stream?.getTracks().forEach(track => { const sender = this.peer?.getSenders().find(item => item.track?.id === track.id); if (sender) this.peer?.removeTrack(sender); track.stop(); }); this.send({type: 'screen-visibility', visible: false}); await this.renegotiate(); return; }
    if (this.screen) return;
    const stream = await mediaDevices.getDisplayMedia({android: {resolutionScale: 1}}) as MediaStream; this.screen = stream;
    const videoTrack = stream.getVideoTracks()[0]; if (videoTrack) this.addVideoTrack(videoTrack, stream);
    stream.getAudioTracks().forEach(track => this.peer?.addTrack(track, stream)); this.send({type: 'screen-visibility', visible: true});
    if (videoTrack) (videoTrack as unknown as {onended?: () => void}).onended = () => { if (this.screen === stream) this.setScreenSharing(false).catch(() => {}); };
    await this.renegotiate();
  }

  localStream(): MediaStream | undefined { return this.local; }
  screenStream(): MediaStream | undefined { return this.screen; }

  private async connect(takeover: boolean): Promise<void> {
    const generation = ++this.generation; this.clearTimers(); this.socket?.close(); this.peer?.close();
    const iceServers = this.options.fetchICE ? await this.options.fetchICE() : await this.fetchICE();
    if (this.stopped || generation !== this.generation) return;
    const pendingLocal: object[] = []; const pendingRemote: object[] = [];
    const peer = (this.options.createPeer || (configuration => new RTCPeerConnection(configuration)))({iceServers}); this.peer = peer;
    this.local?.getTracks().forEach(track => peer.addTrack(track, this.local!)); peer.addTransceiver('audio', {direction: 'sendrecv'});
    peer.ontrack = (event: {streams: MediaStream[]; track: {id: string; kind: string; onended?: () => void}}) => { const stream = (event.streams[0] || new MediaStream([event.track as never])) as MediaStream; const id = event.track.id || `${event.track.kind}-${this.remote.size}`; this.remote.set(id, {id, ownerID: mediaOwnerID(id, stream.id), stream, kind: event.track.kind as 'audio' | 'video'}); this.options.onRemote?.([...this.remote.values()]); event.track.onended = () => { this.remote.delete(id); this.options.onRemote?.([...this.remote.values()]); }; };
    peer.onicecandidate = (event: {candidate?: {toJSON(): object}}) => { if (!event.candidate) return; const frame = {type: 'candidate', candidate: event.candidate.toJSON()}; if (this.socket?.readyState === 1) this.send(frame); else pendingLocal.push(frame); };
    peer.onconnectionstatechange = () => { if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') this.recover(new Error(`WebRTC ${peer.connectionState}`)); };
    const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
    const socket = (this.options.createSocket || nativeSocket)(this.mediaURL(), this.options.token); this.socket = socket;
    socket.onopen = () => { this.send({type: 'join', room_id: this.options.roomID, resume_token: this.resumeToken, takeover, sdp: peer.localDescription}); for (const frame of pendingLocal.splice(0)) this.send(frame); this.heartbeat = setInterval(() => this.send({type: 'heartbeat'}), 10000); };
    socket.onmessage = event => this.handleFrame(JSON.parse(event.data) as MediaFrame, peer, generation, pendingRemote).catch(caught => this.recover(asError(caught)));
    socket.onerror = () => socket.close(); socket.onclose = () => { if (!this.stopped && generation === this.generation) this.recover(new Error('Media signaling closed')); };
  }

  private async handleFrame(frame: MediaFrame, peer: RTCPeerConnection, generation: number, pendingRemote: object[]) {
    if (this.stopped || generation !== this.generation || frame.type === 'heartbeat-ack') return;
    if (frame.type === 'error') { const error = new Error(frame.error || 'Media signaling failed') as Error & {code?: string}; error.code = frame.code; throw error; }
    if (frame.type === 'answer' && frame.sdp) { await peer.setRemoteDescription(new RTCSessionDescription(frame.sdp as never)); await this.flushRemoteCandidates(peer, pendingRemote); if (frame.resume_token) this.resumeToken = frame.resume_token; if (frame.participants) this.options.onParticipants?.(frame.participants); this.retry = 0; this.options.onStatus?.('connected'); return; }
    if (frame.type === 'candidate' && frame.candidate) { if (peer.remoteDescription) await peer.addIceCandidate(frame.candidate as never); else pendingRemote.push(frame.candidate); return; }
    if (frame.type === 'offer' && frame.sdp) { await peer.setRemoteDescription(new RTCSessionDescription(frame.sdp as never)); await this.flushRemoteCandidates(peer, pendingRemote); const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); this.send({type: 'answer', sdp: peer.localDescription}); }
    else this.options.onFrame?.(frame);
  }

  private async flushRemoteCandidates(peer: RTCPeerConnection, pending: object[]) { for (const candidate of pending.splice(0)) await peer.addIceCandidate(candidate as never); }

  private async renegotiate() { if (!this.peer) return; const offer = await this.peer.createOffer(); await this.peer.setLocalDescription(offer); this.send({type: 'offer', sdp: this.peer.localDescription}); }
  private addVideoTrack(track: MediaStream['getVideoTracks'] extends () => Array<infer T> ? T : never, stream: MediaStream) {
    if (!this.peer) return;
    const transceiver = this.peer.addTransceiver(track, {direction: 'sendonly', streams: [stream]});
    const capabilities = RTCRtpSender.getCapabilities('video').codecs;
    const preferred = [...capabilities.filter(codec => codec.mimeType.toLowerCase() === 'video/vp8'), ...capabilities.filter(codec => codec.mimeType.toLowerCase() !== 'video/vp8')];
    if (preferred.length) transceiver.setCodecPreferences(preferred);
  }
  private recover(error: Error) { if (this.stopped || this.reconnect) return; this.options.onStatus?.('recovering', error); const delay = Math.min(4000, 500 * 2 ** Math.min(this.retry++, 3)); this.reconnect = (this.options.schedule || setTimeout)(() => { this.reconnect = undefined; this.connect(this.retry > 2).catch(caught => this.fail(caught)); }, delay); }
  private fail(caught: unknown) { const error = asError(caught); this.stopped = true; this.clearTimers(); this.release(this.screen); this.release(this.local); this.screen = undefined; this.local = undefined; this.peer?.close(); this.socket?.close(); this.options.onStatus?.('failed', error); }
  private send(frame: object) { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({version: 1, ...frame})); }
  private clearTimers() { if (this.heartbeat) clearInterval(this.heartbeat); if (this.reconnect) clearTimeout(this.reconnect); this.heartbeat = undefined; this.reconnect = undefined; }
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

function nativeSocket(url: string, token: string) { return new WebSocket(url, null, {headers: {Authorization: `Bearer ${token}`}}) as unknown as SocketLike; }
function asError(value: unknown) { return value instanceof Error ? value : new Error('Media Session failed.'); }
export function mediaOwnerID(trackID: string, streamID = '') {
  for (const value of [streamID, trackID]) {
    const match = /^(?:member|audio|screen)-(.+)$/.exec(value);
    if (match) return match[1];
  }
  return '';
}
