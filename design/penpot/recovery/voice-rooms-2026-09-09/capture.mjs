import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/home/gosha/src/AllChatV2/node_modules/playwright/index.mjs';
import { createServer } from '/home/gosha/src/AllChatV2/node_modules/vite/dist/node/index.js';

const root = '/home/gosha/src/AllChatV2/desktop';
const output = '/tmp/allchat-voice-current';
const server = await createServer({ root, configFile: path.join(root, 'vite.renderer.config.mts'), server: { host: '127.0.0.1', port: 0 } });
let browser, page;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const member = { id: 'me', username: 'alex', displayName: 'Alex', owner: true };
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
    let notifyState = () => {};
    window.setProfileFixture = ({ owner = true, targetOwner = false, disabled = false, blocked = false } = {}) => {
      state.member = { ...member, owner };
      state.members = [state.member, { id: 'sam', username: 'sam', displayName: 'Sam', owner: targetOwner, disabled }];
      state.presence.sam = 'online';
      state.direct_messages = blocked ? [{ id: 'sam-dm', other: state.members[1], blocked_by_me: true, blocked_by_other: false }] : [];
      notifyState({ ...state });
    };
    window.settingsActions = [];
    window.settingsStoppedCameras = 0;
    navigator.mediaDevices.getUserMedia = async () => { const ctx=new AudioContext(); const dest=ctx.createMediaStreamDestination(); const osc=ctx.createOscillator(); osc.connect(dest); osc.start(); return dest.stream; };
    window.RTCPeerConnection = class {
      constructor(){window.voicePeer=this;} connectionState='connected'; iceConnectionState='connected'; iceGatheringState='complete'; signalingState='stable';
      addTrack(){return {replaceTrack:async()=>{}}} addTransceiver(){return {sender:{replaceTrack:async()=>{},getParameters:()=>({encodings:[{}]}),setParameters:async()=>{}},setCodecPreferences(){}}}
      async createOffer(){return {type:'offer',sdp:'fixture'}} async setLocalDescription(s){this.localDescription=s} async setRemoteDescription(){this.onconnectionstatechange?.()} async addIceCandidate(){} close(){} getStats(){return Promise.resolve(new Map())}
    };
    window.voiceFixtureParticipants=['me','sam','jamie'].map((id,i)=>({member_id:id,room_id:'lounge',connected:true,joined_at:'2026-09-09',server_muted:false,muted:i===2,speaking:i===1,screen_sharing:false}));
    state.members.push({id:'jamie',username:'jamie',displayName:'Jamie',owner:false});
    window.voiceSetOwner = owner => { state.member={...state.member,owner}; notifyState({...state}); };
    window.voiceSetEmpty = () => { window.voiceFixtureParticipants=[]; };
    window.allchatDesktop = {
      getShellState: async () => shell, selectInstance: async () => shell,
      loadInstance: async () => state, watchInstance: (_id, callback) => { notifyState = callback; return () => {}; },
      connectMedia: async (_id, receive) => ({send: frame => { if(frame.type==='join') setTimeout(()=>{receive({type:'answer',sdp:{type:'answer',sdp:'fixture'},negotiation_id:frame.negotiation_id});window.voicePeer.onconnectionstatechange?.();},50); if(frame.type==='heartbeat')receive({type:'heartbeat-ack'}); }, close(){} }),
      executeInstance: async (_id, action) => {
        if(action.type==='turn_credentials')return {type:'turn_credentials',iceServers:[]};
        if(action.type==='list_voice_participants')return {type:'voice_participants',participants:window.voiceFixtureParticipants};
        window.settingsActions.push(action);
        if (window.settingsFailNextAction === action.type) { window.settingsFailNextAction = null; throw new Error('Simulated save failure'); }
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
  await page.getByRole('button',{name:'Lounge',exact:true}).click();
  await page.getByRole('button',{name:'Lounge',exact:true}).click();
  await page.getByRole('complementary').first().waitFor();
  await page.waitForTimeout(2000);
  console.log(await page.locator('.voice-connection-panel').innerText());
  await page.screenshot({path:output+'/initial.png'});
  await page.getByRole('region',{name:'Voice controls'}).getByText('Connected',{exact:true}).waitFor();
  async function capture(name,selector='body') {
    await page.evaluate(()=>document.fonts.ready);
    const target=page.locator(selector);
    await target.screenshot({path:`${output}/${name}.png`});
    const data=await target.evaluate(root=>{
      const origin=root.getBoundingClientRect(), items=[];
      const color=c=>{const m=c.match(/[\d.]+/g);return m?{hex:'#'+m.slice(0,3).map(x=>Math.round(+x).toString(16).padStart(2,'0')).join(''),alpha:m[3]===undefined?1:+m[3]}:{hex:'#000000',alpha:0}};
      const visit=el=>{
        const r=el.getBoundingClientRect(), c=getComputedStyle(el);
        if(c.display==='none'||c.visibility==='hidden')return; if(!r.width||!r.height){for(const child of el.children)visit(child);return;} if(r.bottom<origin.top||r.top>origin.bottom)return;
        const geometry={x:r.x-origin.x,y:r.y-origin.y,w:r.width,h:r.height};
        if(el.tagName.toLowerCase()==='svg'){items.push({type:'svg',...geometry,svg:el.outerHTML.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${c.strokeWidth}" stroke-linecap="${c.strokeLinecap}" stroke-linejoin="${c.strokeLinejoin}" `).replaceAll('currentColor',c.color)});return;}
        const fill=color(c.backgroundColor),stroke=color(c.borderTopColor),border=parseFloat(c.borderTopWidth);
        if(fill.alpha||border)items.push({type:'box',name:el.getAttribute('aria-label')||el.className||el.tagName,...geometry,fill,stroke,border,radius:c.borderRadius.includes('%')?Math.min(r.width,r.height)/2:parseFloat(c.borderRadius)||0});
        for(const node of el.childNodes){if(node.nodeType===Node.ELEMENT_NODE)visit(node);else if(node.nodeType===Node.TEXT_NODE&&node.textContent.trim()){
          const range=document.createRange();range.selectNodeContents(node);const q=range.getBoundingClientRect();
          if(q.width&&q.height)items.push({type:'text',text:c.textTransform==='uppercase'?node.textContent.trim().toUpperCase():node.textContent.trim(),x:q.x-origin.x,y:q.y-origin.y,w:q.width,h:q.height,size:parseFloat(c.fontSize),weight:c.fontWeight,color:color(c.color),family:c.fontFamily});
        }}
      };visit(root);return {name:root.getAttribute('aria-label'),w:origin.width,h:origin.height,items};
    });
    await fs.writeFile(`${output}/${name}.json`,JSON.stringify(data));
    console.log(name,data.items.length);
  }
  await capture('connected');
  await page.getByRole('button',{name:'Mute microphone',exact:true}).click();await capture('muted');
  await page.getByRole('button',{name:'Unmute microphone',exact:true}).click();
  await page.getByRole('button',{name:'Focus sam',exact:true}).click();await capture('focus');
  await page.getByRole('button',{name:'Exit focus for sam',exact:true}).click();
  await page.getByRole('button',{name:'Focus sam',exact:true}).click({button:'right'});await capture('owner-menu','.voice-member-context');await page.keyboard.press('Escape');
  await page.evaluate(()=>window.voiceSetOwner(false));
  await page.getByRole('button',{name:'Focus sam',exact:true}).click({button:'right'});await capture('member-menu','.voice-member-context');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Focus Alex',exact:true}).click({button:'right'});await capture('self-menu','.voice-member-context');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Open soundboard',exact:true}).click();await capture('soundboard','.desktop-soundboard');await page.getByRole('button',{name:'Close soundboard'}).click();
  await page.setViewportSize({width:960,height:640});await capture('compact');
  await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>window.voiceSetEmpty());await page.getByText('No one is connected to this Voice Room.',{exact:true}).waitFor();await capture('empty');
} catch(error) { await page.screenshot({path:`${output}/failure.png`}); throw error; } finally { await browser?.close(); await server.close(); }
