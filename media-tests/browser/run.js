const {chromium, firefox, webkit, request} = require('@playwright/test');
const {spawn} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const host = '127.0.0.1';
const port = Number(process.env.ALLCHAT_MEDIA_PORT || 4200 + process.pid % 1000);
const baseURL = `http://${host}:${port}`;
const password = 'media test password';
const browserName = process.env.ALLCHAT_MEDIA_BROWSER || 'chromium';
const only = process.env.ALLCHAT_MEDIA_ONLY || '';
const browserType = {chromium, firefox, webkit, electron: chromium}[browserName];
if (!browserType) throw new Error(`unsupported ALLCHAT_MEDIA_BROWSER: ${browserName}`);
const diagnosticDirectory = path.resolve(__dirname, '../../.dev/media-tests', browserName);
const failurePath = path.join(diagnosticDirectory, 'failure.json');
const hardTimeoutMS = Number(process.env.ALLCHAT_MEDIA_TIMEOUT_MS || 5 * 60_000);
const startupTimeoutMS = Number(process.env.ALLCHAT_MEDIA_STARTUP_TIMEOUT_MS || 120_000);
const timeline = [];
let currentPhase = 'initializing';

function markPhase(phase) {
  currentPhase = phase;
  const elapsedMS = Date.now() - startedAt;
  timeline.push({phase, elapsed_ms: elapsedMS});
  process.stdout.write(`[media:${browserName}] ${phase} (${elapsedMS}ms)\n`);
}

function writeFailure(error) {
  fs.mkdirSync(diagnosticDirectory, {recursive: true});
  fs.writeFileSync(failurePath, JSON.stringify({
    schema: 'allchat.media.failure/v1', browser: browserName, at: new Date().toISOString(),
    phase: currentPhase, elapsed_ms: Date.now() - startedAt, timeline,
    error: String(error?.stack || error),
  }, null, 2));
}

const startedAt = Date.now();
fs.rmSync(failurePath, {force: true});
const watchdog = setTimeout(() => {
  const error = new Error(`media test exceeded ${hardTimeoutMS}ms during ${currentPhase}`);
  writeFailure(error);
  console.error(error);
  process.exit(1);
}, hardTimeoutMS);

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  writeFailure(new Error(`media test received ${signal} during ${currentPhase}`));
  process.exit(1);
});

async function waitForServer(deadline = Date.now() + startupTimeoutMS) {
  while (Date.now() < deadline) {
    try { const response = await fetch(`${baseURL}/login`); if (response.ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`media test Instance did not start within ${startupTimeoutMS}ms`);
}

async function csrf(context) {
  const state = await context.storageState();
  return state.cookies.find(cookie => cookie.name === 'allchat_csrf')?.value || '';
}

async function post(context, url, data) {
  const response = await context.post(url, {data, headers: {'X-CSRF-Token': await csrf(context)}});
  if (!response.ok()) throw new Error(`${url}: ${response.status()} ${await response.text()}`);
  return response.json();
}

async function provision(dataDirectory) {
  const token = fs.readFileSync(path.join(dataDirectory, 'setup.token'), 'utf8').trim();
  const first = await request.newContext({baseURL});
  let response = await first.post('/api/v1/auth/setup', {data: {token, username: 'media-owner', password}});
  if (response.status() !== 201) throw new Error(`setup: ${response.status()} ${await response.text()}`);
  const firstMember = await response.json();
  const category = await post(first, '/api/v1/categories', {name: 'Media tests', position: 1});
  const room = await post(first, '/api/v1/channels', {category_id: category.id, name: 'Media room', type: 'voice', position: 1});
  const invitation = await post(first, '/api/v1/invitations', {expires_in_minutes: 10, max_uses: 1});
  const second = await request.newContext({baseURL});
  response = await second.post('/api/v1/auth/register', {data: {token: invitation.token, username: 'media-member', password}});
  if (response.status() !== 201) throw new Error(`register: ${response.status()} ${await response.text()}`);
  const secondMember = await response.json();
  const dm = await post(first, '/api/v1/dms', {member_id: secondMember.id});
  return {first, second, firstMember, secondMember, room, dm};
}

async function assertSketchboardCreate(browser, api) {
  const context = await browser.newContext({storageState: await api.storageState()});
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/activities/allchat.sketchboard`);
    const activity = page.frameLocator('iframe[title="AllChat Activity"]');
    await activity.getByLabel('Board name').fill('Browser reliability board');
    await activity.getByRole('button', {name: 'Create board'}).click();
    await activity.getByRole('heading', {name: 'Browser reliability board'}).waitFor({timeout: 10_000});
		await activity.getByRole('button', {name: 'Enter'}).click();
		await activity.locator('#board-workspace').waitFor({state: 'visible'});
		if (await activity.locator('#board-grid').isVisible()) throw new Error('Sketchboard catalog remained visible after Enter');
		const canvas = await activity.locator('#sketch-canvas').boundingBox();
		const viewport = page.viewportSize();
		if (!canvas || !viewport || canvas.height < viewport.height * 0.7 || canvas.width < viewport.width * 0.8) {
			throw new Error(`Sketchboard canvas did not fill the Activity viewport: canvas=${JSON.stringify(canvas)} viewport=${JSON.stringify(viewport)}`);
		}
		const canvasAspect = await activity.locator('#sketch-canvas').evaluate(element => ({intrinsic: element.width / element.height, displayed: element.clientWidth / element.clientHeight}));
		if (Math.abs(canvasAspect.intrinsic - canvasAspect.displayed) / canvasAspect.intrinsic > 0.02) {
			throw new Error(`Sketchboard canvas aspect ratio is distorted: ${JSON.stringify(canvasAspect)}`);
		}
		await activity.locator('#sketch-canvas').evaluate(element => {
			const context = element.getContext('2d');
			context.fillStyle = '#000';
			context.fillRect(0, 0, 8, 8);
		});
		await activity.getByRole('button', {name: 'Clear'}).click();
		const confirmClear = activity.getByRole('button', {name: 'Confirm clear'});
		await confirmClear.waitFor({timeout: 2_000});
		await new Promise(resolve => setTimeout(resolve, 500));
		await confirmClear.click();
		const clearDeadline = Date.now() + 5_000;
		while (Date.now() < clearDeadline) {
			const pixel = await activity.locator('#sketch-canvas').evaluate(element => Array.from(element.getContext('2d').getImageData(1, 1, 1, 1).data));
			if (pixel.every(channel => channel === 255)) break;
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		const pixel = await activity.locator('#sketch-canvas').evaluate(element => Array.from(element.getContext('2d').getImageData(1, 1, 1, 1).data));
		if (!pixel.every(channel => channel === 255)) throw new Error(`Sketchboard clear operation did not clear the canvas: pixel=${pixel}`);
  } finally {
    await context.close();
  }
}

async function attachEndpoint(browser, api, roomID, name, {video = true} = {}) {
  const context = await browser.newContext({storageState: await api.storageState()});
  const page = await context.newPage();
  // Use a real local navigation so browser local-network permission checks
  // see the server address. The test owns its controller; prevent automatic
  // Direct Call polling from acquiring a competing session on this page.
  await page.route('**/assets/call.js', route => route.fulfill({contentType: 'application/javascript', body: ''}));
  await page.goto(`${baseURL}/`);
  await page.addScriptTag({url: '/assets/voice-connection.js'});
  await page.locator('body').click({position: {x: 1, y: 1}});
  await page.evaluate(async ({roomID, name, video}) => {
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const audioDestination = audio.createMediaStreamDestination();
    oscillator.frequency.value = name === 'first' ? 440 : 660;
    oscillator.connect(audioDestination); oscillator.start();
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d'); let frame = 0;
    const draw = setInterval(() => { context.fillStyle = frame++ % 2 ? '#00ff00' : '#0000ff'; context.fillRect(0, 0, 320, 180); context.fillStyle = '#fff'; context.fillText(String(frame), 20, 30); }, 100);
    const videoStream = canvas.captureStream(10);
    const mediaStream = new MediaStream([...audioDestination.stream.getAudioTracks(), ...(video ? videoStream.getVideoTracks() : [])]);
    const events = [], tracks = [];
    const connection = new window.AllChatVoiceConnection({roomID, takeover: true, stream: mediaStream, onState: (state, error) => events.push({kind: 'state', state, error: error?.message, at: performance.now()}), onTrack: event => { tracks.push(event.track); { const element=document.createElement(event.track.kind==='audio'?'audio':'video');element.autoplay=true;element.playsInline=true;if(event.track.kind==='video')element.muted=true;element.srcObject=new MediaStream([event.track]);document.body.append(element);element.play().catch(()=>{}); } }, onDiagnostics: snapshot => events.push({kind: 'stats', snapshot, at: performance.now()})});
    await connection.start();
    window.mediaTest = {audio, canvas, connection, draw, events, oscillator, tracks, videoStream, videoSender: null};
  }, {roomID, name, video});
  return {context, page};
}

async function startVideo(page) {
  await page.evaluate(async () => {
    const test = window.mediaTest;
    let track = test.videoStream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') { test.videoStream = test.canvas.captureStream(10); track = test.videoStream.getVideoTracks()[0]; }
    test.videoSender = await test.connection.setVideoTrack(track, test.videoStream);
  });
}

async function stopVideo(page) {
  await page.evaluate(async () => {
    const test = window.mediaTest;
    await test.connection.clearVideoTrack();
    test.videoStream.getTracks().forEach(track => track.stop());
    test.videoSender = null;
  });
}

async function signalingSummary(page) {
  return page.evaluate(() => {
    const peer = window.mediaTest.connection.peer;
    const summarize = description => (description?.sdp || '').split(/\r?\n/).filter(line => /^(m=video|a=mid:|a=extmap:|a=send|a=recv|a=inactive)/.test(line));
    return {signalingState: peer.signalingState, connectionState: peer.connectionState, iceConnectionState: peer.iceConnectionState, local: summarize(peer.localDescription), remote: summarize(peer.remoteDescription)};
  });
}

async function waitForVideoAdvance(label, page, baseline = null) {
  const before = baseline || await progress(page);
  const deadline = Date.now() + 10_000;
  let after = before;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
    after = await progress(page);
    if (after.videoPackets > before.videoPackets && after.videoFrames > before.videoFrames) return after;
  }
  throw new Error(`${label}: video RTP did not advance: ${JSON.stringify({before, after})}`);
}

async function waitForVideoStop(label, page) {
  const deadline = Date.now() + 4_000;
  let previous = await progress(page), stableSince = Date.now();
  const history = [];
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const current = await progress(page);
    history.push({at: Date.now(), frames: current.videoFrames, packets: current.videoPackets});
    // RTP padding/retransmissions may continue after replaceTrack(null),
    // especially in Firefox. Decoded frames are the media-progress signal.
    if (current.videoFrames !== previous.videoFrames) stableSince = Date.now();
    else if (Date.now() - stableSince >= 1000) return current;
    previous = current;
  }
  throw new Error(`${label}: removed video did not quiesce: ${JSON.stringify({previous, history})}`);
}

async function runTrackRestart(browser, firstAPI, secondAPI, roomID, label) {
  const publisher = await attachEndpoint(browser, firstAPI, roomID, 'publisher', {video: false});
  const viewer = await attachEndpoint(browser, secondAPI, roomID, 'viewer', {video: false});
  try {
    await startVideo(publisher.page);
    await waitForVideoAdvance(`${label}/start`, viewer.page);
    await stopVideo(publisher.page);
    const stopped = await waitForVideoStop(`${label}/stop`, viewer.page);
    await startVideo(publisher.page);
    try { await waitForVideoAdvance(`${label}/restart`, viewer.page, stopped); }
    catch (error) { throw new Error(`${error.message}; publisher=${JSON.stringify(await progress(publisher.page))}`); }
  } finally {
    for (const endpoint of [publisher, viewer]) {
      await endpoint.page.evaluate(() => { const test = window.mediaTest; test.connection.stop({explicit: true}); test.oscillator.stop(); clearInterval(test.draw); test.videoStream.getTracks().forEach(track => track.stop()); test.audio.close(); });
      await endpoint.context.close();
    }
  }
}

async function runQualitySwitch(browser, fixture, roomID, label) {
  const publisher = await attachEndpoint(browser, fixture.first, roomID, 'quality-publisher', {video: false});
  const viewer = await attachEndpoint(browser, fixture.second, roomID, 'quality-viewer', {video: false});
  try {
    await startVideo(publisher.page);
    for (const quality of ['low', 'medium', 'high', 'low', 'high']) {
      const before = await progress(viewer.page);
      await viewer.page.evaluate(({owner, quality}) => window.mediaTest.connection.send('screen-quality', {owner_id: owner, quality}), {owner: fixture.firstMember.id, quality});
      await waitForVideoAdvance(`${label}/${quality}`, viewer.page, before);
    }
    await stopVideo(publisher.page);
    await viewer.page.evaluate(owner => window.mediaTest.connection.send('screen-quality', {owner_id: owner, quality: 'high'}), fixture.firstMember.id);
    await waitForVideoStop(`${label}/stopped-quality-change`, viewer.page);
  } finally {
    for (const endpoint of [publisher, viewer]) {
      await endpoint.page.evaluate(() => {const test=window.mediaTest;test.connection.stop({explicit:true});test.oscillator.stop();clearInterval(test.draw);test.videoStream.getTracks().forEach(track=>track.stop());test.audio.close();});
      await endpoint.context.close();
    }
  }
}

async function runSimultaneousRestarts(browser, firstAPI, secondAPI, roomID, label) {
  const first = await attachEndpoint(browser, firstAPI, roomID, 'glare-first', {video: false});
  const second = await attachEndpoint(browser, secondAPI, roomID, 'glare-second', {video: false});
  try {
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      const firstBefore = await progress(first.page), secondBefore = await progress(second.page);
      await Promise.all([startVideo(first.page), startVideo(second.page)]);
      await Promise.all([
        waitForVideoAdvance(`${label}/cycle-${cycle}/first`, first.page, firstBefore),
        waitForVideoAdvance(`${label}/cycle-${cycle}/second`, second.page, secondBefore),
      ]);
      try { await Promise.all([stopVideo(first.page), stopVideo(second.page)]); }
      catch (error) { throw new Error(`${error.message}; first=${JSON.stringify(await signalingSummary(first.page))}; second=${JSON.stringify(await signalingSummary(second.page))}`); }
      await Promise.all([
        waitForVideoStop(`${label}/cycle-${cycle}/first-stop`, first.page),
        waitForVideoStop(`${label}/cycle-${cycle}/second-stop`, second.page),
      ]);
    }
  } finally {
    for (const endpoint of [first, second]) {
      await endpoint.page.evaluate(() => { const test = window.mediaTest; test.connection.stop({explicit: true}); test.oscillator.stop(); clearInterval(test.draw); test.videoStream.getTracks().forEach(track => track.stop()); test.audio.close(); });
      await endpoint.context.close();
    }
  }
}

async function recoverEndpoint(label, page) {
  await page.evaluate(() => { const test = window.mediaTest; test.peerBeforeRecovery = test.connection.peer; test.connection.socket.close(); });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const recovered = await page.evaluate(() => window.mediaTest.connection.peer !== window.mediaTest.peerBeforeRecovery && window.mediaTest.connection.state === 'connected');
    if (recovered) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${label}: Media Session did not recover within 15 seconds`);
}

async function waitForConvergence(label, pages) {
  const deadline = Date.now() + 20_000;
  let stableSince = 0;
  while (Date.now() < deadline) {
    const states = await Promise.all(pages.map(page => page.evaluate(() => ({media: window.mediaTest.connection.state, peer: window.mediaTest.connection.peer?.connectionState, signaling: window.mediaTest.connection.peer?.signalingState}))));
    if (states.every(state => state.media === 'connected' && state.peer === 'connected' && state.signaling === 'stable')) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 1000) return;
    } else stableSince = 0;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${label}: endpoints did not converge after recovery`);
}

async function runSignalingRecovery(browser, firstAPI, secondAPI, roomID, label) {
  const first = await attachEndpoint(browser, firstAPI, roomID, 'recovery-first', {video: false});
  const second = await attachEndpoint(browser, secondAPI, roomID, 'recovery-second', {video: false});
  try {
    await Promise.all([assertFreshAudio(`${label}/before/first`, first.page), assertFreshAudio(`${label}/before/second`, second.page)]);
    await Promise.all([startVideo(first.page), startVideo(second.page)]);
    await Promise.all([assertAdvancing(`${label}/active-video/first`, first.page), assertAdvancing(`${label}/active-video/second`, second.page)]);
    await recoverEndpoint(label, first.page);
    await waitForConvergence(label, [first.page, second.page]);
    try { await Promise.all([assertFreshAudio(`${label}/after/first`, first.page), assertFreshAudio(`${label}/after/second`, second.page)]); }
    catch (error) { throw new Error(`${error.message}; recovered=${JSON.stringify(await signalingSummary(first.page))}; peer=${JSON.stringify(await signalingSummary(second.page))}`); }
    const firstBefore = await progress(first.page), secondBefore = await progress(second.page);
    await Promise.all([startVideo(first.page), startVideo(second.page)]);
    await Promise.all([waitForVideoAdvance(`${label}/video/first`, first.page, firstBefore), waitForVideoAdvance(`${label}/video/second`, second.page, secondBefore)]);
  } finally {
    for (const endpoint of [first, second]) {
      await endpoint.page.evaluate(() => { const test = window.mediaTest; test.connection.stop({explicit: true}); test.oscillator.stop(); clearInterval(test.draw); test.videoStream.getTracks().forEach(track => track.stop()); test.audio.close(); });
      await endpoint.context.close();
    }
  }
}

async function progress(page) {
  return page.evaluate(async () => {
    if (!window.mediaTest.connection.peer) throw Error('Media peer unavailable: '+JSON.stringify(window.mediaTest.events.filter(event=>event.kind==='state')));
    const report = await window.mediaTest.connection.peer.getStats();
    const result = {audioPackets: 0, videoFrames: 0, videoPackets: 0, outboundAudioPackets: 0, outboundVideoPackets: 0, audioSamples: 0};
    report.forEach(item => {
      const kind = item.kind || item.mediaType;
      if (item.type === 'inbound-rtp' && kind === 'audio') { result.audioPackets += item.packetsReceived || 0; result.audioSamples += item.totalSamplesReceived || 0; }
      if (item.type === 'inbound-rtp' && kind === 'video') { result.videoPackets += item.packetsReceived || 0; result.videoFrames += item.framesDecoded || 0; }
      if (item.type === 'outbound-rtp' && kind === 'audio') result.outboundAudioPackets += item.packetsSent || 0;
      if (item.type === 'outbound-rtp' && kind === 'video') result.outboundVideoPackets += item.packetsSent || 0;
    });
    return result;
  });
}

async function assertAdvancing(label, page) {
  const before = await progress(page);
  const deadline = Date.now() + 10_000;
  let after = before;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
    after = await progress(page);
    if (after.audioPackets > before.audioPackets && after.videoPackets > before.videoPackets && after.videoFrames > before.videoFrames) return;
  }
  throw new Error(`${label}: inbound media did not advance: ${JSON.stringify({before, after})}`);
}

async function assertFreshAudio(label, page) {
  const deadline = Date.now() + 10_000;
  let before = await progress(page);
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const after = await progress(page);
    if (after.audioPackets > before.audioPackets && after.audioSamples > before.audioSamples) return;
    before = after;
  }
  throw new Error(`${label}: post-recovery audio did not advance: ${JSON.stringify(before)}`);
}

async function runPair(browser, firstAPI, secondAPI, roomID, label) {
  const first = await attachEndpoint(browser, firstAPI, roomID, 'first');
  const second = await attachEndpoint(browser, secondAPI, roomID, 'second');
  try {
    await Promise.all([assertAdvancing(`${label}/first`, first.page), assertAdvancing(`${label}/second`, second.page)]);
  } finally {
    for (const endpoint of [first, second]) {
      await endpoint.page.evaluate(() => { const test = window.mediaTest; test.connection.stop({explicit: true}); test.oscillator.stop(); clearInterval(test.draw); test.videoStream.getTracks().forEach(track => track.stop()); test.audio.close(); });
      await endpoint.context.close();
    }
  }
}

async function main() {
  markPhase('starting Instance');
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'allchat-media-'));
  const server = spawn('go', ['run', '-buildvcs=false', './cmd/allchat', '--data-dir', dataDirectory, '--listen', `${host}:${port}`], {cwd: path.resolve(__dirname, '../..'), env: {...process.env, GOCACHE: process.env.GOCACHE || '/tmp/allchat-media-gocache'}, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
  const redact = data => process.stdout.write(String(data).replace(/(token=)[^"\s]+/g, '$1<REDACTED>'));
  server.stdout.on('data', redact); server.stderr.on('data', redact);
  let browser;
  try {
    await waitForServer();
    markPhase('provisioning fixture');
    const fixture = await provision(dataDirectory);
    markPhase('launching browser');
    browser = await browserType.launch({headless: true});
    if (browserName === 'electron') {
      markPhase('desktop production lifecycle');
      await require('../desktop/run.cjs').runDesktopInterop({fixture, browser, baseURL, post, attachEndpoint, progress, waitForVideoAdvance, waitForVideoStop, assertFreshAudio});
      await fixture.first.dispose(); await fixture.second.dispose();
      process.stdout.write('Electron media interoperability: PASS\n'); return;
    }
    markPhase('sketchboard sandbox interaction');
    await assertSketchboardCreate(browser, fixture.first);
    if (!only || only === 'baseline') { markPhase('voice-room baseline'); await runPair(browser, fixture.first, fixture.second, fixture.room.id, 'voice-room'); }
    if (!only || only === 'video-restart') { markPhase('voice-room video restart'); await runTrackRestart(browser, fixture.first, fixture.second, fixture.room.id, 'voice-room/video-restart'); }
    if (!only || only === 'quality') { markPhase('voice-room quality'); await runQualitySwitch(browser, fixture, fixture.room.id, 'voice-room/quality'); }
    if (!only || only === 'glare') { markPhase('voice-room glare'); await runSimultaneousRestarts(browser, fixture.first, fixture.second, fixture.room.id, 'voice-room/glare'); }
    if (!only || only === 'signaling-recovery') { markPhase('voice-room signaling recovery'); await runSignalingRecovery(browser, fixture.first, fixture.second, fixture.room.id, 'voice-room/signaling-recovery'); }
    // Transport closure preserves a rejoin window; explicitly end both Voice Room sessions.
    for (const member of [fixture.first, fixture.second]) {
      const response = await member.delete(`/api/v1/media/rooms/${fixture.room.id}/session`, {headers: {'X-CSRF-Token': await csrf(member)}});
      if (!response.ok()) throw new Error(`Voice Room fixture leave: ${response.status()}`);
    }
    markPhase('creating direct call');
    const call = await post(fixture.first, `/api/v1/dms/${fixture.dm.id}/calls`, {});
    await post(fixture.second, `/api/v1/calls/${call.id}/accept`, {});
    if (!only || only === 'baseline') { markPhase('direct-call baseline'); await runPair(browser, fixture.first, fixture.second, call.id, 'direct-call'); }
    if (!only || only === 'video-restart') { markPhase('direct-call video restart'); await runTrackRestart(browser, fixture.first, fixture.second, call.id, 'direct-call/video-restart'); }
    if (!only || only === 'quality') { markPhase('direct-call quality'); await runQualitySwitch(browser, fixture, call.id, 'direct-call/quality'); }
    if (!only || only === 'glare') { markPhase('direct-call glare'); await runSimultaneousRestarts(browser, fixture.first, fixture.second, call.id, 'direct-call/glare'); }
    if (!only || only === 'signaling-recovery') { markPhase('direct-call signaling recovery'); await runSignalingRecovery(browser, fixture.first, fixture.second, call.id, 'direct-call/signaling-recovery'); }
    await fixture.first.dispose(); await fixture.second.dispose();
    markPhase('complete');
    process.stdout.write(`browser media interoperability (${browserName}): PASS\n`);
  } finally {
    markPhase('cleanup');
    await browser?.close();
    try { if(process.platform !== 'win32') process.kill(-server.pid, 'SIGTERM'); else server.kill('SIGTERM'); } catch(error) { if(error.code !== 'ESRCH') throw error; }
  }
}

main().then(() => clearTimeout(watchdog)).catch(error => {
  clearTimeout(watchdog);
  writeFailure(error);
  console.error(error); process.exitCode = 1;
});
