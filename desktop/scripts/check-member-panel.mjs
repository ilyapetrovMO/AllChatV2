import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const server = await createServer({ root, configFile: path.join(root, 'vite.renderer.config.mts'), server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const member = { id: 'me', username: 'alex', displayName: 'A very long account name', owner: true };
    const state = {
      connection: 'online', version: 1, community: { name: 'AllChat Community' }, member,
      members: [member, { id: 'sam', username: 'sam', owner: false }],
      categories: [{ id: 'cat', name: 'Community', position: 0, archived: false }],
      channels: [{ id: 'general', category_id: 'cat', name: 'general', type: 'text', position: 0, archived: false }, { id: 'lounge', category_id: 'cat', name: 'Lounge', type: 'voice', position: 1, archived: false }],
      direct_messages: [], messages: { general: [{ id: 'hello', channel_id: 'general', author_id: 'sam', author_name: 'Sam', sequence: 1, body: 'Welcome!', created_at: '2026-09-09T10:00:00Z', deleted: false }] }, channel_states: [], presence: { me: 'online' }, typing: [],
      notifications: { current_member_id: 'me', community: { level: 'mentions_only', muted: false, sound_enabled: true }, channels: {}, muted_channel_ids: [] },
      media: { audio_bitrate: 64000, screen_bitrate: 2500000 }, cursor: 1,
    };
    const shell = { activeInstanceId: 'home', instances: [{ id: 'home', displayName: 'AllChat', baseUrl: 'https://chat.example', partition: 'persist:allchat-home', credentialRef: 'test', session: { member, sessionId: 'session', expiresAt: '2099-01-01T00:00:00Z' } }] };
    let settings = { name: 'AllChat Community', max_attachment_mib: 25, home_markdown: 'Welcome to AllChat Community.', push_relay_url: 'https://push.example.com', push_key_id: 'key-1', push_public_key: 'public-key' };
    let roles = [
      { id: 'owner', name: 'Owner', position: 0, owner: true, default: false, permissions: [] },
      { id: 'mod', name: 'Moderator', position: 1, owner: false, default: false, permissions: ['moderate_members'] },
      { id: 'member', name: 'Member', position: 2, owner: false, default: true, permissions: [] },
    ];
    let invitations = [{ id: 'invite', token: 'allchat-7QK9-WM2P', expires_at: '2026-09-10T10:00:00Z', max_uses: 5, use_count: 1, revoked: false }];
    let sounds = [{ id: 'airhorn', name: 'Airhorn', emoji: '♪', content_type: 'audio/ogg', size: 12288, duration_ms: 900, position: 0, audio_url: '/audio' }, { id: 'celebration', name: 'Celebration', emoji: '♪', content_type: 'audio/ogg', size: 34816, duration_ms: 2400, position: 1, audio_url: '/audio2' }];
    let soundLimit = 10000;
    window.setMemberPanelSounds = count => { sounds = Array.from({length:count}, (_,i)=>({id:'sound-'+i,name:'Sound '+(i+1),emoji:'♪'})); };
    let notifyState = () => {};
    window.setProfileFixture = ({ owner = true, targetOwner = false, disabled = false, blocked = false } = {}) => {
      state.member = { ...member, owner };
      state.members = [state.member, { id: 'sam', username: 'sam', displayName: 'Sam', owner: targetOwner, disabled }];
      state.presence.sam = 'online';
      state.direct_messages = blocked ? [{ id: 'sam-dm', other: state.members[1], blocked_by_me: true, blocked_by_other: false }] : [];
      notifyState({ ...state });
    };
    state.direct_messages = [{id:'sam-dm',other:state.members[1],unread:0,blocked_by_me:false,blocked_me:false}];
    state.messages['sam-dm'] = Array.from({length:50},(_,i)=>({id:'dm-'+i,channel_id:'sam-dm',author_id:'sam',author_name:'Sam',sequence:i+1,body:'A message to retain while chatting '+i,created_at:'2026-09-09T10:00:00Z',deleted:false}));
    window.appendCallMessage = () => {state.messages['sam-dm']=[...state.messages['sam-dm'],{...state.messages['sam-dm'][0],id:'new-dm',sequence:51,body:'New message while hidden'}];state.direct_messages[0].unread=1;notifyState({...state});};
    window.settingsActions = [];
    window.settingsStoppedCameras = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      const stream = canvas.captureStream();
      stream.getTracks().forEach(track => {
        const stop = track.stop.bind(track);
        track.stop = () => { window.settingsStoppedCameras += 1; stop(); };
      });
      if (window.settingsDelayCamera) await new Promise(resolve => { window.settingsReleaseCamera = resolve; });
      return stream;
    };
    window.allchatDesktop = {
      getShellState: async () => shell, selectInstance: async () => shell,
      loadInstance: async () => state, watchInstance: (_id, callback) => { notifyState = callback; return () => {}; },
      executeInstance: async (_id, action) => {
        window.settingsActions.push(action);
        if (window.settingsFailNextAction === action.type) { window.settingsFailNextAction = null; throw new Error('Simulated save failure'); }
        if (action.type === 'start_call') return {type:'call',call:{id:'call-sam',direct_message_id:'sam-dm',caller_id:'me',recipient_id:'sam',state:'accepted',created_at:'2026-09-09T10:00:00Z'}};
        if (action.type === 'update_read_position' && action.conversationId === 'sam-dm') {return {type:'read_position',conversationId:'sam-dm',sequence:action.sequence};}
        if (action.type === 'list_activities') return {type:'activities',activities:[{enabled:true,manifest:{id:'sketchboard',name:'Sketchboard',description:'Draw together'}}]};
        if (action.type === 'launch_activity') return {type:'activity_launch',activityId:'sketchboard',token:'fixture',runtimeUrl:'about:blank'};
        if (action.type === 'list_roles') return { type: 'roles', roles };
        if (action.type === 'create_role') { const role = { ...action, id: 'role-' + roles.length, default: false, owner: false }; roles = [...roles, role]; return { type: 'role', role }; }
        if (action.type === 'update_role') { const role = { ...roles.find(r => r.id === action.roleId), ...action }; roles = roles.map(r => r.id === action.roleId ? role : r); return { type: 'role', role }; }
        if (action.type === 'retire_role') roles = roles.filter(r => r.id !== action.roleId);
        if (action.type === 'list_invitations') return { type: 'invitations', invitations };
        if (action.type === 'create_invitation') { const invitation = { id: 'new-invite', token: 'new-invitation-code', expires_at: '2026-09-10T10:00:00Z', max_uses: action.maxUses, use_count: 0, revoked: false }; invitations = [invitation, ...invitations]; return { type: 'invitation', invitation }; }
        if (action.type === 'revoke_invitation') invitations = invitations.filter(i => i.id !== action.invitationId);
        if (action.type === 'list_soundboard') return { type: 'soundboard', sounds, maxDurationMs: soundLimit };
        if (action.type === 'set_soundboard_limit') soundLimit = action.maxDurationMs;
        if (action.type === 'upload_sound') { const sound = { id: 'uploaded-' + sounds.length, name: action.name, emoji: action.emoji, content_type: action.contentType, size: action.data.length, duration_ms: 1000, position: action.position, audio_url: '/uploaded' }; sounds = [...sounds, sound]; return { type: 'sound', sound }; }
        if (action.type === 'update_sound') { const sound = { ...sounds.find(i => i.id === action.soundId), name: action.name, emoji: action.emoji, position: action.position }; sounds = sounds.map(i => i.id === action.soundId ? sound : i); return { type: 'sound', sound }; }
        if (action.type === 'delete_sound') sounds = sounds.filter(i => i.id !== action.soundId);
        if (action.type === 'create_category') { const category = { id: 'cat-' + state.categories.length, name: action.name, position: action.position, archived: false }; state.categories.push(category); return { type: 'category', category }; }
        if (action.type === 'create_channel') { const channel = { id: 'chan-' + state.channels.length, category_id: action.categoryId, name: action.name, type: action.channelType, position: action.position, archived: false }; state.channels.push(channel); return { type: 'channel', channel }; }
        if (action.type === 'update_channel') { const channel = { ...state.channels.find(c => c.id === action.channelId), name: action.name }; state.channels = state.channels.map(c => c.id === action.channelId ? channel : c); return { type: 'channel', channel }; }
        if (action.type === 'get_community_settings') return { type: 'community_settings', settings };
        if (action.type === 'update_community_settings') { settings = { ...settings, name: action.name, max_attachment_mib: action.maxAttachmentMiB, home_markdown: action.homeMarkdown, push_relay_url: action.pushRelayURL }; return { type: 'community_settings', settings }; }
        if (action.type === 'list_sessions') return { type: 'sessions', sessions: [{ id: 'current', device: 'Desktop Linux', current: true }, { id: 'laptop', device: 'Laptop Windows', current: false, last_activity: '2026-09-08T10:00:00Z' }] };
        if (action.type === 'list_reports') return { type: 'reports', reports: [{ id: 'r1', status: 'open', reason: 'Repeated unwanted messages.' }, { id: 'r2', status: 'resolved', reason: 'Disruptive posts in the conversation.' }] };
        if (action.type === 'list_moderation_records') return { type: 'moderation_records', records: [] };
        if (action.type === 'create_report') return { type: 'report', report: { id: 'r3', status: 'open', reason: action.reason } };
        if (action.type === 'community_home') return { type: 'community_home', markdown: 'Welcome to AllChat Community.' };
        return { type: 'accepted' };
      },
    };
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);

  await page.getByLabel('Community Guide').waitFor();
  await page.getByRole('button',{name:'Lounge',exact:true}).click();
  assert.ok(await page.getByLabel('Community Guide').isVisible(),'Joining voice leaves the greeting visible');
  await page.getByRole('button',{name:'Open Activities'}).click();
  await page.getByRole('button',{name:/Sketchboard/}).click();
  await page.getByRole('region',{name:'Call Activities'}).waitFor({state:'hidden'});
  assert.equal(await page.getByTitle('Call Activity').count(),1,'Starting an activity from the greeting opens its voice room immediately');
  assert.ok(await page.locator('.voice-room-stage').isVisible());
  await page.getByRole('button',{name:'Open Activities'}).click();
  await page.getByRole('button',{name:'Close Activity',exact:true}).click();
  await page.getByRole('button',{name:'Open Activities'}).click();
  await page.getByRole('button',{name:'Disconnect voice'}).click();
  await page.getByRole('button', {name:'general',exact:true}).click();
  const panel=page.locator('.floating-member-panel');
  async function check(width,connected=false) {
    await page.locator('.community-shell').evaluate((e,w)=>e.style.setProperty('--navigation-width',w+'px'),width);
    const nav=await page.locator('.conversation-sidebar').boundingBox(), box=await panel.boundingBox(); const rail=await page.locator('.instance-rail').isVisible()?await page.locator('.instance-rail').boundingBox():null; const left=rail?.x??nav.x;
    assert.ok(Math.abs(box.x-left-8)<1 && Math.abs(nav.x+nav.width-box.x-box.width-8)<=1,'Panel inset inside navigation '+JSON.stringify({nav,box}));
    assert.equal(box.height,connected?156:56);
    if(rail){const add=await page.getByRole('button',{name:'Add Community',exact:true}).boundingBox();assert.ok(add.y+add.height<=box.y-8,'Plus button sits above the full-width member panel');}
    assert.ok(Math.abs(nav.y+nav.height-box.y-box.height-8)<1,'Panel anchored at navigation bottom');
    for (const button of await panel.locator('button').all()) {
      const b=await button.boundingBox();if(!b)continue;
      assert.ok(b.x>=box.x&&b.x+b.width<=box.x+box.width+1&&b.y>=box.y&&b.y+b.height<=box.y+box.height+1,'Controls remain within compact panel');
    }
    assert.ok(await panel.locator('.member-identity strong').evaluate(e=>getComputedStyle(e).textOverflow==='ellipsis'&&e.scrollWidth>e.clientWidth),'Long names truncate');
  }
  for(const width of [288,240,216,192])await check(width);
  await page.getByRole('button',{name:'Open Member menu',exact:true}).click(); await page.getByRole('menu',{name:'Presence status'}).waitFor();await page.getByRole('button',{name:'Open Member menu',exact:true}).click();
  await page.screenshot({path:'/tmp/member-panel-navigation.png'});
  await page.getByRole('button',{name:'Mute microphone',exact:true}).click();
  await page.getByRole('button',{name:'Unmute microphone',exact:true}).waitFor();
  for(const name of ['Microphone controls','Headphones controls']) {
    await page.getByRole('button',{name,exact:true}).click();
    const dialog=page.getByRole('dialog',{name,exact:true});await dialog.waitFor();
    const b=await dialog.boundingBox(),p=await panel.boundingBox();assert.ok(b.y+b.height<p.y+20&&b.x>=0,'Audio popover fits above panel');
    await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
  }
  await page.getByRole('button',{name:'Lounge',exact:true}).click();
  await page.getByRole('button',{name:'Disconnect voice'}).waitFor();
  for(const width of [288,240,216,192])await check(width,true);
  assert.equal(await panel.locator('.member-call-actions button').count(),4);
  await panel.locator('.connection-signal').hover();
  const tooltip=panel.getByRole('tooltip');await tooltip.waitFor({state:'visible'});
  assert.equal(await panel.locator('.connection-signal').evaluate(e=>getComputedStyle(e).overflow),'visible');
  await page.getByRole('button',{name:'Open soundboard'}).click();await page.getByRole('button',{name:/Airhorn/}).waitFor();
  const soundboard=page.getByRole('dialog',{name:'Community soundboard'});
  const sb=await soundboard.boundingBox(), memberBox=await panel.boundingBox();
  assert.ok(sb.y+sb.height<=memberBox.y-8,'Soundboard opens above the member panel without overlap');
  await page.getByRole('button',{name:/Airhorn/}).click();
  assert.ok(await soundboard.isVisible(),'Playing a sound keeps the soundboard open');
  await page.getByRole('button',{name:/Airhorn/}).click();
  assert.ok(await soundboard.isVisible(),'Repeated playback keeps the soundboard open');
  await page.keyboard.press('Escape');
  assert.equal(await soundboard.count(),0,'Escape closes the soundboard');
  await page.setViewportSize({width:960,height:640});
  for(const count of [0,10,40]) {
    await page.evaluate(n=>window.setMemberPanelSounds(n),count);
    await page.getByRole('button',{name:'Open soundboard'}).click();await soundboard.waitFor();
    const popup=await soundboard.boundingBox(),card=await panel.boundingBox();
    assert.ok(popup.y>=8&&popup.y+popup.height<=card.y-8&&popup.x>=8&&popup.x+popup.width<=952,'Empty and populated soundboards fit above the panel in a short window');
    const close=soundboard.getByRole('button',{name:'Close soundboard'});
    assert.ok(await close.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'Soundboard is above other stacking layers');
    if(count){await soundboard.getByRole('button',{name:'Sound '+count,exact:true}).click();assert.ok(await soundboard.isVisible());await close.click();}
    else {await page.screenshot({path:'/tmp/soundboard-panel-fixed.png'});await close.click();}
    assert.equal(await soundboard.count(),0);
  }
  await page.setViewportSize({width:1280,height:800});
  await page.getByRole('button',{name:'general',exact:true}).click();
  await page.getByRole('button',{name:'Return to Voice Room Lounge'}).click();await page.locator('.voice-room-stage').waitFor();
  await page.getByRole('button',{name:'User Settings',exact:true}).click();await check(240,true);
  await page.screenshot({path:'/tmp/member-panel-settings.png'});
  await page.getByRole('button',{name:'Disconnect voice'}).click();await check(240);
  await page.screenshot({path:'/tmp/member-panel-compact.png'});
  await page.getByRole('button',{name:/Back to Community/}).click();
  await page.getByRole('button',{name:'sam',exact:true}).click();
  await page.getByRole('button',{name:'Start Call',exact:true}).click();
  await page.getByRole('region',{name:'Direct Call grid'}).waitFor();
  const chat=page.locator('#conversation-chat-pane'),messages=page.getByLabel('sam Messages'),draft=chat.locator('textarea');
  await draft.fill('Keep this unsent draft');
  for (const width of [1280,960,800]) {
    await page.setViewportSize({width,height:800});
    await messages.evaluate(e=>{e.scrollTop=240;e.dispatchEvent(new Event('scroll'));});
    const scroll=await messages.evaluate(e=>e.scrollTop);
    const before=await page.getByRole('region',{name:'Direct Call grid'}).boundingBox();
    await page.getByRole('button',{name:'Hide chat',exact:true}).click();
    assert.equal(await chat.isVisible(),false);
    assert.equal(await draft.count(),1,'Collapsed chat stays mounted');
    if(width!==1280)assert.equal(await page.locator('.call-chat-unread').count(),0,'Reopening clears the previous unread badge');
    const full=await page.getByRole('region',{name:'Direct Call grid'}).boundingBox(),workspace=await page.locator('.direct-call-workspace').boundingBox();
    assert.ok(full.width>=before.width&&Math.abs(full.width-workspace.width)<1&&Math.abs(full.height-workspace.height)<1,'Hidden chat gives the call its full workspace');
    if(width===1280){await page.evaluate(()=>window.appendCallMessage());await page.getByLabel('1 unread messages').waitFor();}
    await page.getByRole('button',{name:'Show chat',exact:true}).click();
    assert.ok(await chat.isVisible());assert.equal(await draft.inputValue(),'Keep this unsent draft');
    assert.ok(Math.abs(await messages.evaluate(e=>e.scrollTop)-scroll)<1,'Chat scroll position survives collapsing');
  }
  await page.setViewportSize({width:1280,height:800});
  await page.screenshot({path:'/tmp/direct-call-chat-expanded.png'});
  await page.getByRole('button',{name:'Hide chat',exact:true}).click();
  await page.screenshot({path:'/tmp/direct-call-chat-collapsed.png'});
  assert.deepEqual(errors,[]);console.log('Member panel: combined navigation containment at 264–360px, fixed controls, truncation, popovers, four call actions, soundboard, voice navigation, settings, and disconnect passed.');
} finally { await browser?.close();await server.close(); }
