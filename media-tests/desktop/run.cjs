const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// All instrumentation lives in the test process. The installed controller,
// capture pipeline, preload, credential vault and signaling bridge run unchanged.
exports.runDesktopInterop = async ({fixture, browser, baseURL, post, attachEndpoint, progress, waitForVideoAdvance, waitForVideoStop, assertFreshAudio}) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'allchat-electron-media-'));
  const app = await electron.launch({args: [path.resolve('desktop'), `--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])]});
  let web;
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.evaluate(() => {
      const NativePeer = window.RTCPeerConnection, peers = [], captured = [];
      window.RTCPeerConnection = class extends NativePeer { constructor(configuration) { super(configuration); peers.push(this); } };
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => { const stream = await capture(constraints); captured.push(...stream.getTracks()); return stream; };
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d'); let frame = 0;
      const timer = setInterval(() => { context.fillStyle = frame++ % 2 ? 'red' : 'blue'; context.fillRect(0, 0, 320, 180); }, 100);
      navigator.mediaDevices.getDisplayMedia = async () => { const stream = canvas.captureStream(10); captured.push(...stream.getTracks()); return stream; };
      window.mediaTest = {get connection() { return {peer: peers.at(-1)}; }, peers, captured, timer};
    });
    await page.getByLabel('Community address').fill(baseURL);
    await page.getByRole('button', {name: 'Add Instance', exact: true}).click();
    await page.getByLabel('Username').fill('media-owner');
    await page.getByLabel('Password').fill('media test password');
    await page.locator('form').getByRole('button', {name: 'Sign in', exact: true}).click();
    web = await attachEndpoint(browser, fixture.second, fixture.room.id, 'web-to-desktop', {video: false});
    await page.getByRole('button', {name: 'Media room', exact: true}).click();
    await page.getByRole('region', {name: 'Voice controls'}).getByText('Connected', {exact: true}).waitFor();
    await Promise.all([assertFreshAudio('desktop/receive', page), assertFreshAudio('desktop/publish', web.page)]);
    await page.getByRole('button', {name: 'Share screen', exact: true}).click();
    await waitForVideoAdvance('desktop/screen/start', web.page);
    await page.getByRole('button', {name: 'Stop sharing screen', exact: true}).click();
    const stopped = await waitForVideoStop('desktop/screen/stop', web.page);
    await page.getByRole('button', {name: 'Share screen', exact: true}).click();
    await waitForVideoAdvance('desktop/screen/restart', web.page, stopped);
    await page.getByRole('button', {name: 'Disconnect voice', exact: true}).click();
    const released = await page.evaluate(() => window.mediaTest.captured.every(track => track.readyState === 'ended') && window.mediaTest.peers.every(peer => peer.connectionState === 'closed'));
    if (!released) throw Error('Desktop leave did not release capture and peers');
    await web.page.evaluate(() => { const t=window.mediaTest;t.connection.stop({explicit:true});t.oscillator.stop();clearInterval(t.draw);t.audio.close(); });
    await web.context.close(); web = null;
    const call = await post(fixture.second, `/api/v1/dms/${fixture.dm.id}/calls`, {});
    await page.getByRole('region', {name: 'Incoming Call controls'}).getByRole('button', {name: 'Accept', exact: true}).click();
    web = await attachEndpoint(browser, fixture.second, call.id, 'web-direct-call', {video: false});
    await page.getByRole('region', {name: 'Call controls', exact: true}).getByText('Connected', {exact: true}).waitFor();
    await Promise.all([assertFreshAudio('desktop/call/receive', page), assertFreshAudio('desktop/call/publish', web.page)]);
    await page.getByRole('button', {name: 'Share screen', exact: true}).click();
    await waitForVideoAdvance('desktop/call/screen', web.page);
    await page.getByRole('button', {name: 'End call', exact: true}).click();
    await page.waitForFunction(() => window.mediaTest.captured.every(track => track.readyState === 'ended') && window.mediaTest.peers.every(peer => peer.connectionState === 'closed'));

  } finally {
    if (web) { await web.page.evaluate(() => {window.mediaTest.connection.stop({explicit: true});window.mediaTest.oscillator.stop();clearInterval(window.mediaTest.draw);window.mediaTest.audio.close();}); await web.context.close(); }
    await app.close();
  }
};
