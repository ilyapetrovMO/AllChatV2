(() => {
  "use strict";
  const roomID = document.body.dataset.channelId;
  const memberID = document.body.dataset.memberId;
	const csrf=decodeURIComponent(document.cookie.split("; ").find(item=>item.startsWith("allchat_csrf="))?.split("=").slice(1).join("=")||"");
  const join = document.getElementById("join-voice");
  const leave = document.getElementById("leave-voice");
  const mute = document.getElementById("mute-voice");
  const status = document.getElementById("voice-status");
  const participantList = document.getElementById("voice-participants");
  const remoteAudio = document.getElementById("remote-audio");
  const resumeKey=`allchat-media-resume:${roomID}`;
  let socket, peer, microphone, microphoneCapture, polling, heartbeat, screenStream, screenSender, canModerate=false, mediaConfig={audio_bitrate:64000,screen_bitrate:2500000};
  fetch("/api/v1/media/config").then(response=>response.json()).then(value=>mediaConfig=value);
  fetch("/api/v1/moderation-records").then(response=>{canModerate=response.ok;refreshParticipants()});
  const screen=document.createElement("button");screen.type="button";screen.className="button-secondary";screen.textContent="Share Screen";screen.disabled=true;mute.after(screen);

  const waitForGathering = connection => connection.iceGatheringState === "complete" ? Promise.resolve() : new Promise(resolve => connection.addEventListener("icegatheringstatechange", () => connection.iceGatheringState === "complete" && resolve()));
  let participantNames={};const renderParticipants = participants => {
    participantList.replaceChildren();
    participants.forEach(participant => {
      const item = document.createElement("li");
      item.textContent = participant.member_id === memberID ? "You" : participantNames[participant.member_id]||"Member";
      if(participant.member_id!==memberID)item.oncontextmenu=event=>{event.preventDefault();window.AllChatVoiceSettings?.openParticipantVolumeMenu({memberID:participant.member_id,label:participantNames[participant.member_id]||"Member",x:event.clientX,y:event.clientY})};
      const state = document.createElement("span");
      state.className = `badge ${participant.connected ? "badge-success" : ""}`;
      state.textContent = participant.connected ? "Connected" : "Reconnecting";
      item.append(state);
	  if(canModerate&&participant.member_id!==memberID){const muteMember=document.createElement("button"),disconnect=document.createElement("button");muteMember.className="button-ghost";muteMember.textContent=participant.server_muted?"Server Unmute":"Server Mute";disconnect.className="button-ghost danger-text";disconnect.textContent="Disconnect";muteMember.onclick=async()=>{const reason=prompt("Reason for this moderation action?");if(!reason)return;const method=participant.server_muted?"DELETE":"PUT";await fetch(`/api/v1/media/rooms/${roomID}/participants/${participant.member_id}/mute`,{method,headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({reason})});refreshParticipants()};disconnect.onclick=async()=>{const reason=prompt("Reason for disconnecting this participant?");if(!reason)return;await fetch(`/api/v1/media/rooms/${roomID}/participants/${participant.member_id}/disconnect`,{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({reason})});refreshParticipants()};item.append(muteMember,disconnect)}
      participantList.append(item);
    });
  };
  const refreshParticipants = async () => {
    const response = await fetch(`/api/v1/voice/${roomID}/participants`);
    if (response.ok) {const state=await response.json();participantNames=state.names||{};renderParticipants(state.participants||[])}
  };
  const stop = () => {
    clearInterval(polling);
	clearInterval(heartbeat);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({version: 1, type: "leave"}));
    socket?.close();
    peer?.close();
    microphoneCapture?.stop?.(); microphoneCapture=null; microphone?.getTracks().forEach(track => track.stop());
    socket = peer = microphone = null;
    remoteAudio.replaceChildren();
    join.disabled = false;
    leave.disabled = mute.disabled = true;
    status.textContent = "Disconnected. Your microphone is off.";
    refreshParticipants();
  };
  join.addEventListener("click", async () => {
    join.disabled = true;
    status.textContent = "Requesting microphone access…";
    try {
      if(!window.AllChatRNNoise)await import("/assets/rnnoise.js");if(!window.AllChatVoiceSettings)await import("/assets/voice-settings.js");microphoneCapture=await window.AllChatVoiceSettings.capture();microphone=microphoneCapture.stream;
	  const ice=await fetch("/api/v1/turn-credentials").then(response=>response.json());
      peer = new RTCPeerConnection({iceServers:ice.ice_servers||[]});
      microphone.getTracks().forEach(track => {const sender=peer.addTrack(track, microphone),parameters=sender.getParameters();parameters.encodings=parameters.encodings?.length?parameters.encodings:[{}];parameters.encodings[0].maxBitrate=mediaConfig.audio_bitrate;sender.setParameters(parameters).catch(()=>{});});
      peer.addTransceiver("audio", {direction: "sendrecv"});
      peer.ontrack = event => {
        const media = document.createElement(event.track.kind === "video" ? "video" : "audio");
        media.autoplay = true;
        if (event.track.kind === "video") { media.className = "shared-screen"; media.playsInline = true; }
        media.srcObject = event.streams[0] || new MediaStream([event.track]);if(event.track.kind==="audio"){const owner=window.allchatMediaOwnerID?.(event.track.id,event.streams[0]?.id)||"";media.dataset.memberId=owner;window.AllChatVoiceSettings.applyOutput(media,owner)}
        (event.track.kind === "video" ? document.querySelector(".voice-stage") : remoteAudio).append(media);
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForGathering(peer);
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${location.host}/api/v1/media`);
      socket.onopen = () => {socket.send(JSON.stringify({version: 1, type: "join", room_id: roomID, resume_token:sessionStorage.getItem(resumeKey)||"", sdp: peer.localDescription}));heartbeat=setInterval(()=>socket?.readyState===WebSocket.OPEN&&socket.send(JSON.stringify({version:1,type:"heartbeat"})),1000)};
      socket.onmessage = async event => {
        const frame = JSON.parse(event.data);
        if (frame.type === "error") throw new Error(frame.error);
        if (frame.type === "answer") {
		  if(frame.resume_token)sessionStorage.setItem(resumeKey,frame.resume_token);
          await peer.setRemoteDescription(frame.sdp);
          renderParticipants(frame.participants || []);
          status.textContent = "Voice Connected";
          leave.disabled = mute.disabled = screen.disabled = false;
          polling = setInterval(refreshParticipants, 1000);
        } else if (frame.type === "offer") {
          await peer.setRemoteDescription(frame.sdp);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await waitForGathering(peer);
          socket.send(JSON.stringify({version: 1, type: "answer", sdp: peer.localDescription}));
		} else if ((frame.type === "screen-low" || frame.type === "screen-medium" || frame.type === "screen-high") && screenSender) {
		  const parameters=screenSender.getParameters(),maximum=frame.type==="screen-low"?0:frame.type==="screen-medium"?1:2;(parameters.encodings||[]).forEach((encoding,index)=>encoding.active=index<=maximum);screenSender.setParameters(parameters).catch(()=>{});
        }
      };
      socket.onclose = () => peer && stop();
    } catch (error) {
      status.textContent = error.message || "Could not join Voice Room.";
      stop();
    }
  });
  mute.addEventListener("click", () => {
    const track = microphone?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    mute.textContent = track.enabled ? "Mute" : "Unmute";
    mute.setAttribute("aria-pressed", String(!track.enabled));
	if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({version:1,type:"mute-state",muted:!track.enabled}));
  });
  screen.addEventListener("click",async()=>{if(screenStream){screenStream.getTracks().forEach(track=>track.stop());return}try{screenStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});const track=screenStream.getVideoTracks()[0],senders=[];let sender;try{sender=peer.addTransceiver(track,{direction:"sendonly",streams:[screenStream],sendEncodings:[{rid:"q",scaleResolutionDownBy:4,maxBitrate:Math.min(250000,mediaConfig.screen_bitrate)},{rid:"h",scaleResolutionDownBy:2,maxBitrate:Math.min(750000,mediaConfig.screen_bitrate)},{rid:"f",scaleResolutionDownBy:1,maxBitrate:mediaConfig.screen_bitrate}]}).sender}catch(_){sender=peer.addTrack(track,screenStream)}screenSender=sender;senders.push(sender);screenStream.getAudioTracks().forEach(audioTrack=>senders.push(peer.addTrack(audioTrack,screenStream)));track.onended=async()=>{senders.forEach(item=>peer.removeTrack(item));screenSender=null;screenStream=null;screen.textContent="Share Screen";const offer=await peer.createOffer();await peer.setLocalDescription(offer);await waitForGathering(peer);socket.send(JSON.stringify({version:1,type:"offer",sdp:peer.localDescription}))};screen.textContent=screenStream.getAudioTracks().length?"Stop Sharing (with audio)":"Stop Sharing";const offer=await peer.createOffer();await peer.setLocalDescription(offer);await waitForGathering(peer);socket.send(JSON.stringify({version:1,type:"offer",sdp:peer.localDescription}))}catch(error){status.textContent=error.message||"Screen sharing is unavailable on this browser or operating system."}});
  document.addEventListener("visibilitychange",()=>socket?.readyState===WebSocket.OPEN&&socket.send(JSON.stringify({version:1,type:"screen-visibility",visible:!document.hidden})));
  leave.addEventListener("click", () => {sessionStorage.removeItem(resumeKey);stop()});
  addEventListener("allchat:voice-settings",()=>remoteAudio.querySelectorAll("audio").forEach(audio=>window.AllChatVoiceSettings.applyOutput(audio,audio.dataset.memberId||"")));
  addEventListener("pagehide", stop);
  refreshParticipants();
})();
