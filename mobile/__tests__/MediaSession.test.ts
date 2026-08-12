import {MediaSession, mediaOwnerID} from '../src/media/MediaSession';

function harness() {
  const track = {id: 'audio-1', kind: 'audio', enabled: true, stop: jest.fn()};
  const cameraTrack = {id: 'camera-1', kind: 'video', enabled: true, stop: jest.fn(), _switchCamera: jest.fn()}; const screenTrack = {id: 'screen-1', kind: 'video', enabled: true, stop: jest.fn()};
  const videoTracks: typeof cameraTrack[] = [];
  const local = {getTracks: () => [track, ...videoTracks], getAudioTracks: () => [track], getVideoTracks: () => videoTracks, addTrack: jest.fn((item: typeof cameraTrack) => videoTracks.push(item)), removeTrack: jest.fn((item: typeof cameraTrack) => { const index = videoTracks.indexOf(item); if (index >= 0) videoTracks.splice(index, 1); })};
  const cameraStream = {getTracks: () => [cameraTrack], getAudioTracks: () => [], getVideoTracks: () => [cameraTrack]};
  const screenStream = {getTracks: () => [screenTrack], getAudioTracks: () => [], getVideoTracks: () => [screenTrack]};
  const senders: Array<{track: typeof cameraTrack | typeof screenTrack}> = [];
  const peer: any = {
    addTrack: jest.fn(), addTransceiver: jest.fn((source: string | typeof cameraTrack | typeof screenTrack) => { const sender = {track: typeof source === 'string' ? undefined : source}; if (sender.track) senders.push(sender as never); return {sender, setCodecPreferences: jest.fn()}; }), createOffer: jest.fn(async () => ({type: 'offer', sdp: 'offer'})),
    setLocalDescription: jest.fn(async () => {}), setRemoteDescription: jest.fn(async () => {}), addIceCandidate: jest.fn(async () => {}),
    createAnswer: jest.fn(async () => ({type: 'answer', sdp: 'answer'})), getSenders: () => senders, removeTrack: jest.fn((sender: never) => { const index = senders.indexOf(sender); if (index >= 0) senders.splice(index, 1); }), close: jest.fn(),
    localDescription: {type: 'offer', sdp: 'offer'}, remoteDescription: null, connectionState: 'new', ontrack: null, onicecandidate: null, onconnectionstatechange: null,
  };
  peer.setRemoteDescription.mockImplementation(async (description: object) => { peer.remoteDescription = description; });
  const socket: any = {readyState: 1, onopen: null, onmessage: null, onerror: null, onclose: null, send: jest.fn(), close: jest.fn()};
  const statuses: string[] = []; const participants: string[][] = []; const progress: string[] = []; const remotes: Array<Array<{id: string; ownerID: string}>> = [];
  const session = new MediaSession({
    instanceURL: 'https://chat.example.test', token: 'session-token', roomID: 'voice-1',
    getUserMedia: jest.fn(async constraints => ((constraints as {video?: unknown}).video ? cameraStream : local) as never), getDisplayMedia: jest.fn(async () => screenStream as never), fetchICE: jest.fn(async () => []),
    createPeer: () => peer as never, createSocket: () => socket as never, onStatus: status => statuses.push(status), onProgress: value => progress.push(value), onRemote: values => remotes.push(values.map(value => ({id: value.id, ownerID: value.ownerID}))), onParticipants: values => participants.push(values.map(value => value.member_id)),
  });
  return {cameraTrack, local, participants, peer, progress, remotes, screenTrack, session, socket, statuses, track};
}

describe('MediaSession', () => {
  it('uses SFU stream identity instead of rewritten native track IDs', () => {
    expect(mediaOwnerID('native-random-track', 'member-member-1')).toBe('member-1');
    expect(mediaOwnerID('native-random-track', 'screen-member-2')).toBe('member-2');
    expect(mediaOwnerID('audio-member-3')).toBe('member-3');
    expect(mediaOwnerID('native-random-track')).toBe('');
  });

  it('joins with the versioned room protocol and becomes connected on answer', async () => {
    const {participants, peer, session, socket, statuses} = harness();
    await session.start();
    socket.onopen?.();
    await socket.onmessage?.({data: JSON.stringify({version: 1, type: 'answer', sdp: {type: 'answer', sdp: 'answer'}, resume_token: 'resume-1', participants: [{member_id: 'member-1'}]})});

    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({version: 1, type: 'join', room_id: 'voice-1'});
    expect(peer.addTransceiver).toHaveBeenCalledWith('video', {direction: 'recvonly'});
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(participants).toEqual([['member-1']]);
    session.stop();
  });

  it('reports receiver visibility after signaling connects', async () => {
    const {session, socket} = harness();
    session.setScreenVisible(true);
    await session.start(); socket.onopen?.(); socket.send.mockClear();

    await socket.onmessage?.({data: JSON.stringify({version: 1, type: 'answer', sdp: {type: 'answer', sdp: 'answer'}})});

    expect(socket.send.mock.calls.map((call: string[]) => JSON.parse(call[0]))).toContainEqual(expect.objectContaining({type: 'screen-visibility', visible: true}));
    session.stop();
  });

  it('always stops local tracks when the Session ends', async () => {
    const {session, socket, peer, track} = harness();
    await session.start(); socket.onopen?.();

    session.stop();

    expect(track.stop).toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalled();
  });

  it('updates microphone state and informs the server', async () => {
    const {session, socket, track} = harness();
    await session.start(); socket.onopen?.(); socket.send.mockClear();

    session.setMuted(true);

    expect(track.enabled).toBe(false);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({type: 'mute-state', muted: true});
    session.stop();
  });

  it('sends soundboard playback through media signaling', async () => {
    const {session, socket} = harness();
    await session.start(); socket.onopen?.(); socket.send.mockClear();
    session.playSound('sound-1');
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({type: 'soundboard-play', sound_id: 'sound-1'});
    session.stop();
  });

  it('queues remote ICE candidates until the remote description is set', async () => {
    const {session, socket, peer} = harness();
    await session.start(); socket.onopen?.();
    const candidate = {candidate: 'candidate:1'};

    await socket.onmessage?.({data: JSON.stringify({version: 1, type: 'candidate', candidate})});
    expect(peer.addIceCandidate).not.toHaveBeenCalled();

    await socket.onmessage?.({data: JSON.stringify({version: 1, type: 'answer', sdp: {type: 'answer', sdp: 'answer'}})});
    expect(peer.addIceCandidate).toHaveBeenCalledWith(candidate);
    session.stop();
  });

  it('serializes an initial answer and immediate SFU offer', async () => {
    const {session, socket, peer, statuses} = harness();
    let settingRemote = false;
    peer.setRemoteDescription.mockImplementation(async (description: object) => {
      if (settingRemote) throw new Error('concurrent remote description');
      settingRemote = true;
      await new Promise<void>(resolve => setTimeout(() => resolve(), 5));
      peer.remoteDescription = description;
      settingRemote = false;
    });
    await session.start(); socket.onopen?.(); socket.send.mockClear();

    const answer = socket.onmessage?.({data: JSON.stringify({version: 1, type: 'answer', sdp: {type: 'answer', sdp: 'answer'}})});
    const offer = socket.onmessage?.({data: JSON.stringify({version: 1, type: 'offer', sdp: {type: 'offer', sdp: 'offer'}})});
    await Promise.all([answer, offer]);

    expect(statuses).toContain('connected');
    expect(socket.send.mock.calls.map((call: string[]) => JSON.parse(call[0]).type)).toContain('answer');
    session.stop();
  });

  it('replaces restarted remote video and ignores the old track ending', async () => {
    const {session, socket, peer, remotes} = harness();
    await session.start(); socket.onopen?.();
    const firstTrack = {id: 'screen-member-2', kind: 'video', onended: undefined as undefined | (() => void)};
    const secondTrack = {id: 'screen-member-2', kind: 'video', onended: undefined as undefined | (() => void)};
    peer.ontrack?.({track: firstTrack, streams: [{id: 'screen-member-2'}]});
    peer.ontrack?.({track: secondTrack, streams: [{id: 'screen-member-2'}]});
    firstTrack.onended?.();

    expect(remotes.at(-1)).toEqual([{id: 'screen-member-2', ownerID: 'member-2'}]);
    await socket.onmessage?.({data: JSON.stringify({version: 1, type: 'video-stopped', member_id: 'member-2'})});
    expect(remotes.at(-1)).toEqual([]);
    session.stop();
  });

  it('reports detailed connection progress', async () => {
    const {progress, session, socket} = harness();
    await session.start(); socket.onopen?.();
    await socket.onmessage?.({data: JSON.stringify({version: 1, type: 'answer', sdp: {type: 'answer', sdp: 'answer'}})});
    expect(progress).toEqual(['Fetching relay configuration…', 'Preparing encrypted media…', 'Opening media signaling…', 'Waiting for the media server…', 'Finishing media connection…']);
    session.stop();
  });

  it('queues local ICE candidates until signaling opens', async () => {
    const {session, socket, peer} = harness(); socket.readyState = 0;
    await session.start();
    peer.onicecandidate?.({candidate: {toJSON: () => ({candidate: 'candidate:local'})}});
    expect(socket.send).not.toHaveBeenCalled();

    socket.readyState = 1; socket.onopen?.();
    expect(socket.send.mock.calls.map((call: string[]) => JSON.parse(call[0]).type)).toEqual(['join', 'candidate']);
    session.stop();
  });

  it('keeps camera and screen capture mutually exclusive', async () => {
    const {cameraTrack, screenTrack, session, socket} = harness();
    session.setScreenVisible(true);
    await session.start(); socket.onopen?.(); socket.send.mockClear();

    await session.setCamera(true);
    expect(session.localStream()?.getVideoTracks()).toEqual([cameraTrack]);
    await session.setScreenSharing(true);
    expect(cameraTrack.stop).toHaveBeenCalled();
    expect(session.localStream()?.getVideoTracks()).toEqual([]);

    await session.setCamera(true);
    expect(screenTrack.stop).toHaveBeenCalled();
    expect(session.screenStream()).toBeUndefined();
    expect(session.localStream()?.getVideoTracks()).toEqual([cameraTrack]);
    expect(socket.send.mock.calls.map((call: string[]) => JSON.parse(call[0])).filter((frame: {type?: string}) => frame.type === 'screen-visibility')).toEqual([]);
    session.stop();
  });

  it('switches between the front and rear native cameras', async () => {
    const {cameraTrack, session} = harness();
    await session.start(); await session.setCamera(true);
    session.switchCamera();
    expect(cameraTrack._switchCamera).toHaveBeenCalledTimes(1);
    session.stop();
  });
});
