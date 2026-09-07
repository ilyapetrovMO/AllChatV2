const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}) {
  const peers = [], sockets = [], frames = [], states = [];
  class Peer {
    constructor() { this.signalingState = 'stable'; this.connectionState = 'new'; this.transceivers = []; }
    addTrack() { return {}; }
    addTransceiver() { const peer = this; const value = {sender: {async replaceTrack() { if(peer.closed) throw Error('closed sender'); }}}; this.transceivers.push(value); return value; }
    async createOffer() { return {type: 'offer', sdp: 'test'}; }
    async setLocalDescription(value) { this.localDescription = value; this.signalingState = value.type === 'offer' ? 'have-local-offer' : 'stable'; }
    async setRemoteDescription(value) { this.remoteDescription = value; this.signalingState = 'stable'; }
    async createAnswer() { return {type: 'answer', sdp: 'test'}; }
    close() { this.closed = true; }
  }
  class Socket {
    constructor() { this.readyState = 0; setImmediate(() => { this.readyState = 1; this.onopen?.(); }); }
    send(encoded) {
      const frame = JSON.parse(encoded); frames.push(frame);
      if(frame.type === 'join' || frame.type === 'offer') setImmediate(() => this.onmessage?.({data: JSON.stringify({type: 'answer', negotiation_id: frame.negotiation_id, sdp: {type: 'answer'}, resume_token: frame.type === 'join' ? 'test-token' : undefined})}));
    }
    close() { this.readyState = 3; }
  }
  const context = {window: {}, setTimeout, clearTimeout, setInterval, clearInterval};
  vm.runInNewContext(fs.readFileSync('internal/instance/web/assets/voice-connection.js', 'utf8'), context);
  const connection = new context.window.AllChatVoiceConnection({roomID: 'test', stream: {getTracks: () => []}, fetchCredentials: async () => [], createPeer: () => { const peer = new Peer(); peers.push(peer); return peer; }, createSocket: () => { const socket = new Socket(); sockets.push(socket); return socket; }, onState: state => states.push(state), ...options});
  return {connection, peers, sockets, frames, states};
}

test('web sharing uses the replacement peer after reconnect', async t => {
  const {connection, peers} = harness(); t.after(() => connection.stop());
  await connection.start(); await connection.setVideoTrack({}, {}); await tick();
  await connection._connect(connection.resumeToken);
  await connection.setVideoTrack({}, {});
  assert.equal(peers[1].transceivers.length, 2);
});

test('web recovery expires even when credentials never settle', async t => {
  const {connection, states} = harness({fetchCredentials: () => new Promise(() => {}), recoveryTimeout: 20, recoveryDelays: [0]});
  t.after(() => connection.stop()); connection.stopped = false;
  await connection._recover(new Error('outage'));
  assert.equal(states.at(-1), 'failed');
});

test('web command rejection leaves the media session alive', async t => {
  const received = []; const {connection, sockets} = harness({onFrame: frame => received.push(frame)}); t.after(() => connection.stop());
  await connection.start();
  sockets[0].onmessage({data: JSON.stringify({type: 'command-error', scope: 'soundboard-play'})}); await tick();
  assert.equal(connection.stopped, false); assert.equal(received.length, 1);
});

test('web ignores a delayed answer to an obsolete offer', async t => {
  const {connection, sockets, peers} = harness(); t.after(() => connection.stop());
  await connection.start();
  peers[0].signalingState = 'have-local-offer'; connection.localOfferID = 'client-9';
  sockets[0].onmessage({data: JSON.stringify({type: 'answer', negotiation_id: 'client-8', sdp: {type: 'answer', sdp: 'obsolete'}})}); await tick();
  assert.notEqual(peers[0].remoteDescription.sdp, 'obsolete');
});

test('web capture preparation releases a late microphone after dependency rejection', async () => {
  let resolveCapture, stopped = 0;
  const context = {window: {}, navigator: {mediaDevices: {getUserMedia: () => new Promise(resolve => {resolveCapture = resolve;})}}, localStorage: {getItem: () => null}, document: {body: {dataset: {}}}, location: {origin: 'test'}};
  vm.runInNewContext(fs.readFileSync('internal/instance/web/assets/voice-settings.js', 'utf8'), context);
  await assert.rejects(context.window.AllChatVoiceSettings.prepare([Promise.reject(Error('credentials unavailable'))]));
  resolveCapture({getTracks: () => [{stop() {stopped++;}}], getAudioTracks: () => []}); await tick();
  assert.equal(stopped, 1);
});
