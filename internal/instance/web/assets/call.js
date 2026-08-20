(() => {
  "use strict";
  if (window.__allchatCallRuntime) return;
  window.__allchatCallRuntime = true;

  let call = null, connection = null, microphone = null, microphoneCapture = null, screenStream = null;
  let localScreenVideo = null, screenSender = null;
  let startButton = null, pollBusy = false, notifiedCallID = "", generation = 0, mediaPreparation = null;
  let ringContext = null, ringTimer = null, ringAudio = null, ringAudioURL = "", ringGeneration = 0;
  let mediaConfig = {audio_bitrate: 64000, screen_bitrate: 2500000};
  const remoteAudio = new Map(), remoteVideo = new Map();
  const panel = document.createElement("section");
  panel.className = "call-banner";
  panel.hidden = true;

  const csrf = () => document.querySelector('[name="csrf_token"]')?.value || document.cookie.split("; ").find(value => value.startsWith("allchat_csrf="))?.split("=").slice(1).join("=") || "";
  const request = (url, method = "GET") => fetch(url, {method, headers: {"X-CSRF-Token": decodeURIComponent(csrf())}});
  const isDMView = () => document.querySelector(".channel-topic")?.textContent.trim() === "Direct Message";
  const currentDM = () => isDMView() ? document.body.dataset.channelId : "";
  const resumeKey = id => `allchat-media-resume:${id}`;
  const ringPulse = async () => {
    try {
      ringContext ||= new AudioContext(); await ringContext.resume();
      const now=ringContext.currentTime;
      [523.25,659.25].forEach((frequency,index)=>{const oscillator=ringContext.createOscillator(),gain=ringContext.createGain(),start=now+index*.12;oscillator.frequency.value=frequency;gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.075,start+.02);gain.gain.exponentialRampToValueAtTime(.0001,start+.24);oscillator.connect(gain).connect(ringContext.destination);oscillator.start(start);oscillator.stop(start+.25);});
    } catch (_) {}
  };
  const stopRinging = () => { ringGeneration++;if(ringTimer)clearInterval(ringTimer);ringTimer=null;ringAudio?.pause();ringAudio=null;if(ringAudioURL)URL.revokeObjectURL(ringAudioURL);ringAudioURL=""; };
  const startRinging = async () => { if(ringTimer||ringAudio)return;const run=++ringGeneration;try{const response=await fetch("/api/v1/ringtone",{cache:"no-store"});if(run!==ringGeneration)return;if(response.ok&&response.status!==204){ringAudioURL=URL.createObjectURL(await response.blob());ringAudio=new Audio(ringAudioURL);ringAudio.loop=true;await ringAudio.play();return}}catch(_){}if(run!==ringGeneration)return;ringPulse();ringTimer=setInterval(ringPulse,2200); };
  addEventListener("pointerdown",()=>{try{ringContext ||= new AudioContext();ringContext.resume().catch(()=>{});}catch(_){}},{once:true});

  const attachPanel = () => {
    if (document.querySelector(".direct-call-workspace")) return;
    const conversation = document.querySelector(".conversation-layout"), content = document.querySelector(".content-shell");
    if (conversation) conversation.before(panel);
    else if (content && call) {
      const header = content.querySelector(":scope > .content-header");
      header ? header.after(panel) : content.prepend(panel);
    }
  };

  const installView = () => {
    startButton?.remove(); startButton = null;
    if (isDMView()) {
      const actions = document.querySelector(".header-actions");
      if (actions) {
        startButton = document.createElement("button");
        startButton.type = "button"; startButton.className = "button-ghost dm-call-button";
        startButton.textContent = "Start Call"; startButton.title = "Start Direct Call";
        startButton.onclick = startCall; actions.prepend(startButton);
      }
    }
    if (call?.state === "accepted" && connection?.state === "connected" && currentDM() === call.direct_message_id) renderConnectedView();
    else attachPanel();
    if (startButton) startButton.disabled = !!call;
  };

  const restoreConversation = () => {
    const workspace = document.querySelector(".direct-call-workspace");
    if (!workspace) return;
    const content = workspace.closest(".content-shell"), header = content?.querySelector(":scope > .content-header");
    const chat = workspace.querySelector(".direct-call-chat");
    const conversation = chat?.querySelector(":scope > .conversation-layout");
    const composer = chat?.querySelector(":scope > .composer-wrap");
    if (conversation) header?.after(conversation);
    if (composer) content?.append(composer);
    workspace.remove(); content?.classList.remove("direct-call-active");
  };

  const mediaGrid = () => document.querySelector(".direct-call-workspace [data-media-stage-grid]");
  const participantTile = (memberID, label, image, video) => {
    const tile = document.createElement("article"), visual = document.createElement("div"), name = document.createElement("strong");
    tile.className = `media-stage-tile participant-tile${video ? " sharing" : ""}`; visual.className = "media-stage-visual"; name.textContent = label;
    if(memberID&&memberID!==document.body.dataset.memberId)tile.oncontextmenu=event=>{event.preventDefault();window.AllChatVoiceSettings?.openParticipantVolumeMenu({memberID,label,x:event.clientX,y:event.clientY})};
    if (video) {
      visual.append(video);
      const badge = document.createElement("span"); badge.className = "screen-sharing-badge"; badge.textContent = "Sharing screen"; tile.append(visual, name, badge);
    } else {
      const avatar = document.createElement(image ? "img" : "span");
      if (image) {avatar.src = image; avatar.alt = "";} else {avatar.className = "media-stage-avatar-fallback";avatar.textContent = Array.from(label || "?")[0].toUpperCase();}
      visual.append(avatar); tile.append(visual, name);
    }
    return tile;
  };
  const renderMedia = () => {
    const grid = mediaGrid(); if (!grid) return;
    const summary = document.querySelector(".member-summary"), other = document.querySelector(".dm-profile-card"), videos = [...remoteVideo.values()].filter(video => video.dataset.stopped !== "true");
    const ownName = summary?.querySelector("strong")?.textContent.trim() || "You", ownImage = summary?.querySelector("img")?.src || "";
    const otherName = other?.querySelector("h2")?.textContent.trim() || "Other Member", otherImage = other?.querySelector("img")?.src || "";
    const remoteMemberID=call?.caller_id===document.body.dataset.memberId?call?.recipient_id:call?.caller_id;
    grid.replaceChildren(participantTile(document.body.dataset.memberId,ownName === "You" ? ownName : `${ownName} (You)`, ownImage, localScreenVideo), participantTile(remoteMemberID,otherName, otherImage, videos[0]));
    for (const video of videos.slice(1)) grid.append(participantTile(video.dataset.memberId||remoteMemberID,"Shared screen", "", video));
    grid.dataset.tileCount = String(grid.children.length);
  };

  const stopScreen = async ({renegotiate = true} = {}) => {
    const stream = screenStream; screenStream = null;
    screenSender = null;
    localScreenVideo?.remove(); localScreenVideo = null;
    stream?.getTracks().forEach(track => {track.onended = null; track.stop();});
    for (const sender of stream?.__allchatSenders || []) { try { connection?.removeTrack(sender); } catch (_) {} }
    document.querySelector("[data-call-screen]")?.classList.remove("active");
    renderMedia();
    if (renegotiate && connection && !connection.stopped) await connection.clearVideoTrack();
  };

  const toggleScreen = async button => {
    if (screenStream) return stopScreen();
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen sharing is unavailable on this browser.");
    const stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true});
    const videoTrack = stream.getVideoTracks()[0], senders = [];
    stream.getAudioTracks().forEach(track => senders.push(connection.addTrack(track, stream)));
    const sender = await connection.setVideoTrack(videoTrack, stream, {sendEncodings: [
        {rid: "q", scaleResolutionDownBy: 4, maxBitrate: Math.min(250000, mediaConfig.screen_bitrate)},
        {rid: "h", scaleResolutionDownBy: 2, maxBitrate: Math.min(750000, mediaConfig.screen_bitrate)},
        {rid: "f", maxBitrate: mediaConfig.screen_bitrate},
      ]});
    screenSender = sender;
    stream.__allchatSenders = senders; screenStream = stream; button.classList.add("active");
    localScreenVideo = document.createElement("video"); localScreenVideo.autoplay = true; localScreenVideo.muted = true; localScreenVideo.playsInline = true; localScreenVideo.className = "shared-screen"; localScreenVideo.srcObject = stream; renderMedia();
    videoTrack.onended = () => stopScreen().catch(() => {});
  };

  const renderConnectedView = () => {
    if (!isDMView() || currentDM() !== call?.direct_message_id) return attachPanel();
    panel.hidden = true; restoreConversation();
    const content = document.querySelector(".content-shell"), header = content?.querySelector(":scope > .content-header");
    const conversation = content?.querySelector(":scope > .conversation-layout"), composer = content?.querySelector(":scope > .composer-wrap");
    if (!content || !header || !conversation || !composer) return;
    content.classList.add("direct-call-active");
    const workspace = document.createElement("section"), stage = document.createElement("div"), toolbar = document.createElement("header"), grid = document.createElement("div"), chat = document.createElement("div");
    workspace.className = "direct-call-workspace"; stage.className = "direct-call-stage media-stage";
    toolbar.className = "direct-call-toolbar"; grid.className = "media-stage-grid"; grid.dataset.mediaStageGrid = "";
    chat.className = "direct-call-chat";
    toolbar.innerHTML = '<strong data-call-status>Direct Call connected</strong><div class="call-controls"><button type="button" class="button-secondary" data-call-mute>Mute</button><button type="button" class="button-secondary" data-call-screen>Share Screen</button><button type="button" class="button-danger" data-call-end>End Call</button></div>';
    toolbar.querySelector("[data-call-mute]").onclick = event => {const track = microphone?.getAudioTracks()[0];if(track){track.enabled=!track.enabled;event.currentTarget.textContent=track.enabled?"Mute":"Unmute";}};
    toolbar.querySelector("[data-call-screen]").onclick = event => toggleScreen(event.currentTarget).catch(error => {toolbar.querySelector("[data-call-status]").textContent=error?.message||"Screen sharing failed";});
    toolbar.querySelector("[data-call-end]").onclick = endCall;
    stage.append(toolbar, grid); chat.append(conversation, composer); workspace.append(stage, chat); header.after(workspace);
    renderMedia();
  };

  const clearRemoteMedia = () => {
    remoteAudio.forEach(element => element.remove()); remoteAudio.clear();
    remoteVideo.forEach(element => element.remove()); remoteVideo.clear();
  };

  const clearRemoteVideo = () => {
    remoteVideo.forEach(element => element.remove()); remoteVideo.clear(); renderMedia();
  };

  const cleanupMedia = ({explicit = false} = {}) => {
    stopRinging();
    generation++;
    connection?.stop({explicit}); connection = null;
    microphoneCapture?.stop?.(); microphoneCapture = null; microphone?.getTracks().forEach(track => track.stop()); microphone = null;
    stopScreen({renegotiate: false}).catch(() => {});
    clearRemoteMedia(); restoreConversation();
  };

  const endCall = async () => {
    if (call) await request(`/api/v1/calls/${call.id}/end`, "POST");
    cleanupMedia({explicit: true});
    if (call) sessionStorage.removeItem(resumeKey(call.id));
    call = null; panel.hidden = true; installView();
  };

  const receiveTrack = event => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    if (event.track.kind === "video") {
      const video = document.createElement("video");
      video.autoplay = true; video.playsInline = true; video.className = "shared-screen"; video.srcObject = stream;
      video.dataset.memberId=window.allchatMediaOwnerID?.(event.track.id,stream.id)||"";
      const id=event.track.id||crypto.randomUUID(),remove=()=>{if(remoteVideo.get(id)===video)remoteVideo.delete(id);video.remove();renderMedia()},publish=()=>{
        // A Direct Call has one remote Member and one active video source.
        for(const old of remoteVideo.values())old.remove();remoteVideo.clear();remoteVideo.set(id,video);renderMedia();video.play().catch(()=>{});
      };
      event.track.addEventListener("ended",remove);event.track.addEventListener("mute",remove);event.track.addEventListener("unmute",publish);
      if(!event.track.muted)publish();return;
    }
    const memberID=window.allchatMediaOwnerID?.(event.track.id,stream.id)||(call?.caller_id===document.body.dataset.memberId?call?.recipient_id:call?.caller_id)||"";const audio = document.createElement("audio"); audio.autoplay = true; audio.srcObject = stream;audio.dataset.memberId=memberID;window.AllChatVoiceSettings?.applyOutput(audio,memberID);
    remoteAudio.set(event.track, audio); document.body.append(audio);
    audio.play().catch(() => {});
    event.track.addEventListener("ended", () => {remoteAudio.delete(event.track);audio.remove();});
  };
  addEventListener("allchat:voice-settings",()=>remoteAudio.forEach(audio=>window.AllChatVoiceSettings?.applyOutput(audio,audio.dataset.memberId||"")));

  const connect = async activeCall => {
    if (connection) return;
    const run = ++generation;
    panel.hidden = false; panel.textContent = "Connecting Direct Call…"; attachPanel();
    await prepareMedia(run);
    if (run !== generation) return;
    const key = resumeKey(activeCall.id);
    const stateChanged = (state, error) => {
      if (run !== generation || !call) return;
      if (state === "connected") renderConnectedView();
      if (state === "recovering") {
        document.querySelector("[data-call-status]")?.replaceChildren("Reconnecting Direct Call…");
        stopScreen({renegotiate: false}).catch(() => {});
      }
      if (state === "failed") {
        restoreConversation(); panel.hidden = false; panel.textContent = error?.message || "Direct Call failed"; attachPanel();
      }
    };
    const receiveFrame = frame => {
      if ((frame.type === "screen-low" || frame.type === "screen-high") && screenSender) {
        const parameters = screenSender.getParameters();
        (parameters.encodings || []).forEach(encoding => {encoding.active = frame.type === "screen-high" || encoding.rid === "q" || !encoding.rid;});
        screenSender.setParameters(parameters).catch(() => {});
      } else if (frame.type === "screen-rejected") {
        stopScreen().catch(() => {});
        const status = document.querySelector("[data-call-status]"); if (status) status.textContent = "The other Member is already sharing their screen.";
      } else if (frame.type === "video-stopped") {
        for (const video of remoteVideo.values()) { video.dataset.stopped = "true"; video.remove(); }
        renderMedia();
      } else if (frame.type === "video-started") {
        for (const video of remoteVideo.values()) { video.dataset.stopped = "false"; video.play().catch(() => {}); }
        renderMedia();
      }
    };
    const progress = message => { if (!connection || connection.state !== "connected") { panel.hidden=false;panel.innerHTML='<span class="call-progress"></span>';panel.firstElementChild.textContent=message;attachPanel(); } };
    connection = new window.AllChatVoiceConnection({roomID: activeCall.id, stream: microphone, resumeToken: sessionStorage.getItem(key) || "", onState: stateChanged, onProgress: progress, onTrack: receiveTrack, onFrame: receiveFrame, onResumeToken: token => sessionStorage.setItem(key, token)});
    await connection.start();
  };

  const prepareMedia = async expectedGeneration => {
    if (microphone) return;
    if (!mediaPreparation) {
      mediaPreparation = (async () => {
        panel.hidden=false;panel.innerHTML='<span class="call-progress">Requesting microphone permission…</span>';attachPanel();
        if (!window.AllChatRNNoise) await import("/assets/rnnoise.js");
        if (!window.AllChatVoiceSettings) await import("/assets/voice-settings.js");
        if (!window.AllChatVoiceConnection) await import("/assets/voice-connection.js");
        const [capture, config] = await Promise.all([
          window.AllChatVoiceSettings.capture(),
          fetch("/api/v1/media/config").then(response => response.ok ? response.json() : mediaConfig),
        ]);
        if (expectedGeneration !== generation) { capture.stop(); throw new Error("Direct Call preparation cancelled"); }
        microphoneCapture=capture;microphone=capture.stream;mediaConfig=config;
      })().finally(() => { mediaPreparation=null; });
    }
    await mediaPreparation;
  };

  const render = next => {
    call = next; installView();
    const incoming=next?.state==="ringing"&&next.recipient_id===document.body.dataset.memberId;
    if(incoming)startRinging();else stopRinging();
    if (!next) {if (!connection) panel.hidden = true; return;}
    panel.hidden = false; attachPanel();
    if (next.state === "accepted") {(async()=>{if(currentDM()!==next.direct_message_id){const target=`/channels/${next.direct_message_id}`;if(!window.allchatNavigate){location.assign(target);return}await window.allchatNavigate(target)}await connect(next)})().catch(error => {panel.hidden=false;panel.textContent=error.message||"Direct Call failed";attachPanel();});return;}
    if (next.state !== "ringing") {cleanupMedia();panel.textContent=`Direct Call ${next.state}`;return;}
    panel.replaceChildren();
    const label = document.createElement("strong"); label.textContent = incoming ? "Incoming Direct Call" : "Calling… Waiting for an answer."; panel.append(label);
    if (incoming) {
      const accept=document.createElement("button"),decline=document.createElement("button");accept.textContent="Accept";decline.textContent="Decline";decline.className="button-danger";
      accept.onclick=async()=>{const response=await request(`/api/v1/calls/${next.id}/accept`,"POST");if(response.ok)render(await response.json());};
      decline.onclick=async()=>{await request(`/api/v1/calls/${next.id}/decline`,"POST");cleanupMedia({explicit:true});call=null;panel.hidden=true;installView();};panel.append(accept,decline);
      if(notifiedCallID!==next.id&&document.hidden&&Notification.permission==="granted"){const notice=new Notification("Incoming AllChat Call",{body:"Open AllChat to accept or decline.",tag:"allchat-call"});notice.onclick=()=>{window.focus();window.allchatNavigate?.(`/channels/${next.direct_message_id}`);};notifiedCallID=next.id;}
    } else {const cancel=document.createElement("button");cancel.textContent="Cancel";cancel.className="button-danger";cancel.onclick=endCall;panel.append(cancel);}
  };

  async function startCall(){const dm=currentDM();if(!dm)return;try{await prepareMedia(generation);const response=await request(`/api/v1/dms/${dm}/calls`,"POST");if(response.ok)render(await response.json());else{cleanupMedia({explicit:true});if(response.status===409)alert("One of you is already in another Call.");}}catch(error){cleanupMedia();panel.hidden=false;panel.textContent=error?.message||"Could not prepare Direct Call";attachPanel();}}
  const poll=async()=>{if(pollBusy)return;pollBusy=true;try{const response=await request("/api/v1/calls/current");if(response.status===204){if(call){cleanupMedia();call=null;panel.hidden=true;installView();}return;}if(response.ok){const next=await response.json();if(!call||call.id!==next.id||call.state!==next.state)render(next);}}finally{pollBusy=false;}};

  installView(); poll(); setInterval(poll,1000);
  document.addEventListener("allchat:view-swapped",installView);
  addEventListener("pagehide",()=>{stopRinging();cleanupMedia()});
})();
