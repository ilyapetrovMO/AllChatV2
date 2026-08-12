(() => {
  "use strict";

  const nav = document.querySelector(".channel-nav");
  if (!nav) return;
  nav.dataset.voiceSidebarReady = "true";

  let active = null;
	let earconContext;
	const prepareEarcons=async()=>{try{earconContext ||= new AudioContext();await earconContext.resume();window.allchatVoiceEarcon=kind=>{const now=earconContext.currentTime,notes=kind==="join"?[523.25,659.25]:[440,329.63];notes.forEach((frequency,index)=>{const oscillator=earconContext.createOscillator(),gain=earconContext.createGain(),start=now+index*.09;oscillator.frequency.value=frequency;gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.08,start+.015);gain.gain.exponentialRampToValueAtTime(.0001,start+.13);oscillator.connect(gain).connect(earconContext.destination);oscillator.start(start);oscillator.stop(start+.14)})}}catch(_){}};
	const currentProfile = () => {
	  const summary = document.querySelector(".member-summary"), image = summary?.querySelector("img"), name = summary?.querySelector("strong")?.textContent.trim() || "You";
	  return {id: document.body.dataset.memberId || "current-member", display_name: name, username: name, avatar_url: image?.getAttribute("src") || ""};
	};
	const setPending = (session, status) => {
	  window.allchatVoicePending ||= new Map();
	  window.allchatVoicePending.set(session.roomID, {member_id: session.profile.id, profile: session.profile, status});
	  document.dispatchEvent(new CustomEvent("allchat:voice-pending"));
	};
  const stopScreen = async session => {
    const stream=session.screenStream;
    session.screenStream=null;
    stream?.getTracks().forEach(track=>{track.onended=null;track.stop()});
    session.screenSenders.forEach(sender=>{try{session.connection?.removeTrack(sender)}catch(_){}});
    session.screenSenders=[];session.screenSender=null;
    session.panel.querySelector("[data-voice-screen]")?.classList.remove("active");
    renderStage();
    await session.connection?.clearVideoTrack();
  };
  const toggleScreen = async session => {
    if(session.screenStream)return stopScreen(session);
    if(!navigator.mediaDevices?.getDisplayMedia)throw new Error(window.allchatText?.screenUnavailable||"Screen sharing is unavailable on this browser.");
    const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true}),track=stream.getVideoTracks()[0],senders=[];
    stream.getAudioTracks().forEach(audio=>senders.push(session.connection.addTrack(audio,stream)));
    const sender=await session.connection.setVideoTrack(track,stream,{sendEncodings:[{rid:"q",scaleResolutionDownBy:4,maxBitrate:Math.min(250000,session.mediaConfig.screen_bitrate)},{rid:"h",scaleResolutionDownBy:2,maxBitrate:Math.min(750000,session.mediaConfig.screen_bitrate)},{rid:"f",maxBitrate:session.mediaConfig.screen_bitrate}]});
    session.screenStream=stream;session.screenSender=sender;session.screenSenders=senders;
    session.panel.querySelector("[data-voice-screen]")?.classList.add("active");
    track.onended=()=>stopScreen(session).catch(()=>{});
    renderStage();
  };
  let stageRenderSequence=0;
  const renderStage = async () => {
    const grid=document.querySelector("[data-media-stage-grid]"),roomID=document.querySelector("[data-media-stage]")?.dataset.mediaStage;
    if(!grid||!active||roomID!==active.roomID)return;
    const session=active,sequence=++stageRenderSequence;
    let state={participants:[],members:{},names:{}};
    try{const response=await fetch(`/api/v1/voice/${roomID}/participants`);if(response.ok)state=await response.json()}catch(_){}
    if(sequence!==stageRenderSequence||active!==session||!grid.isConnected)return;
    const existing=new Map([...grid.children].map(node=>[node.dataset.stageKey,node])),desired=[],screensByMember=new Map(),unmatchedScreens=[];
    if(session.screenStream){let local=session.localScreenVideo;if(!local){local=document.createElement("video");local.autoplay=true;local.muted=true;local.playsInline=true;session.localScreenVideo=local}if(local.srcObject!==session.screenStream)local.srcObject=session.screenStream;screensByMember.set(session.profile.id,local)}
    const participantIDs=new Set((state.participants||[]).map(participant=>participant.member_id));for(const [trackID,video] of session.remoteVideos||[]){if(video.dataset.stopped==="true")continue;const memberID=trackID.startsWith("screen-")?trackID.slice(7):"";if(participantIDs.has(memberID))screensByMember.set(memberID,video);else unmatchedScreens.push(video)}
    for(const participant of state.participants||[]){const key=`participant:${participant.member_id}`,profile=state.members?.[participant.member_id]||{},screen=screensByMember.get(participant.member_id)||(participant.screen_sharing?unmatchedScreens.shift():null);let tile=existing.get(key);if(!tile){tile=document.createElement("article");tile.className="media-stage-tile participant-tile";tile.dataset.stageKey=key;const visual=document.createElement("div");visual.className="media-stage-visual";tile.append(visual,document.createElement("strong"))}const visual=tile.querySelector(".media-stage-visual"),sharing=!!screen;tile.classList.toggle("speaking",!!participant.speaking);tile.classList.toggle("sharing",sharing);tile.onclick=sharing?()=>tile.classList.toggle("expanded"):null;if(sharing){if(screen.parentElement!==visual)visual.replaceChildren(screen)}else{tile.classList.remove("expanded");let avatar=visual.firstElementChild;if(!avatar||avatar.matches("video")){avatar=document.createElement(profile.avatar_url?"img":"span");visual.replaceChildren(avatar)}const wantsImage=!!profile.avatar_url;if(wantsImage!==avatar.matches("img")){const replacement=document.createElement(wantsImage?"img":"span");avatar.replaceWith(replacement);avatar=replacement}if(wantsImage){avatar.className="";avatar.src=profile.avatar_url;avatar.alt=""}else{avatar.className="media-stage-avatar-fallback";avatar.textContent=Array.from(profile.display_name||profile.username||"?")[0].toUpperCase()}}tile.querySelector("strong").textContent=participant.member_id===session.profile.id?"You":profile.display_name||profile.username||state.names?.[participant.member_id]||"Member";let badge=tile.querySelector(".screen-sharing-badge");if((sharing||participant.screen_sharing)&&!badge){badge=document.createElement("span");badge.className="screen-sharing-badge";badge.textContent="Sharing screen";tile.append(badge)}else if(!sharing&&!participant.screen_sharing){badge?.remove()}desired.push(tile)}
    if(!desired.length){let empty=existing.get("empty");if(!empty){empty=document.createElement("p");empty.className="media-stage-empty";empty.dataset.stageKey="empty";empty.textContent="No one is connected to this Voice Room."}desired.push(empty)}
    desired.forEach((node,index)=>{if(grid.children[index]!==node)grid.insertBefore(node,grid.children[index]||null)});
    const keep=new Set(desired);for(const node of [...grid.children])if(!keep.has(node))node.remove();
    grid.dataset.tileCount=String(desired[0]?.dataset.stageKey==="empty"?0:desired.length);
  };
  let audioContext;
  const playSound=async sound=>{try{audioContext ||= new AudioContext();await audioContext.resume();const buffer=await fetch(sound.audio_url).then(response=>response.arrayBuffer()).then(data=>audioContext.decodeAudioData(data));const source=audioContext.createBufferSource();source.buffer=buffer;source.connect(audioContext.destination);source.start()}catch(_){const audio=new Audio(sound.audio_url);audio.play().catch(()=>{})}};
  const openSoundboard=async(session,anchor)=>{
    document.querySelector(".soundboard-popover")?.remove();
    const popover=document.createElement("div");popover.className="soundboard-popover";popover.setAttribute("role","dialog");popover.setAttribute("aria-label","Community soundboard");popover.innerHTML='<header><strong>Soundboard</strong><button type="button" aria-label="Close">×</button></header><div class="soundboard-grid"><span class="muted">Loading sounds…</span></div>';document.body.append(popover);const rect=anchor.getBoundingClientRect();popover.style.left=Math.max(8,rect.right-320)+"px";popover.style.bottom=Math.max(8,innerHeight-rect.top+8)+"px";popover.querySelector("header button").onclick=()=>popover.remove();
    try{const response=await fetch("/api/v1/soundboard");if(!response.ok)throw new Error();const value=await response.json(),grid=popover.querySelector(".soundboard-grid");grid.replaceChildren();(value.sounds||[]).forEach(sound=>{const button=document.createElement("button");button.type="button";button.className="sound-button";button.innerHTML='<span></span><strong></strong>';button.querySelector("span").textContent=sound.emoji||"▶";button.querySelector("strong").textContent=sound.name;button.onclick=()=>{audioContext ||= new AudioContext();audioContext.resume();session.connection?.send("soundboard-play",{sound_id:sound.id});popover.remove()};grid.append(button)});if(!grid.children.length)grid.textContent="No Community sounds have been added yet."}catch(_){popover.querySelector(".soundboard-grid").textContent="Soundboard unavailable."}
  };

  const makePanel = (roomID, name) => {
    document.querySelector(".voice-connection-panel")?.remove();
    const panel = document.createElement("section");
    panel.className = "voice-connection-panel";
    panel.dataset.voiceConnection = roomID;
    panel.innerHTML = `<div><strong>Voice Connecting</strong><span></span></div><div class="voice-connection-actions"><button type="button" data-voice-retry hidden>Retry</button><button class="voice-soundboard" type="button" data-voice-soundboard disabled aria-label="Open soundboard" title="Soundboard">♫</button><button class="voice-screen" type="button" data-voice-screen disabled aria-label="Share screen" title="Share Screen">▣</button><button class="voice-mute" type="button" data-voice-mute disabled aria-label="Mute microphone"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4Zm7-4a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11Z"/></svg></button><button class="voice-hangup" type="button" data-voice-leave aria-label="Disconnect voice">☎</button></div>`;
    panel.querySelector("span").textContent = name;
    const sidebar = document.querySelector(".channel-sidebar");
    const anchor = sidebar?.querySelector(".member-panel, .sidebar-footer");
    if (anchor) anchor.before(panel); else nav.after(panel);
    return panel;
  };

  const closestTextChannel = voiceLink => {
    const links = [...nav.querySelectorAll('a.channel-link[href^="/channels/"]')];
    const voiceIndex = links.indexOf(voiceLink);
    return links
      .map((link, index) => ({link, index}))
      .filter(item => !item.link.classList.contains("voice-link"))
      .sort((left, right) => Math.abs(left.index - voiceIndex) - Math.abs(right.index - voiceIndex))[0]?.link.href || "";
  };

  const leaveVoiceView = session => {
    if (session.closestTextChannel) {
      const navigation = window.allchatNavigate?.(session.closestTextChannel);
      if (navigation) navigation.catch(() => location.assign(session.closestTextChannel));
      else location.assign(session.closestTextChannel);
      return;
    }
    document.querySelector("[data-app-overlay]")?.remove();
    const content = document.querySelector(".content-shell");
    if (!content) return;
    const empty = document.createElement("main");
    empty.className = "content-shell empty-center-stage";
    empty.setAttribute("aria-label", "No text channels");
    content.replaceWith(empty);
  };

  const disconnect = ({explicit = true, removePanel = true, changeView = explicit} = {}) => {
    if (!active) return;
    const session = active;
	setPending(session, "Disconnecting");
    active = null;
	if(window.allchatActiveVoiceRoom===session.roomID)window.allchatActiveVoiceRoom="";
    session.connection?.stop({explicit});
    if (explicit) {
      sessionStorage.removeItem(`allchat-media-resume:${session.roomID}`);
      const csrf=decodeURIComponent(document.cookie.split("; ").find(item=>item.startsWith("allchat_csrf="))?.split("=").slice(1).join("=")||"");
      fetch(`/api/v1/media/rooms/${encodeURIComponent(session.roomID)}/session`,{method:"DELETE",headers:{"X-CSRF-Token":csrf},keepalive:true}).catch(()=>{});
    }
    session.stream?.getTracks().forEach(track => track.stop());
    session.screenStream?.getTracks().forEach(track => track.stop());
    session.remoteVideos?.forEach(video => video.remove());
    session.remoteAudios?.forEach(audio => audio.remove());
    if (removePanel) session.panel.remove();
	setTimeout(()=>{const pending=window.allchatVoicePending?.get(session.roomID);if(pending?.member_id===session.profile.id&&pending.status==="Disconnecting"){window.allchatVoicePending.delete(session.roomID);document.dispatchEvent(new CustomEvent("allchat:voice-pending"))}},650);
    if (changeView) leaveVoiceView(session);
  };

  const connect = async (roomID, name, voiceLink) => {
    if (active?.roomID === roomID) return;
    disconnect({changeView: false});
    const panel = makePanel(roomID, name);
    const status = panel.querySelector("strong");
    const mute = panel.querySelector("[data-voice-mute]");
    const screen = panel.querySelector("[data-voice-screen]");
    const soundboard = panel.querySelector("[data-voice-soundboard]");
    const retry = panel.querySelector("[data-voice-retry]");
    const leave = panel.querySelector("[data-voice-leave]");
    const session = {roomID, name, panel, connection: null, stream: null, screenStream: null, screenSenders: [], screenSender: null, remoteAudios: new Map(), remoteVideos: new Map(), profile: currentProfile(), closestTextChannel: closestTextChannel(voiceLink), mediaConfig: {audio_bitrate:64000,screen_bitrate:2500000}};
    active = session;
	prepareEarcons();
	setPending(session, "Connecting");
    leave.addEventListener("click", () => disconnect());
    retry.onclick = () => {
      if (active === session) disconnect({explicit: false, changeView: false});
      connect(roomID, name, voiceLink);
    };
    screen.addEventListener("click", () => toggleScreen(session).catch(error => { status.textContent=error?.message||"Screen sharing is unavailable.";panel.classList.add("error") }));
    soundboard.addEventListener("click",()=>openSoundboard(session,soundboard));
    mute.addEventListener("click", () => {
      const track = session.stream?.getAudioTracks()[0];
      if (!track) return;
      track.enabled = !track.enabled;
      mute.classList.toggle("muted", !track.enabled);
      mute.setAttribute("aria-label", track.enabled ? "Mute microphone" : "Unmute microphone");
	  session.connection?.send("mute-state",{muted:!track.enabled});
    });
    try {
      status.textContent = "Requesting microphone";
      session.stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}, video: false});
      if (active !== session) return session.stream.getTracks().forEach(track => track.stop());
      session.mediaConfig = await fetch("/api/v1/media/config").then(response => response.ok ? response.json() : session.mediaConfig);
      const resumeKey = `allchat-media-resume:${roomID}`;
      const receiveTrack = event => {
        if (event.track.kind === "video") {
          const video = document.createElement("video");
          video.autoplay = true; video.playsInline = true; video.className = "shared-screen";
          video.srcObject = event.streams[0] || new MediaStream([event.track]);
          const memberID=(event.track.id||event.streams[0]?.id||"").replace(/^screen-/,"");
          for(const [id,old] of session.remoteVideos)if(old.dataset.memberId===memberID){session.remoteVideos.delete(id);old.remove()}
          video.dataset.memberId=memberID;session.remoteVideos.set(event.track.id, video);
          event.track.addEventListener("ended", () => { if(session.remoteVideos.get(event.track.id)===video)session.remoteVideos.delete(event.track.id);video.remove();renderStage(); });
          renderStage();
          return;
        }
        let audio = session.remoteAudios.get(event.track);
        if (!audio) {
          audio = document.createElement("audio"); audio.autoplay = true;
          session.remoteAudios.set(event.track, audio); document.body.append(audio);
          event.track.addEventListener("ended", () => { session.remoteAudios.delete(event.track); audio.remove(); });
        }
        audio.srcObject = event.streams[0] || new MediaStream([event.track]);
      };
      const receiveFrame = frame => {
        if ((frame.type === "screen-low" || frame.type === "screen-high") && session.screenSender) {
          const parameters=session.screenSender.getParameters();(parameters.encodings||[]).forEach(encoding=>encoding.active=frame.type==="screen-high"||encoding.rid==="q"||!encoding.rid);session.screenSender.setParameters(parameters).catch(()=>{});
        } else if (frame.type === "screen-rejected") {
          stopScreen(session); status.textContent = "Someone else is already sharing their screen.";
        } else if(frame.type === "video-stopped") {
          for(const video of session.remoteVideos.values())if(video.dataset.memberId===frame.member_id){video.dataset.stopped="true";video.remove()}
          document.querySelector(`[data-media-stage-grid] [data-stage-key="participant:${CSS.escape(frame.member_id)}"]`)?.classList.remove("expanded");
          renderStage();
        } else if(frame.type === "video-started") {
          for(const video of session.remoteVideos.values())if(video.dataset.memberId===frame.member_id){video.dataset.stopped="false";video.play().catch(()=>{})}
          renderStage();
        } else if(frame.type === "soundboard-played" && frame.sound) playSound(frame.sound);
      };
      const connectionState = (state, error) => {
        if (active !== session) return;
        retry.hidden = state !== "failed";
        panel.classList.toggle("error", state === "failed");
        if (state === "connecting") { status.textContent = "Voice Connecting"; setPending(session, "Connecting"); }
        if (state === "recovering") {
          status.textContent = "Reconnecting voice"; setPending(session, "Reconnecting");
          if (session.screenStream) {
            session.screenStream.getTracks().forEach(track => {track.onended=null;track.stop()});
            session.screenStream=null;session.screenSenders=[];session.screenSender=null;screen.classList.remove("active");renderStage();
          }
        }
        if (state === "connected") {
          status.textContent = "Voice Connected"; window.allchatActiveVoiceRoom=roomID;
          mute.disabled = screen.disabled = soundboard.disabled = false;
          window.allchatVoicePending?.delete(roomID);document.dispatchEvent(new CustomEvent("allchat:voice-pending"));
        }
        if (state === "failed") {
          status.textContent = error?.message || "Voice connection failed";
          mute.disabled = screen.disabled = soundboard.disabled = true;
          if(window.allchatActiveVoiceRoom===roomID)window.allchatActiveVoiceRoom="";
          setPending(session, "Connection failed");
        }
      };
      const connectionProgress = message => { if(active===session && session.connection?.state!=="connected"){status.textContent=message;setPending(session,message.replace(/…$/, ""));} };
      const recordDiagnostics = sample => {
		const audio=[...session.remoteAudios.entries()].map(([track,element])=>({track_id:track.id,track_state:track.readyState,track_muted:track.muted,element_paused:element.paused,element_ready_state:element.readyState,element_current_time:element.currentTime}));
		const value={...sample,audio};let history=[];try{history=JSON.parse(localStorage.getItem("allchat:voice-diagnostics")||"[]")}catch(_){history=[]}
		history.push(value);if(history.length>600)history=history.slice(-600);try{localStorage.setItem("allchat:voice-diagnostics",JSON.stringify(history))}catch(_){}
	  };
	  window.allchatVoiceDiagnostics=()=>{try{return JSON.parse(localStorage.getItem("allchat:voice-diagnostics")||"[]")}catch(_){return[]}};
	  window.allchatClearVoiceDiagnostics=()=>localStorage.removeItem("allchat:voice-diagnostics");
      session.connection = new window.AllChatVoiceConnection({roomID,stream:session.stream,resumeToken:sessionStorage.getItem(resumeKey)||"",onState:connectionState,onProgress:connectionProgress,onTrack:receiveTrack,onFrame:receiveFrame,onDiagnostics:recordDiagnostics,onResumeToken:token=>sessionStorage.setItem(resumeKey,token)});
      await session.connection.start();
    } catch (error) {
      if (active === session) {
        session.stream?.getTracks().forEach(track => track.stop());
        status.textContent = error?.message || "Could not join voice";
        panel.classList.add("error");
		setPending(session, "Connection failed");
      }
    }
  };

  document.addEventListener("click", event => {
    const link = event.target.closest("a.voice-link");
    if (!link) return;
    event.preventDefault();
    const roomID = new URL(link.href, location.href).pathname.split("/").pop();
    if (active?.roomID === roomID) {
      window.allchatNavigate?.(link.href).catch(() => location.assign(link.href));
      return;
    }
    connect(roomID, link.textContent.trim(), link);
  });
  document.addEventListener("allchat:view-swapped", () => renderStage());
  setInterval(renderStage,1000);
  document.addEventListener("visibilitychange",()=>active?.connection?.send("screen-visibility",{visible:!document.hidden}));
  addEventListener("pagehide", () => disconnect({explicit: false}));
})();
