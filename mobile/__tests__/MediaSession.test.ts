import {MediaSession} from '../src/media/MediaSession';

function harness() {
  const track = {id: 'audio-1', kind: 'audio', enabled: true, stop: jest.fn()};
  const local = {getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [], addTrack: jest.fn(), removeTrack: jest.fn()};
  const peer: any = {
    addTrack: jest.fn(), addTransceiver: jest.fn(), createOffer: jest.fn(async () => ({type: 'offer', sdp: 'offer'})),
    setLocalDescription: jest.fn(async () => {}), setRemoteDescription: jest.fn(async () => {}), addIceCandidate: jest.fn(async () => {}),
    createAnswer: jest.fn(async () => ({type: 'answer', sdp: 'answer'})), getSenders: () => [], removeTrack: jest.fn(), close: jest.fn(),
    localDescription: {type: 'offer', sdp: 'offer'}, remoteDescription: null, connectionState: 'new', ontrack: null, onicecandidate: null, onconnectionstatechange: null,
  };
  peer.setRemoteDescription.mockImplementation(async (description: object) => { peer.remoteDescription = description; });
  const socket: any = {readyState: 1, onopen: null, onmessage: null, onerror: null, onclose: null, send: jest.fn(), close: jest.fn()};
  const statuses: string[] = []; const participants: string[][] = [];
  const session = new MediaSession({
    instanceURL: 'https://chat.example.test', token: 'session-token', roomID: 'voice-1',
    getUserMedia: jest.fn(async () => local as never), fetchICE: jest.fn(async () => []),
    createPeer: () => peer as never, createSocket: () => socket as never, onStatus: status => statuses.push(status), onParticipants: values => participants.push(values.map(value => value.member_id)),
  });
  return {local, participants, peer, session, socket, statuses, track};
}

describe('MediaSession', () => {
  it('joins with the versioned room protocol and becomes connected on answer', async () => {
    const {participants, session, socket, statuses} = harness();
    await session.start();
    socket.onopen?.();
    await socket.onmessage?.({data: JSON.stringify({version: 1, type: 'answer', sdp: {type: 'answer', sdp: 'answer'}, resume_token: 'resume-1', participants: [{member_id: 'member-1'}]})});

    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({version: 1, type: 'join', room_id: 'voice-1'});
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(participants).toEqual([['member-1']]);
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

  it('queues local ICE candidates until signaling opens', async () => {
    const {session, socket, peer} = harness(); socket.readyState = 0;
    await session.start();
    peer.onicecandidate?.({candidate: {toJSON: () => ({candidate: 'candidate:local'})}});
    expect(socket.send).not.toHaveBeenCalled();

    socket.readyState = 1; socket.onopen?.();
    expect(socket.send.mock.calls.map((call: string[]) => JSON.parse(call[0]).type)).toEqual(['join', 'candidate']);
    session.stop();
  });
});
