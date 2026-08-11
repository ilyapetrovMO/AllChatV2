const { test, expect } = require('@playwright/test');

test('terminal Voice Room failure releases the microphone', async ({ page }) => {
  await page.goto('/login');
  await page.addScriptTag({url: '/assets/voice-connection.js'});
  const result = await page.evaluate(async () => {
    let stops = 0;
    const track = {stop: () => stops++};
    const stream = {getTracks: () => [track]};
    const createPeer = () => ({
      addTrack() {},
      addTransceiver() {},
      close() {},
      createOffer: async () => ({type: 'offer', sdp: 'test'}),
      setLocalDescription: async function(description) { this.localDescription = description; },
      iceGatheringState: 'complete',
    });
    const createSocket = () => {
      const socket = {
        readyState: 0,
        close() { this.readyState = 3; queueMicrotask(() => this.onclose?.()); },
        send() {},
      };
      queueMicrotask(() => { socket.onerror?.(); });
      return socket;
    };
    const states = [];
    const connection = new window.AllChatVoiceConnection({
      roomID: 'voice-room-example', stream, createPeer, createSocket,
      fetchCredentials: async () => [], recoveryDelays: [1], recoveryTimeout: 10,
      onState: state => states.push(state),
    });
    await connection.start();
    return {stops, state: connection.state, states};
  });
  expect(result.state).toBe('failed');
  expect(result.states).toContain('recovering');
  expect(result.stops).toBe(1);
});

test('desktop Message notification policy respects focus, settings, mutes, mentions, and cooldowns', async ({ page }) => {
  await page.goto('/login');
  await page.addScriptTag({url: '/assets/notification-service.js'});
  const result = await page.evaluate(() => {
    let now = 10_000;
    const toasts = [], sounds = [];
    const service = new window.AllChatNotificationService({
      now: () => now,
      notifier: {notify: notification => toasts.push(notification)},
      playSound: () => sounds.push(now),
    });
    const message = (overrides = {}) => ({
      id: `message-${now}`,
      channel_id: 'channel-other',
      author_id: 'member-other',
      author_name: 'Other Member',
      body: 'hello **there**',
      mentions: [],
      ...overrides,
    });
    const state = (overrides = {}) => ({
      currentUserID: 'member-current',
      activeChannelID: 'channel-active',
      appFocused: true,
      serverSetting: {level: 'all_messages', muted: false, soundEnabled: true},
      channelSetting: {level: 'default', muted: false},
      ...overrides,
    });
    const check = (name, candidate, clientState) => {
      const before = toasts.length;
      service.handleMessage(candidate, clientState);
      return [name, toasts.length > before];
    };
    const decisions = [
      check('own', message({author_id: 'member-current'}), state()),
      check('focused-active', message({channel_id: 'channel-active'}), state()),
      check('focused-other', message(), state()),
    ];
    now += 2_000;
    decisions.push(check('unfocused-active', message({channel_id: 'channel-active'}), state({appFocused: false})));
    now += 2_000;
    decisions.push(check('muted', message(), state({channelSetting: {level: 'all_messages', muted: true}})));
    decisions.push(check('mentions-normal', message(), state({channelSetting: {level: 'mentions_only', muted: false}})));
    decisions.push(check('mentions-direct', message({mentions: [{id: 'member-current'}]}), state({channelSetting: {level: 'mentions_only', muted: false}})));
    now += 2_000;
    decisions.push(check('nothing', message(), state({channelSetting: {level: 'nothing', muted: false}})));
    decisions.push(check('override', message(), state({serverSetting: {level: 'nothing', muted: false, soundEnabled: true}, channelSetting: {level: 'all_messages', muted: false}})));
    now += 2_000;
    decisions.push(check('default-inherits', message(), state({serverSetting: {level: 'nothing', muted: false, soundEnabled: true}})));
    now += 2_000;
    const firstSame = check('cooldown-first', message(), state());
    now += 500;
    const secondSame = check('cooldown-same', message(), state());
    const otherConversation = check('cooldown-other', message({channel_id: 'channel-third'}), state());
    return {decisions: Object.fromEntries([...decisions, firstSame, secondSame, otherConversation]), toastCount: toasts.length, soundCount: sounds.length};
  });
  expect(result.decisions).toEqual({
    own: false,
    'focused-active': false,
    'focused-other': true,
    'unfocused-active': true,
    muted: false,
    'mentions-normal': false,
    'mentions-direct': true,
    nothing: false,
    override: true,
    'default-inherits': false,
    'cooldown-first': true,
    'cooldown-same': false,
    'cooldown-other': true,
  });
  expect(result.soundCount).toBe(5);
});

test('suppressed desktop notification still updates Unread State', async ({ page }) => {
  await page.goto('/login');
  await page.addScriptTag({url: '/assets/notification-service.js'});
  const result = await page.evaluate(() => {
    let unread = 0, notifications = 0;
    const message = {channel_id: 'channel-active', author_id: 'member-other'};
    window.AllChatNotificationPolicy.handleIncomingMessage(message, {
      updateUnread: () => unread++,
      notify: candidate => {
        if (window.AllChatNotificationPolicy.shouldNotify(candidate, {
          currentUserID: 'member-current', activeChannelID: 'channel-active', appFocused: true,
          serverSetting: {level: 'all_messages'}, channelSetting: {level: 'default'},
        })) notifications++;
      },
    });
    return {unread, notifications};
  });
  expect(result).toEqual({unread: 1, notifications: 0});
});

test('authentication uses the embedded AllChat design system', async ({ page }) => {
  const externalRequests = [];
  page.on('request', request => {
    const target = new URL(request.url());
    if (target.hostname !== '127.0.0.1') externalRequests.push(request.url());
  });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to AllChat' })).toBeVisible();
  await expect(page.locator('.auth-card')).toBeVisible();
  await expect(page.locator('link[href="/assets/app.css"]')).toHaveCount(1);
  await page.getByLabel('Username').focus();
  await expect(page.getByLabel('Username')).toBeFocused();
  expect(externalRequests).toEqual([]);
});

test('narrow layouts do not overflow horizontally', async ({ page }) => {
  await page.goto('/login');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  const card = page.locator('.auth-card');
  await expect(card).toBeVisible();
  expect((await card.boundingBox()).width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
});

test('mobile conversation header, Messages, and composer stay inside the viewport', async ({ page }) => {
  await page.setViewportSize({width: 390, height: 720});
  await page.goto('/login');
  await page.evaluate(() => {
    document.body.className = '';
    document.body.innerHTML = `<div class="app-shell"><main class="content-shell channel-content">
      <header class="content-header"><button class="mobile-menu">☰</button><span class="hash">#</span><h1>A very long conversation name</h1><div class="header-actions"><button class="notification-bell">🔔</button><form class="header-search"><input value="search"></form><button class="mobile-members">👥</button></div></header>
      <div class="conversation-layout"><section class="messages"><article class="message"><span class="message-avatar">A</span><strong>Member</strong><span class="body">${'unbroken-message-content'.repeat(30)}</span></article></section><aside class="participant-sidebar"></aside></div>
      <div class="composer-wrap"><form class="composer"><button class="attachment-button"></button><input id="message-body" value="draft"><button id="composer-submit">Send</button></form></div>
    </main></div>`;
  });
  await page.addStyleTag({url: '/assets/app.css'});
  await page.addStyleTag({url: '/assets/channel.css'});
  const geometry = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const right = selector => document.querySelector(selector).getBoundingClientRect().right;
    return {
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      channel: right('.channel-content'),
      message: right('.message'),
      body: right('.message .body'),
      composer: right('.composer'),
      headerTop: document.querySelector('.content-header').getBoundingClientRect().top,
    };
  });
  expect(geometry.documentWidth).toBe(geometry.viewport);
  for (const key of ['channel', 'message', 'body', 'composer']) expect(geometry[key]).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.headerTop).toBe(0);
});

test('mobile composer follows the visual viewport when the keyboard resizes it', async ({ page }) => {
  await page.setViewportSize({width: 390, height: 720});
  await page.goto('/login');
  await page.addScriptTag({url: '/assets/app.js'});
  await page.waitForFunction(() => typeof window.syncAllChatVisualViewport === 'function');
  await page.evaluate(() => {
    document.body.className = '';
    document.body.innerHTML = '<div class="app-shell"><main class="channel-content"><header class="content-header">Conversation</header><div class="conversation-layout"><section class="messages"></section></div><div class="composer-wrap"><form class="composer"><input id="message-body"></form></div></main></div>';
  });
  await page.addStyleTag({url: '/assets/channel.css'});
  const result = await page.evaluate(() => {
    window.syncAllChatVisualViewport(418);
    return {
      height: document.documentElement.style.getPropertyValue('--allchat-visual-height'),
      channelHeight: document.querySelector('.channel-content').getBoundingClientRect().height,
      viewport: document.querySelector('meta[name="viewport"]')?.content || '',
    };
  });
  expect(result.height).toBe('418px');
  expect(result.channelHeight).toBe(418);
  expect(result.viewport).toContain('interactive-widget=resizes-content');
});

test('reduced motion disables interface transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  const duration = await page.locator('.auth-card').evaluate(element => getComputedStyle(element).transitionDuration);
  expect(duration).toBe('0s');
});

test('message editing banner is hidden until editing starts', async ({ page }) => {
  await page.goto('/login');
  await page.setContent(`
    <link rel="stylesheet" href="/assets/app.css">
    <link rel="stylesheet" href="/assets/channel.css">
    <div class="editing-banner" id="editing-banner" hidden>Editing Message</div>
  `);
  await expect(page.locator('#editing-banner')).toBeHidden();
});

test('member menu is hidden until its avatar control opens it', async ({ page }) => {
  await page.goto('/login');
  await page.setContent(`
    <link rel="stylesheet" href="/assets/app.css">
    <link rel="stylesheet" href="/assets/channel.css">
    <div class="community-switcher"><button data-community-menu-toggle aria-expanded="false">AllChat Community</button><nav data-community-menu hidden><a href="/admin/roles">Roles</a></nav></div>
    <div class="member-panel"><div class="member-menu" id="member-menu" hidden><button role="menuitem">Online</button></div><button id="member-menu-toggle" aria-expanded="false">Member</button><a class="member-settings" href="/profile" aria-label="User Settings">Settings</a></div>
    <script src="/assets/app.js"></script>
  `);
  await expect(page.locator('#member-menu')).toBeHidden();
  await page.locator('#member-menu-toggle').click();
  await expect(page.locator('#member-menu')).toBeVisible();
  await expect(page.locator('.member-settings')).toHaveAttribute('href', '/profile');
  await page.locator('#member-menu-toggle').click();
  await expect(page.locator('#member-menu')).toBeHidden();
  await page.locator('[data-community-menu-toggle]').click();
  await expect(page.locator('[data-community-menu]')).toBeVisible();
  await expect(page.locator('[data-community-menu] a')).toHaveAttribute('href', '/admin/roles');
});

test('ordinary text inputs disable browser completion suggestions', async ({ page }) => {
  await page.goto('/login');
  await page.setContent('<input id="ordinary"><script src="/assets/app.js"></script>');
  await expect(page.locator('#ordinary')).toHaveAttribute('autocomplete', 'off');
  await expect(page.locator('#ordinary')).toHaveAttribute('autocorrect', 'off');
  await expect(page.locator('#ordinary')).toHaveAttribute('spellcheck', 'false');
});

test('jump-to-present prompt is hidden while following current messages', async ({ page }) => {
  await page.goto('/login');
  await page.setContent(`
    <link rel="stylesheet" href="/assets/app.css">
    <link rel="stylesheet" href="/assets/channel.css">
    <button class="jump-to-present" id="jump-to-present" hidden>Jump to present</button>
  `);
  await expect(page.locator('#jump-to-present')).toBeHidden();
});

test('conversation follows late media growth only while at the present', async ({ page }) => {
  await page.goto('/login');
  await page.setContent(`
    <style>#messages{height:120px;overflow:auto}.spacer{height:300px}.media{display:block;height:0}</style>
    <section id="messages"><div class="spacer"></div><img class="media"></section>
    <button id="jump" hidden>Jump</button>
    <script src="/assets/channel-scroll.js"></script>
  `);
  const result = await page.evaluate(async () => {
    const messages = document.querySelector('#messages');
    const media = document.querySelector('.media');
    const controller = window.createConversationFollower(messages, document.querySelector('#jump'), 40);
    controller.scrollToLatest();
    media.style.height = '180px';
    media.dispatchEvent(new Event('load'));
    await new Promise(requestAnimationFrame);
    const followed = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 2;
    messages.scrollTop = 0;
    messages.dispatchEvent(new Event('scroll'));
    media.style.height = '260px';
    media.dispatchEvent(new Event('load'));
    await new Promise(requestAnimationFrame);
    return { followed, preserved: messages.scrollTop === 0 };
  });
  expect(result).toEqual({ followed: true, preserved: true });
});

test('voice participants render directly beneath their voice channel', async ({ page }) => {
  await page.route('**/api/v1/channels', route => route.fulfill({json: {channels: [{id: 'voice-one', name: 'General', type: 'voice'}]}}));
  await page.route('**/api/v1/voice/voice-one/participants', route => route.fulfill({json: {
    participants: [{member_id: 'member-one', connected: true, server_muted: true, speaking: true}, {member_id: 'member-two', connected: true, server_muted: false, speaking: false}],
    names: {'member-one': 'Akko', 'member-two': 'Spikey'},
    members: {'member-one': {id: 'member-one', username: 'akko', display_name: 'Akko', avatar_url: '/avatar.png'}, 'member-two': {id: 'member-two', username: 'spikey', display_name: 'Spikey'}}
  }}));
  await page.goto('/login');
  await page.setContent(`
    <link rel="stylesheet" href="/assets/app.css">
    <link rel="stylesheet" href="/assets/channel.css">
    <nav class="channel-nav"><a class="channel-link voice-link" href="/channels/voice-one">General</a></nav>
    <script src="/assets/app.js"></script>
  `);
  const channel = page.locator('a[href="/channels/voice-one"]');
  const participant = channel.locator('+ .voice-channel-members li').nth(0);
  await expect(channel).toHaveClass(/voice-link/);
  await expect(participant).toContainText('Akko');
  await expect(participant.locator('img')).toHaveAttribute('src', '/avatar.png');
  await expect(participant).toHaveClass(/speaking/);
  await expect(participant.locator('img')).toHaveCSS('box-shadow', /rgb\(35, 165, 89\)/);
  await expect(participant.locator('.voice-member-muted')).toHaveAttribute('aria-label', 'Server muted');
  await expect(channel.locator('+ .voice-channel-members li').nth(0)).toContainText('Akko');
  await expect(channel.locator('+ .voice-channel-members li').nth(1)).toContainText('Spikey');
});

test('voice stage fills width with two, triforce three, and two-by-two four participant grids', async ({page}) => {
  await page.goto('/login');
  await page.setContent(`<link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/channel.css"><section class="media-stage" style="width:900px;height:620px"><div class="media-stage-grid" data-media-stage-grid></div></section>`);
  const boxesFor = async count => page.evaluate(value => {
    const grid = document.querySelector('[data-media-stage-grid]');
    grid.dataset.tileCount = String(value);
    grid.replaceChildren(...Array.from({length: value}, (_, index) => {
      const tile = document.createElement('article');
      tile.className = 'media-stage-tile participant-tile';
      tile.textContent = String(index + 1);
      return tile;
    }));
    return [...grid.children].map(tile => { const box = tile.getBoundingClientRect(); return {x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width)}; });
  }, count);
  const two = await boxesFor(2);
  expect(two[0].width).toBeGreaterThan(420);
  expect(two[0].y).toBeGreaterThan(120);
  expect(two[1].y).toBe(two[0].y);
  expect(two[1].x).toBeGreaterThan(two[0].x + two[0].width);
  const three = await boxesFor(3);
  expect(three[0].y).toBe(three[1].y);
  expect(three[2].y).toBeGreaterThan(three[0].y);
  expect(three[2].x).toBeGreaterThan(three[0].x);
  expect(three[2].x).toBeLessThan(three[1].x);
  const four = await boxesFor(4);
  expect(four[0].y).toBe(four[1].y);
  expect(four[2].y).toBeGreaterThan(four[0].y);
  expect(four[2].x).toBe(four[0].x);
  expect(four[3].x).toBe(four[1].x);
});

test('voice connection recovers a dropped signaling socket with fresh transport credentials', async ({ page }) => {
  await page.goto('/login');
  await page.addScriptTag({url: '/assets/voice-connection.js'});
  const result = await page.evaluate(async () => {
    const states = [], sockets = [], peers = [], joinTokens = [], joinTakeovers = [];
    let heartbeats = 0;
    let credentialFetches = 0;
    class FakePeer {
      constructor() { this.localDescription = null; this.connectionState = 'new'; peers.push(this); }
      addTrack() {}
      addTransceiver() {}
      createOffer() { return Promise.resolve({type: 'offer', sdp: 'offer'}); }
      setLocalDescription(value) { this.localDescription = value; return Promise.resolve(); }
      setRemoteDescription() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); return Promise.resolve(); }
      addIceCandidate() { return Promise.resolve(); }
      close() { this.connectionState = 'closed'; }
    }
    class FakeSocket {
      static OPEN = 1;
      constructor() { this.readyState = 1; sockets.push(this); queueMicrotask(() => this.onopen?.()); }
      send(raw) {
        const frame = JSON.parse(raw);
        if (frame.type === 'join') {
          joinTokens.push(frame.resume_token);
          joinTakeovers.push(frame.takeover === true);
          const response = sockets.length === 2 && frame.resume_token
            ? {version: 1, type: 'error', code: 'invalid_resume', error: 'resume expired'}
            : {version: 1, type: 'answer', sdp: {type: 'answer', sdp: 'answer'}, resume_token: 'resume-token'};
          queueMicrotask(() => this.onmessage?.({data: JSON.stringify(response)}));
        }
        if (frame.type === 'heartbeat') { heartbeats++; queueMicrotask(() => this.onmessage?.({data: JSON.stringify({version: 1, type: 'heartbeat-ack'})})); }
      }
      close() { if (this.readyState === 3) return; this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
    }
    const connection = new window.AllChatVoiceConnection({
      roomID: 'voice-room',
      stream: {getTracks: () => [{kind: 'audio'}]},
      onState: state => states.push(state),
      fetchCredentials: async () => { credentialFetches++; return []; },
      createPeer: () => new FakePeer(),
      createSocket: () => new FakeSocket(),
      recoveryDelays: [0],
      recoveryTimeout: 1000,
      heartbeatInterval: 5,
      heartbeatTimeout: 50,
    });
    await connection.start();
    await new Promise(resolve => setTimeout(resolve, 0));
    sockets[0].close();
    await new Promise(resolve => setTimeout(resolve, 20));
    sockets.at(-1).close();
    await new Promise(resolve => setTimeout(resolve, 20));
    const snapshot = {states: [...states], sockets: sockets.length, peers: peers.length, credentialFetches, heartbeats, joinTokens, joinTakeovers};
    connection.stop();
    return snapshot;
  });
  expect(result.states).toContain('recovering');
  expect(result.states.at(-1)).toBe('connected');
  expect(result).toMatchObject({sockets: 4, peers: 4, credentialFetches: 4, joinTokens: ['', 'resume-token', '', 'resume-token'], joinTakeovers: [false, false, true, false]});
  expect(result.heartbeats).toBeGreaterThan(0);
});

test('voice connection exposes receiver-side audio flow diagnostics', async ({page})=>{
  await page.goto('/login');
  await page.addScriptTag({url:'/assets/voice-connection.js'});
  const samples=await page.evaluate(async()=>{
    const captured=[];
    class Peer{constructor(){this.localDescription=null;this.connectionState='new';this.iceConnectionState='new'}addTrack(){}addTransceiver(){}createOffer(){return Promise.resolve({type:'offer',sdp:'offer'})}setLocalDescription(value){this.localDescription=value;return Promise.resolve()}setRemoteDescription(){this.connectionState='connected';return Promise.resolve()}addIceCandidate(){return Promise.resolve()}close(){}getStats(){return Promise.resolve(new Map([['in',{type:'inbound-rtp',kind:'audio',packetsReceived:321,bytesReceived:6543,packetsLost:2,jitter:.015}],['out',{type:'outbound-rtp',kind:'audio',packetsSent:123,bytesSent:4567}]]))}}
    class Socket{static OPEN=1;constructor(){this.readyState=1;queueMicrotask(()=>this.onopen?.())}send(raw){const frame=JSON.parse(raw);if(frame.type==='join')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'answer',sdp:{type:'answer',sdp:'answer'}})}))}close(){this.readyState=3}}
    const connection=new window.AllChatVoiceConnection({roomID:'voice-example',stream:{getTracks:()=>[]},fetchCredentials:async()=>[],createPeer:()=>new Peer(),createSocket:()=>new Socket(),diagnosticsInterval:5,onDiagnostics:value=>captured.push(value)});
    await connection.start();await new Promise(resolve=>setTimeout(resolve,16));connection.stop();return captured;
  });
  expect(samples.length).toBeGreaterThan(0);
  expect(samples.at(-1)).toMatchObject({state:'connected',inbound:{packets:321,bytes:6543,lost:2},outbound:{packets:123,bytes:4567}});
});

test('Direct Call keeps remote screen media when tracks arrive with the SDP answer', async ({page})=>{
  await page.goto('/login');
  await page.evaluate(()=>{
    document.body.dataset.memberId='member-one';
    document.body.dataset.channelId='dm-one';
    document.body.innerHTML='<main class="content-shell channel-content"><header class="content-header"><span class="channel-topic">Direct Message</span><div class="header-actions"></div></header><section class="conversation-layout"></section><div class="composer-wrap"><input name="csrf_token" value="token"></div></main>';
    const call={id:'call-one',direct_message_id:'dm-one',caller_id:'member-one',recipient_id:'member-two',state:'accepted'};
    window.fetch=async url=>{
      if(String(url).endsWith('/api/v1/calls/current'))return new Response(JSON.stringify(call),{status:200,headers:{'Content-Type':'application/json'}});
      if(String(url).endsWith('/api/v1/turn-credentials'))return new Response(JSON.stringify({ice_servers:[]}),{status:200,headers:{'Content-Type':'application/json'}});
      if(String(url).endsWith('/api/v1/media/config'))return new Response(JSON.stringify({audio_bitrate:64000,screen_bitrate:2500000}),{status:200,headers:{'Content-Type':'application/json'}});
      return new Response('',{status:204});
    };
    const microphoneTrack={kind:'audio',enabled:true,stop(){},addEventListener(){}};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[microphoneTrack],getAudioTracks:()=>[microphoneTrack]})}});
    class Peer {
      constructor(){this.localDescription=null;this.remoteDescription=null;}
      addTrack(){} addTransceiver(){} createOffer(){return Promise.resolve({type:'offer',sdp:'offer'})}
      setLocalDescription(value){this.localDescription=value;return Promise.resolve()}
      async setRemoteDescription(value){this.remoteDescription=value;const track={kind:'video',addEventListener(){}};this.ontrack?.({track,streams:[new MediaStream()]})}
      addIceCandidate(){return Promise.resolve()} close(){}
    }
    class Socket {
      static OPEN=1;
      constructor(){this.readyState=1;(window.__directCallSockets||=[]).push(this);queueMicrotask(()=>this.onopen?.())}
      send(raw){const frame=JSON.parse(raw);if(frame.type==='join')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({version:1,type:'answer',sdp:{type:'answer',sdp:'answer'}})}))}
      close(){if(this.readyState===3)return;this.readyState=3;queueMicrotask(()=>this.onclose?.())}
    }
    window.RTCPeerConnection=Peer;
    window.WebSocket=Socket;
  });
  await page.addStyleTag({url:'/assets/channel.css'});
  await page.addScriptTag({url:'/assets/call.js'});
  await expect(page.locator('.direct-call-workspace [data-media-stage-grid] video')).toHaveCount(1);
  await expect(page.locator('.direct-call-workspace .media-stage-tile')).toHaveCount(2);
  const layout=await page.locator('.direct-call-workspace').evaluate(workspace=>{const stage=workspace.querySelector('.direct-call-stage').getBoundingClientRect(),chat=workspace.querySelector('.direct-call-chat').getBoundingClientRect();return{stage:{x:stage.x,y:stage.y},chat:{x:chat.x,y:chat.y},mobile:innerWidth<=760}});
  if(layout.mobile)expect(layout.chat.y).toBeGreaterThan(layout.stage.y);else expect(layout.chat.x).toBeGreaterThan(layout.stage.x);
  await page.evaluate(()=>window.__directCallSockets[0].close());
  await expect.poll(()=>page.evaluate(()=>window.__directCallSockets.length)).toBe(2);
  await expect(page.locator('[data-call-status]')).toHaveText('Direct Call connected');
});

test('voice connection restarts failed ICE before replacing the signaling socket', async ({ page }) => {
  await page.goto('/login');
  await page.addScriptTag({url: '/assets/voice-connection.js'});
  const result = await page.evaluate(async () => {
    const states = [], sent = [];
    let peers = 0, sockets = 0, restarts = 0;
    class FakePeer {
      constructor() { this.localDescription=null;this.connectionState='new';peers++; }
      addTrack(){} addTransceiver(){} addIceCandidate(){return Promise.resolve()}
      createOffer(options){sent.push({offer:options||{}});return Promise.resolve({type:'offer',sdp:'offer'})}
      setLocalDescription(value){this.localDescription=value;return Promise.resolve()}
      setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();return Promise.resolve()}
      restartIce(){restarts++} close(){this.connectionState='closed'}
    }
    class FakeSocket {
      static OPEN=1;
      constructor(){this.readyState=1;sockets++;queueMicrotask(()=>this.onopen?.())}
      send(raw){const frame=JSON.parse(raw);if(frame.type==='join'||frame.type==='offer')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({version:1,type:'answer',sdp:{type:'answer',sdp:'answer'},resume_token:'resume'})}))}
      close(){this.readyState=3}
    }
    const connection=new window.AllChatVoiceConnection({roomID:'voice-room',stream:{getTracks:()=>[{kind:'audio'}]},onState:state=>states.push(state),fetchCredentials:async()=>[],createPeer:()=>new FakePeer(),createSocket:()=>new FakeSocket(),iceGracePeriod:5});
    await connection.start();
    connection.peer.connectionState='failed';connection.peer.onconnectionstatechange();
    await new Promise(resolve=>setTimeout(resolve,10));
    const snapshot={states:[...states],peers,sockets,restarts,iceRestartOffers:sent.filter(item=>item.offer.iceRestart).length};
    connection.stop();return snapshot;
  });
  expect(result.states).toContain('recovering');
  expect(result.states.at(-1)).toBe('connected');
  expect(result).toMatchObject({peers:1,sockets:1,restarts:1,iceRestartOffers:1});
});

test('voice connection replaces a half-open socket after missed heartbeat acknowledgements', async ({ page }) => {
  await page.goto('/login');
  await page.addScriptTag({url:'/assets/voice-connection.js'});
  const result=await page.evaluate(async()=>{
    let socketCount=0,credentialFetches=0;const states=[];
    class Peer{constructor(){this.localDescription=null}addTrack(){}addTransceiver(){}createOffer(){return Promise.resolve({type:'offer',sdp:'offer'})}setLocalDescription(value){this.localDescription=value;return Promise.resolve()}setRemoteDescription(){return Promise.resolve()}addIceCandidate(){return Promise.resolve()}close(){}}
    class Socket{static OPEN=1;constructor(){this.readyState=1;this.number=++socketCount;queueMicrotask(()=>this.onopen?.())}send(raw){const frame=JSON.parse(raw);if(frame.type==='join')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({version:1,type:'answer',sdp:{type:'answer',sdp:'answer'},resume_token:'resume'})}));if(frame.type==='heartbeat'&&this.number>1)queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({version:1,type:'heartbeat-ack'})}))}close(){if(this.readyState===3)return;this.readyState=3;queueMicrotask(()=>this.onclose?.())}}
    const connection=new window.AllChatVoiceConnection({roomID:'voice-room',stream:{getTracks:()=>[{kind:'audio'}]},onState:state=>states.push(state),fetchCredentials:async()=>{credentialFetches++;return[]},createPeer:()=>new Peer(),createSocket:()=>new Socket(),heartbeatInterval:5,heartbeatTimeout:12,recoveryDelays:[0],recoveryTimeout:100});
    await connection.start();await new Promise(resolve=>setTimeout(resolve,35));
    const snapshot={states:[...states],socketCount,credentialFetches};connection.stop();return snapshot;
  });
  expect(result.states).toContain('recovering');
  expect(result.states.at(-1)).toBe('connected');
  expect(result).toMatchObject({socketCount:2,credentialFetches:2});
});

test('mobile navigation and Community Member drawers have symmetric close controls', async ({page})=>{
  await page.goto('/login');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{document.body.className='';document.body.innerHTML='<div class="app-shell"><aside class="channel-sidebar"><div class="community-switcher"><button class="community-header"><span>Community</span><span data-community-arrow>⌄</span></button></div></aside><main class="content-shell"><header class="content-header"><button data-sidebar-toggle aria-expanded="false">☰</button><h1>General</h1><div class="header-actions"><button data-dm-button>✦</button><button data-notification-bell>🔔</button></div></header><aside class="participant-sidebar"><ul class="participant-list"><li>Member</li></ul></aside></main></div>'});
  await page.addStyleTag({url:'/assets/app.css'});
  await page.addStyleTag({url:'/assets/channel.css'});
  await page.addScriptTag({url:'/assets/app.js'});
  const headerControls = await page.evaluate(() => {
    const members=document.querySelector('[data-members-toggle]'),actions=document.querySelector('.header-actions'),actionRight=actions.getBoundingClientRect().right,memberRect=members.getBoundingClientRect();
    return {membersAfterActions:members.previousElementSibling===actions,actionRight,memberLeft:memberRect.left,memberRight:memberRect.right,viewport:innerWidth};
  });
  expect(headerControls.membersAfterActions).toBe(true);
  expect(headerControls.memberLeft).toBeGreaterThanOrEqual(headerControls.actionRight);
  expect(headerControls.viewport-headerControls.memberRight).toBeLessThanOrEqual(6);
  await page.locator('[data-sidebar-toggle]').click();
  const drawerControls = await page.evaluate(() => {
    const arrow=document.querySelector('[data-community-arrow]').getBoundingClientRect(), close=document.querySelector('[data-sidebar-close]').getBoundingClientRect();
    return {arrowRight:arrow.right,closeLeft:close.left};
  });
  expect(drawerControls.arrowRight).toBeLessThanOrEqual(drawerControls.closeLeft);
  await page.locator('[data-sidebar-close]').click();
  await expect(page.locator('.channel-sidebar')).toHaveAttribute('data-open','false');
  await page.locator('[data-members-toggle]').click();
  await expect(page.locator('.participant-sidebar')).toHaveAttribute('data-open','true');
  await page.locator('[data-members-close]').click();
  await expect(page.locator('.participant-sidebar')).toHaveAttribute('data-open','false');
});

test('websocket wrapper closes a half-open realtime connection after inbound silence', async ({ page }) => {
  await page.goto('/login');
  const result = await page.evaluate(async () => {
    const NativeWebSocket = window.WebSocket;
    const sockets = [];
    class SilentSocket extends EventTarget {
      static OPEN = 1;
      constructor() { super(); this.readyState = 1; this.closeCalls = 0; sockets.push(this); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
      send() {}
      close() { this.closeCalls++; this.readyState = 3; this.dispatchEvent(new Event('close')); }
    }
    window.WebSocket = SilentSocket;
    window.__allchatWebSocketBatches = false;
    window.__allchatWebSocketLiveness = {checkInterval: 5, timeout: 12};
    const source = await (await fetch('/assets/app.js')).text();
    Function(source.slice(0, source.indexOf('\n\n(() => {', 1)))();
    const socket = new window.WebSocket('ws://example.invalid/api/v1/realtime');
    let closes = 0;
    socket.onclose = () => { closes++; };
    await new Promise(resolve => setTimeout(resolve, 35));
    const snapshot = {nativeCloseCalls: sockets[0].closeCalls, closes};
    window.WebSocket = NativeWebSocket;
    return snapshot;
  });
  expect(result).toEqual({nativeCloseCalls: 1, closes: 1});
});

test('clicking a voice channel joins in place without replacing the text conversation', async ({ page }) => {
  let voiceParticipants = [{member_id: 'member-one', connected: true, speaking: false, screen_sharing: true}];
  await page.route('**/api/v1/channels', route => route.fulfill({json: {channels: [{id: 'voice-one', name: 'General', type: 'voice'}]}}));
  await page.route('**/api/v1/voice/voice-one/participants', route => route.fulfill({json: {participants: voiceParticipants, names: {'member-one': 'Akko', 'member-two': 'Spikey'}, members: {'member-one': {id: 'member-one', username: 'akko', display_name: 'Akko'}, 'member-two': {id: 'member-two', username: 'spikey', display_name: 'Spikey'}}}}));
  await page.route('**/api/v1/turn-credentials', route => route.fulfill({json: {ice_servers: []}}));
  await page.route('**/channels/text-two', route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head><title># second — AllChat</title></head><body data-channel-id="text-two" data-member-id="member-one" data-last-sequence="0"><div class="app-shell"><nav class="channel-nav"><a class="channel-link voice-link" href="/channels/voice-one">General</a><a class="channel-link" href="/channels/text-two" aria-current="page">second</a></nav><main class="content-shell" id="second-conversation">Second text conversation</main></div></body></html>`}));
  await page.route('**/channels/voice-one', route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head><title>General — AllChat Voice</title></head><body data-channel-id="voice-one" data-member-id="member-one"><div class="app-shell"><nav class="channel-nav"><a class="channel-link voice-link" href="/channels/voice-one">General</a><a class="channel-link" href="/channels/text-two">second</a></nav><main class="content-shell media-stage-view" data-media-stage="voice-one"><header class="content-header"><h1>General</h1></header><section class="media-stage"><div class="media-stage-grid" data-media-stage-grid></div></section></main></div></body></html>`}));
  await page.route('**/profile', route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head><title>Profile — AllChat</title></head><body><div class="app-shell"><aside class="channel-sidebar"><nav class="settings-nav"><a href="/profile" aria-current="page">My Account</a><a href="/sessions">Sessions</a></nav></aside><main class="content-shell" id="profile-settings">Profile settings</main></div></body></html>`}));
  await page.route('**/sessions', route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head><title>Sessions — AllChat</title></head><body><div class="app-shell"><aside class="channel-sidebar"><nav class="settings-nav"><a href="/profile">My Account</a><a href="/sessions" aria-current="page">Sessions</a></nav></aside><main class="content-shell" id="session-settings">Session settings</main></div></body></html>`}));
  await page.route('**/dms', route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head><title>Direct Messages — AllChat</title></head><body><div class="app-shell"><aside class="community-rail"><a href="/">AC</a></aside><aside class="channel-sidebar" id="dm-sidebar"><nav class="channel-nav"><a href="/channels/text-two">second</a></nav></aside><main class="content-shell" id="dm-home"><button data-sidebar-toggle>Menu</button>Direct Messages</main></div></body></html>`}));
  await page.goto('/login');
  await page.evaluate(() => {
    window.voiceCaptureRequests = 0;
    const audioTrack = {kind: 'audio', enabled: true, stop() { window.voiceTrackStopped = true; }};
    Object.defineProperty(navigator, 'mediaDevices', {configurable: true, value: {getUserMedia: async () => {window.voiceCaptureRequests++; return {getTracks: () => [audioTrack], getAudioTracks: () => [audioTrack]};}}});
    window.RTCPeerConnection = class {
      constructor() { this.iceGatheringState = 'gathering'; this.localDescription = null; this.listeners = {}; window.voicePeer = this; }
      addTrack() { return {}; }
      addTransceiver() {}
      createOffer() { return Promise.resolve({type: 'offer', sdp: 'mock-offer'}); }
      createAnswer() { return Promise.resolve({type: 'answer', sdp: 'mock-client-answer'}); }
      setLocalDescription(value) { this.localDescription = value; setTimeout(() => this.onicecandidate?.({candidate: {toJSON: () => ({candidate: 'candidate:mock'})}}), 10); setTimeout(() => {this.iceGatheringState = 'complete'; (this.listeners.icegatheringstatechange || []).forEach(listener => listener());}, 1500); return Promise.resolve(); }
      setRemoteDescription() { return Promise.resolve(); }
      addIceCandidate() { return Promise.resolve(); }
      addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
      removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== listener); }
      close() {}
    };
    window.WebSocket = class {
      static OPEN = 1;
      constructor() { this.readyState = 1; window.voiceHeartbeatFrames = 0; setTimeout(() => this.onopen?.(), 0); }
      send(value) { const frame = JSON.parse(value); if (frame.type === 'join') { window.voiceJoinFrame = frame; setTimeout(() => this.onmessage?.({data: JSON.stringify({version: 1, type: 'answer', sdp: {type: 'answer', sdp: 'mock-answer'}, resume_token: 'resume'}),}), 500); } if (frame.type === 'heartbeat') window.voiceHeartbeatFrames++; if (frame.type === 'mute-state') window.voiceMuteFrame = frame; }
      close() { this.readyState = 3; }
    };
  });
  await page.setContent(`
    <link rel="stylesheet" href="/assets/app.css">
    <link rel="stylesheet" href="/assets/channel.css">
    <div class="app-shell">
      <a id="dm-navigation" href="/dms">Direct Messages</a>
      <aside class="channel-sidebar" data-open="true"><nav class="channel-nav"><a class="channel-link" href="/channels/voice-one">General</a><a class="channel-link" href="/channels/text-two">second</a></nav><a href="/profile">Settings</a></aside>
      <main class="content-shell" id="text-conversation">Text conversation remains open</main>
    </div>
    <script src="/assets/app.js"></script>
  `);
  await expect(page.locator('.channel-nav')).toHaveAttribute('data-voice-sidebar-ready', 'true');
  const voiceStarted = Date.now();
  await page.locator('a[href="/channels/voice-one"]').click();
  await expect(page.locator('#text-conversation')).toBeVisible();
  await expect(page.locator('[data-voice-connection="voice-one"]')).toBeVisible();
  await expect(page.locator('[data-voice-participants="voice-one"]')).toContainText('Connecting');
  await expect(page.locator('[data-voice-connection="voice-one"] strong')).toHaveText('Voice Connected');
  expect(Date.now() - voiceStarted).toBeLessThan(1500);
  expect(await page.evaluate(() => ({captureRequests: window.voiceCaptureRequests, join: window.voiceJoinFrame}))).toMatchObject({captureRequests: 1, join: {type: 'join', room_id: 'voice-one'}});
  await page.evaluate(() => {window.voiceEarcons = []; window.allchatVoiceEarcon = kind => window.voiceEarcons.push(kind);});
  voiceParticipants = [...voiceParticipants, {member_id: 'member-two', connected: true, speaking: false}];
  await expect.poll(() => page.evaluate(() => window.voiceEarcons)).toContain('join');
  voiceParticipants = voiceParticipants.filter(item => item.member_id !== 'member-two');
  await expect.poll(() => page.evaluate(() => window.voiceEarcons)).toContain('leave');
  await page.evaluate(() => {
    window.botOneAudio = new MediaStream();
    window.botTwoAudio = new MediaStream();
    window.voicePeer.ontrack({track: {kind: 'audio', id: 'audio-bot1', addEventListener() {}}, streams: [window.botOneAudio]});
    window.voicePeer.ontrack({track: {kind: 'audio', id: 'audio-bot2', addEventListener() {}}, streams: [window.botTwoAudio]});
  });
  await expect(page.locator('body > audio')).toHaveCount(2);
  expect(await page.evaluate(() => [...document.querySelectorAll('body > audio')].map(audio => audio.srcObject).includes(window.botOneAudio))).toBe(true);
  await page.locator('a[href="/channels/voice-one"]').click();
  await expect(page.locator('[data-media-stage-grid] .participant-tile')).toContainText('Akko');
  await page.evaluate(() => window.voicePeer.ontrack({track: {kind: 'video', id: 'screen', addEventListener() {}}, streams: [new MediaStream()]}));
  await expect(page.locator('[data-media-stage-grid]')).toHaveAttribute('data-tile-count', '1');
  await expect(page.locator('[data-media-stage-grid] .participant-tile video')).toHaveCount(1);
  await expect(page.locator('[data-media-stage-grid] .screen-tile')).toHaveCount(0);
  await page.evaluate(() => {
    document.querySelector('[data-media-stage-grid] .participant-tile').stageIdentity = 'preserved';
    window.stageChildMutations = 0;
    new MutationObserver(records => { window.stageChildMutations += records.filter(record => record.type === 'childList').length; }).observe(document.querySelector('[data-media-stage-grid]'), {childList: true});
  });
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => document.querySelector('[data-media-stage-grid] .participant-tile').stageIdentity)).toBe('preserved');
  expect(await page.evaluate(() => window.stageChildMutations)).toBe(0);
  await page.locator('a[href="/channels/text-two"]').click();
  await expect(page.locator('#second-conversation')).toBeVisible();
  await expect(page.locator('[data-voice-connection="voice-one"] strong')).toHaveText('Voice Connected');
  expect(await page.evaluate(() => ({captureRequests: window.voiceCaptureRequests, trackStopped: window.voiceTrackStopped || false}))).toEqual({captureRequests: 1, trackStopped: false});
  expect(new URL(page.url()).pathname).toBe('/channels/text-two');
  await page.locator('a[href="/profile"]').click();
  await expect(page.locator('[data-app-overlay] #profile-settings')).toBeVisible();
  await expect(page.locator('[data-voice-connection="voice-one"] strong')).toHaveText('Voice Connected');
  await page.locator('[data-app-overlay] a[href="/sessions"]').evaluate(link => link.click());
  await expect(page.locator('[data-app-overlay] #session-settings')).toBeVisible();
  await expect(page.locator('[data-voice-connection="voice-one"] strong')).toHaveText('Voice Connected');
  await page.locator('[data-overlay-close]').click();
  await expect(page.locator('[data-app-overlay]')).toHaveCount(0);
  await page.locator('#dm-navigation').evaluate(link => link.click());
  await expect(page.locator('#dm-home')).toBeVisible();
  await expect(page.locator('[data-voice-connection="voice-one"] strong')).toHaveText('Voice Connected');
  expect(await page.evaluate(() => ({captureRequests: window.voiceCaptureRequests, trackStopped: window.voiceTrackStopped || false}))).toEqual({captureRequests: 1, trackStopped: false});
  const mobileMenu = page.locator('#dm-home [data-sidebar-toggle]');
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  const mute = page.locator('[data-voice-mute]');
  await expect(mute.locator('svg')).toBeVisible();
  await expect(mute).toHaveCSS('color', 'rgb(255, 93, 98)');
  await mute.click();
  expect(await page.evaluate(() => window.voiceMuteFrame)).toMatchObject({type: 'mute-state', muted: true});
  const hangup = page.locator('[data-voice-leave]');
  await expect(hangup).toHaveText('☎');
  await expect(hangup).toHaveCSS('color', 'rgb(255, 93, 98)');
  await hangup.click();
  await expect(page.locator('[data-voice-connection="voice-one"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.voiceTrackStopped)).toBe(true);
  await expect(page.locator('#second-conversation')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/channels/text-two');
});
