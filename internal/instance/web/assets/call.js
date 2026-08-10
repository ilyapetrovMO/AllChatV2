(() => {
  "use strict";
  if (window.__allchatCallRuntime) return;
  window.__allchatCallRuntime = true;

  let call = null, peer = null, socket = null, microphone = null, screenStream = null;
  let startButton = null, pollBusy = false, notifiedCallID = "", generation = 0;
  let mediaConfig = {audio_bitrate: 64000, screen_bitrate: 2500000};
  const panel = document.createElement("section");
  panel.className = "call-banner";
  panel.hidden = true;

  const csrf = () => document.querySelector('[name="csrf_token"]')?.value || document.cookie.split("; ").find(value => value.startsWith("allchat_csrf="))?.split("=").slice(1).join("=") || "";
  const request = (url, method = "GET") => fetch(url, {method, headers: {"X-CSRF-Token": decodeURIComponent(csrf())}});
  const isDMView = () => document.querySelector(".channel-topic")?.textContent.trim() === "Direct Message";
  const currentDM = () => isDMView() ? document.body.dataset.channelId : "";
  const attachPanel = () => {
    const conversation = document.querySelector(".conversation-layout"), content = document.querySelector(".content-shell");
    if (conversation) conversation.before(panel); else if (content && call) {const header=content.querySelector(":scope > .content-header"); header ? header.after(panel) : content.prepend(panel);}
  };

  const installView = () => {
    startButton?.remove(); startButton = null;
    if (isDMView()) {
      const actions = document.querySelector(".header-actions");
      if (actions) {
        startButton = document.createElement("button");
        startButton.type = "button"; startButton.className = "button-ghost dm-call-button";
        startButton.textContent = "Start Call"; startButton.title = "Start one-to-one Call";
        startButton.onclick = startCall; actions.prepend(startButton);
      }
    }
    attachPanel();
    if (startButton) startButton.disabled = !!call;
  };

  const cleanupMedia = () => {
    generation++;
    socket?.close(); socket = null;
    peer?.close(); peer = null;
    microphone?.getTracks().forEach(track => track.stop()); microphone = null;
    screenStream?.getTracks().forEach(track => track.stop()); screenStream = null;
    panel.querySelectorAll("audio,video").forEach(media => media.remove());
  };

  const endCall = async () => {
    if (call) await request(`/api/v1/calls/${call.id}/end`, "POST");
    cleanupMedia(); call = null; panel.hidden = true; installView();
  };

  const renderConnected = () => {
    panel.hidden = false; panel.replaceChildren();
    const label = document.createElement("strong"), controls = document.createElement("div"), media = document.createElement("div");
    const mute = document.createElement("button"), screen = document.createElement("button"), end = document.createElement("button");
    label.textContent = "Direct Call connected"; controls.className = "call-controls"; media.className = "call-media";
    mute.textContent = "Mute"; screen.textContent = "Share Screen"; end.textContent = "End Call";
    mute.className = screen.className = "button-secondary"; end.className = "button-danger";
    mute.onclick = () => {const track = microphone?.getAudioTracks()[0]; if (track) {track.enabled = !track.enabled; mute.textContent = track.enabled ? "Mute" : "Unmute";}};
    screen.onclick = () => toggleScreen(screen);
    end.onclick = endCall;
    controls.append(mute, screen, end); panel.append(label, controls, media); attachPanel();
  };

  const addRemoteMedia = event => {
    const mediaHost = panel.querySelector(".call-media") || panel;
    const element = document.createElement(event.track.kind === "video" ? "video" : "audio");
    element.autoplay = true; element.playsInline = true;
    if (event.track.kind === "video") element.className = "shared-screen";
    element.srcObject = event.streams[0] || new MediaStream([event.track]); mediaHost.append(element);
    event.track.addEventListener("ended", () => element.remove());
  };

  const connect = async activeCall => {
    if (peer) return;
    const run = ++generation;
    panel.hidden = false; panel.textContent = "Connecting Direct Call…"; attachPanel();
    const [stream, ice, config] = await Promise.all([
      navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}, video: false}),
      fetch("/api/v1/turn-credentials").then(response => response.ok ? response.json() : {ice_servers: []}),
      fetch("/api/v1/media/config").then(response => response.ok ? response.json() : mediaConfig)
    ]);
    if (run !== generation) return stream.getTracks().forEach(track => track.stop());
    microphone = stream; mediaConfig = config;
    peer = new RTCPeerConnection({iceServers: ice.ice_servers || []});
    const outgoing = [], incoming = [];
    peer.onicecandidate = event => {if (!event.candidate) return; const value = JSON.stringify({version: 1, type: "candidate", candidate: event.candidate.toJSON()}); socket?.readyState === WebSocket.OPEN ? socket.send(value) : outgoing.push(value);};
    peer.ontrack = addRemoteMedia;
    stream.getTracks().forEach(track => peer.addTrack(track, stream)); peer.addTransceiver("audio", {direction: "sendrecv"});
    const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
    socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/v1/media`);
    socket.onopen = () => {socket.send(JSON.stringify({version: 1, type: "join", room_id: activeCall.id, sdp: peer.localDescription})); outgoing.splice(0).forEach(value => socket.send(value));};
    socket.onmessage = async event => {
      const frame = JSON.parse(event.data);
      if (frame.type === "answer") {await peer.setRemoteDescription(frame.sdp); for (const candidate of incoming.splice(0)) await peer.addIceCandidate(candidate); renderConnected();}
      else if (frame.type === "candidate" && frame.candidate) {peer.remoteDescription ? await peer.addIceCandidate(frame.candidate) : incoming.push(frame.candidate);}
      else if (frame.type === "offer") {await peer.setRemoteDescription(frame.sdp); const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); socket.send(JSON.stringify({version: 1, type: "answer", sdp: peer.localDescription}));}
      else if (frame.type === "error") {panel.textContent = frame.error || "Direct Call failed";}
    };
    socket.onclose = () => {if (run === generation && call) panel.textContent = "Direct Call disconnected";};
  };

  const renegotiate = async () => {if (!peer || socket?.readyState !== WebSocket.OPEN) return; const offer = await peer.createOffer(); await peer.setLocalDescription(offer); socket.send(JSON.stringify({version: 1, type: "offer", sdp: peer.localDescription}));};
  const toggleScreen = async button => {
    if (screenStream) {screenStream.getTracks().forEach(track => track.stop()); screenStream = null; button.textContent = "Share Screen"; return;}
    screenStream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true});
    const tracks = screenStream.getTracks(), senders = tracks.map(track => peer.addTrack(track, screenStream));
    button.textContent = "Stop Sharing";
    const stop = async () => {senders.forEach(sender => {try {peer.removeTrack(sender);} catch (_) {}}); screenStream = null; button.textContent = "Share Screen"; await renegotiate();};
    tracks.forEach(track => track.addEventListener("ended", () => {if (screenStream) stop();}, {once: true})); await renegotiate();
  };

  const render = next => {
    call = next; installView();
    if (!next) {if (!peer) panel.hidden = true; return;}
    panel.hidden = false; attachPanel();
    if (next.state === "accepted") {connect(next).catch(error => panel.textContent = error.message || "Direct Call failed"); return;}
    if (next.state !== "ringing") {cleanupMedia(); panel.textContent = `Direct Call ${next.state}`; return;}
    panel.replaceChildren();
    const label = document.createElement("strong"); label.textContent = next.recipient_id === document.body.dataset.memberId ? "Incoming Direct Call" : "Calling… Waiting for an answer."; panel.append(label);
    if (next.recipient_id === document.body.dataset.memberId) {
      const accept = document.createElement("button"), decline = document.createElement("button"); accept.textContent = "Accept"; decline.textContent = "Decline"; decline.className = "button-danger";
      accept.onclick = async () => {const response = await request(`/api/v1/calls/${next.id}/accept`, "POST"); if (response.ok) render(await response.json());};
      decline.onclick = async () => {await request(`/api/v1/calls/${next.id}/decline`, "POST"); cleanupMedia(); call = null; panel.hidden = true; installView();};
      panel.append(accept, decline);
      if (notifiedCallID !== next.id && document.hidden && Notification.permission === "granted") {const notice = new Notification("Incoming AllChat Call", {body: "Open AllChat to accept or decline.", tag: "allchat-call"}); notice.onclick = () => {window.focus(); window.allchatNavigate?.(`/channels/${next.direct_message_id}`);}; notifiedCallID = next.id;}
    } else {const cancel = document.createElement("button"); cancel.textContent = "Cancel"; cancel.className = "button-danger"; cancel.onclick = endCall; panel.append(cancel);}
  };

  async function startCall() {
    const dm = currentDM(); if (!dm) return;
    const response = await request(`/api/v1/dms/${dm}/calls`, "POST");
    if (response.ok) render(await response.json()); else if (response.status === 409) alert("One of you is already in another Call.");
  }
  const poll = async () => {if (pollBusy) return; pollBusy = true; try {const response = await request("/api/v1/calls/current"); if (response.status === 204) {if (call) {cleanupMedia(); call = null; panel.hidden = true; installView();} return;} if (response.ok) {const next = await response.json(); if (!call || call.id !== next.id || call.state !== next.state) render(next);}} finally {pollBusy = false;}};

  installView(); poll(); setInterval(poll, 1000);
  document.addEventListener("allchat:view-swapped", installView);
  addEventListener("pagehide", () => cleanupMedia());
})();
