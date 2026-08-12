(() => {
  "use strict";

  class VoiceConnection {
    constructor(options) {
      this.options = options;
      this.roomID = options.roomID;
      this.stream = options.stream;
      this.onState = options.onState || (() => {});
      this.onTrack = options.onTrack || (() => {});
      this.onFrame = options.onFrame || (() => {});
      this.onProgress = options.onProgress || (() => {});
      this.onResumeToken = options.onResumeToken || (() => {});
	  this.onDiagnostics = options.onDiagnostics || (() => {});
      this.fetchCredentials = options.fetchCredentials || (async () => {
        const response = await fetch("/api/v1/turn-credentials");
        if (!response.ok) throw new Error("TURN credentials unavailable");
        return (await response.json()).ice_servers || [];
      });
      this.createPeer = options.createPeer || (configuration => new RTCPeerConnection(configuration));
      this.createSocket = options.createSocket || (() => new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/v1/media`));
      this.recoveryDelays = options.recoveryDelays || [500, 1000, 2000, 4000];
      this.recoveryTimeout = options.recoveryTimeout || 30000;
      this.heartbeatInterval = options.heartbeatInterval || 10000;
      this.heartbeatTimeout = options.heartbeatTimeout || 25000;
      this.iceGracePeriod = options.iceGracePeriod || 5000;
	  this.diagnosticsInterval = options.diagnosticsInterval || 1000;
      this.resumeToken = options.resumeToken || "";
      this.generation = 0;
      this.state = "idle";
      this.stopped = true;
      this.recovering = false;
      this.heartbeat = null;
      this.iceTimer = null;
      this.lastHeartbeatAck = 0;
	  this.diagnosticsTimer = null;
    }

    async start() {
      if (!this.stopped) return;
      this.stopped = false;
      this._state("connecting");
      try {
        await this._connect(this.resumeToken);
      } catch (error) {
        if (!this.stopped) await this._recover(error);
      }
    }

    stop({explicit = false} = {}) {
      if (explicit && this.socket?.readyState === 1) this._send({type: "leave"});
      this._terminate("idle");
    }

    send(type, fields = {}) { return this._send({type, ...fields}); }
    addTrack(track, stream) { return this.peer?.addTrack(track, stream); }
    addTransceiver(...arguments_) { return this.peer?.addTransceiver(...arguments_); }
    removeTrack(sender) { if (this.peer && sender) this.peer.removeTrack(sender); }

    async renegotiate({iceRestart = false} = {}) {
      if (!this.peer || this.socket?.readyState !== 1) throw new Error("Voice signaling is unavailable");
      if (iceRestart) this.peer.restartIce?.();
      const offer = await this.peer.createOffer(iceRestart ? {iceRestart: true} : undefined);
      await this.peer.setLocalDescription(offer);
      await this._waitForGathering(this.peer);
      this._send({type: "offer", sdp: this.peer.localDescription});
    }

    async _connect(resumeToken, takeover = false) {
      const generation = ++this.generation;
      clearInterval(this.heartbeat);
      clearTimeout(this.iceTimer);
	  clearInterval(this.diagnosticsTimer);
      this.socket?.close();
      this.peer?.close();
      this.onProgress("Fetching relay configuration…");
      const iceServers = await this.fetchCredentials();
      if (this.stopped || generation !== this.generation) throw new Error("Voice connection cancelled");
      this.onProgress("Preparing encrypted media…");
      const peer = this.createPeer({iceServers});
      this.peer = peer;
      const pendingLocal = [], pendingRemote = [];
      for (const track of this.stream.getTracks()) peer.addTrack(track, this.stream);
      peer.addTransceiver("audio", {direction: "sendrecv"});
      peer.ontrack = event => this.onTrack(event);
      peer.onicecandidate = event => {
        if (!event.candidate) return;
        const frame = {type: "candidate", candidate: event.candidate.toJSON()};
        if (this.socket?.readyState === 1) this._send(frame); else pendingLocal.push(frame);
      };
      peer.onconnectionstatechange = () => this._peerState(peer, generation);
      peer.oniceconnectionstatechange = () => this._peerState(peer, generation);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const socket = this.createSocket();
      this.socket = socket;
      this.onProgress("Opening media signaling…");
      return new Promise((resolve, reject) => {
        let settled = false;
		let connected = false;
        let frameQueue = Promise.resolve();
        const fail = error => { if (!settled) { settled = true; reject(error); } };
        socket.onopen = () => {
          if (this.stopped || generation !== this.generation) return socket.close();
          this.onProgress("Waiting for the media server…");
          this._send({type: "join", room_id: this.roomID, resume_token: resumeToken, takeover, sdp: peer.localDescription});
          pendingLocal.splice(0).forEach(frame => this._send(frame));
          this.lastHeartbeatAck = Date.now();
          this.heartbeat = setInterval(() => this._heartbeat(socket, generation), this.heartbeatInterval);
        };
        const handleFrame = async frame => {
          if (this.stopped || generation !== this.generation) return;
          if (frame.type === "heartbeat-ack") { this.lastHeartbeatAck = Date.now(); return; }
          if (frame.type === "error") {
            const error = new Error(frame.error || "Voice connection failed");
            error.code = frame.code || "signaling_error";
            fail(error);
            socket.close();
            return;
          }
          if (frame.type === "answer") {
            this.onProgress("Finishing media connection…");
            await peer.setRemoteDescription(frame.sdp);
            for (const candidate of pendingRemote.splice(0)) await peer.addIceCandidate(candidate);
            if (frame.resume_token) {
              this.resumeToken = frame.resume_token;
              this.onResumeToken(frame.resume_token);
            }
			if (!connected) {
			  connected = true;
			  this._state("connected");
			  this._startDiagnostics(peer, generation);
			  this.recovering = false;
			  if (!settled) { settled = true; resolve(); }
			}
            return;
          }
          if (frame.type === "candidate" && frame.candidate) {
            if (peer.remoteDescription) await peer.addIceCandidate(frame.candidate); else pendingRemote.push(frame.candidate);
            return;
          }
          if (frame.type === "offer") {
            await peer.setRemoteDescription(frame.sdp);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            await this._waitForGathering(peer);
            this._send({type: "answer", sdp: peer.localDescription});
            return;
          }
          this.onFrame(frame);
        };
        socket.onmessage = event => {
          const frame = JSON.parse(event.data);
          frameQueue = frameQueue.then(() => handleFrame(frame)).catch(error => {
            fail(error);
            socket.close();
          });
        };
        socket.onerror = () => {
          if (connected) socket.close();
          else fail(new Error("Voice signaling failed"));
        };
        socket.onclose = () => {
          clearInterval(this.heartbeat);
          if (this.stopped || generation !== this.generation) return;
          const error = new Error("Voice signaling closed");
		  if (!connected) fail(error); else this._recover(error);
        };
      });
    }

    async _recover(cause) {
      if (this.stopped || this.recovering) return;
	  if (cause?.code === "moderated") {
		this._terminate("failed", cause);
		return;
	  }
      this.recovering = true;
      this._state("recovering", cause);
      const deadline = Date.now() + this.recoveryTimeout;
      for (let attempt = 0; !this.stopped && Date.now() < deadline; attempt++) {
        const delay = this.recoveryDelays[Math.min(attempt, this.recoveryDelays.length - 1)] || 0;
        if (delay) await new Promise(resolve => setTimeout(resolve, delay + Math.floor(Math.random() * Math.min(250, delay / 4))));
        try {
          await this._connect(this.resumeToken);
          return;
        } catch (error) {
		  if (error.code === "moderated") { cause = error; break; }
          if (error.code === "invalid_resume") {
            this.resumeToken = "";
			try { await this._connect("", true); return; } catch (freshError) {
			  cause = freshError;
			  if (freshError.code === "moderated") break;
			}
		  } else if (error.code === "already_active") {
			try { await this._connect("", true); return; } catch (takeoverError) {
			  cause = takeoverError;
			  if (takeoverError.code === "moderated") break;
			}
          } else cause = error;
        }
      }
      if (!this.stopped) {
        this._terminate("failed", cause);
      }
    }

    _terminate(state, error) {
      this.stopped = true;
      this.recovering = false;
      this.generation++;
      clearInterval(this.heartbeat);
      clearTimeout(this.iceTimer);
	  clearInterval(this.diagnosticsTimer);
      this.socket?.close();
      this.peer?.close();
      this.socket = null;
      this.peer = null;
      if (!this.localMediaReleased) {
        this.localMediaReleased = true;
        this.stream?.getTracks().forEach(track => track.stop?.());
      }
      this._state(state, error);
    }

    _peerState(peer, generation) {
      if (this.stopped || peer !== this.peer || generation !== this.generation) return;
      const state = peer.connectionState || peer.iceConnectionState;
      clearTimeout(this.iceTimer);
      if (state === "connected" || state === "completed") {
        clearTimeout(this.iceTimer);
        if (this.state === "recovering") { this.recovering = false; this._state("connected"); }
        return;
      }
      if (state === "failed") { this._tryIceRestart(generation); return; }
      if (state === "disconnected") this.iceTimer = setTimeout(() => this._tryIceRestart(generation), this.iceGracePeriod);
    }

    async _tryIceRestart(generation) {
      if (this.stopped || generation !== this.generation || this.recovering) return;
      this._state("recovering");
      try {
        await this.renegotiate({iceRestart: true});
        this.iceTimer = setTimeout(() => {
          if (generation === this.generation && this.peer?.connectionState !== "connected") this._recover(new Error("ICE restart timed out"));
        }, this.iceGracePeriod);
      } catch (error) {
        this._recover(error);
      }
    }

    _heartbeat(socket, generation) {
      if (this.stopped || socket !== this.socket || generation !== this.generation || socket.readyState !== 1) return;
      if (Date.now() - this.lastHeartbeatAck > this.heartbeatTimeout) { socket.close(); return; }
      this._send({type: "heartbeat", sent_at: Date.now()});
    }

	_startDiagnostics(peer, generation) {
	  clearInterval(this.diagnosticsTimer);
	  const collect = async () => {
		if (this.stopped || peer !== this.peer || generation !== this.generation || !peer.getStats) return;
		try {
		  const report = await peer.getStats(), inbound={packets:0,bytes:0,lost:0,jitter:0}, outbound={packets:0,bytes:0,discarded:0};
		  report.forEach(item=>{
			if ((item.kind||item.mediaType)!=="audio") return;
			if (item.type==="inbound-rtp") { inbound.packets+=item.packetsReceived||0;inbound.bytes+=item.bytesReceived||0;inbound.lost+=item.packetsLost||0;inbound.jitter=Math.max(inbound.jitter,item.jitter||0); }
			if (item.type==="outbound-rtp") { outbound.packets+=item.packetsSent||0;outbound.bytes+=item.bytesSent||0;outbound.discarded+=item.packetsDiscardedOnSend||0; }
		  });
		  this.onDiagnostics({at:new Date().toISOString(),roomID:this.roomID,state:this.state,peerState:peer.connectionState||"",iceState:peer.iceConnectionState||"",inbound,outbound});
		} catch (_) {}
	  };
	  collect();
	  this.diagnosticsTimer=setInterval(collect,this.diagnosticsInterval);
	}

    _send(frame) {
      if (this.socket?.readyState !== 1) return false;
      this.socket.send(JSON.stringify({version: 1, ...frame}));
      return true;
    }

    _state(state, error) {
      if (this.state === state && !error) return;
      this.state = state;
      this.onState(state, error);
    }

    _waitForGathering(peer) {
      if (!peer.iceGatheringState || peer.iceGatheringState === "complete") return Promise.resolve();
      return new Promise(resolve => {
        const changed = () => {
          if (peer.iceGatheringState !== "complete") return;
          peer.removeEventListener("icegatheringstatechange", changed);
          resolve();
        };
        peer.addEventListener("icegatheringstatechange", changed);
      });
    }
  }

  window.AllChatVoiceConnection = VoiceConnection;
})();
