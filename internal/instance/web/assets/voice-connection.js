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
      this.negotiation = Promise.resolve();
      this.videoTransceiver = null;
      this.offerNumber = 0;
      this.localOfferID = '';
      this.negotiationPending = false;
      this.attemptTimer = null;
      this.abortAttempt = null;
    }

    async start() {
      if (!this.stopped) return;
      this.stopped = false;
      this.localMediaReleased = false;
      this._state("connecting");
      try {
        await this._connect(this.resumeToken, !!this.options.takeover);
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

    async setVideoTrack(track, stream, options = {}) {
      if (!this.peer) throw new Error("Media Session is not connected");
      const generation = this.generation;
      return this._withNegotiation(async () => {
        const transceiver = this.videoTransceiver;
        if (transceiver) {
          const sender = transceiver.sender;
          if (options.sendEncodings && sender.getParameters) {
            const parameters = sender.getParameters();
            parameters.encodings?.forEach((encoding,index)=>Object.assign(encoding,options.sendEncodings[index]||{}));
            await sender.setParameters(parameters);
          }
          if (generation !== this.generation || this.stopped) return;
          await sender.replaceTrack(track);
        } else {
          this.videoTransceiver = this.peer.addTransceiver(track, {direction: "sendonly", streams: [stream], ...options});
          await this._sendOffer();
        }
        if (generation !== this.generation || this.stopped) return;
        this._send({type: "video-started"});
        return this.videoTransceiver.sender;
      });
    }

    async setDisplayAudioTrack(track) { const generation = this.generation; const sender = this.displayAudioSender; if (sender && !this.stopped) { await sender.replaceTrack(track); if (generation !== this.generation) track?.stop(); } }

    async clearVideoTrack() {
      if (!this.videoTransceiver) return;
      return this._withNegotiation(async () => {
        this._send({type: "video-stopped"});
        await this.videoTransceiver.sender.replaceTrack(null);
      });
    }

    async renegotiate({iceRestart = false} = {}) {
      return this._withNegotiation(() => this._sendOffer(iceRestart));
    }

    async _sendOffer(iceRestart = false) {
      if (!this.peer || this.socket?.readyState !== 1) throw new Error("Voice signaling is unavailable");
      const peer = this.peer, generation = this.generation;
      if (peer.signalingState && peer.signalingState !== 'stable') { this.negotiationPending = true; return; }
      if (iceRestart) {
        const iceServers = await this._bounded(this.fetchCredentials());
        if (this.stopped || generation !== this.generation) return;
        peer.setConfiguration?.({iceServers});
        peer.restartIce?.();
      }
      this.localOfferID = `client-${++this.offerNumber}`;
      const offer = await peer.createOffer(iceRestart ? {iceRestart: true} : undefined);
      if (this.stopped || generation !== this.generation) return;
      await peer.setLocalDescription(offer);
      if (this.stopped || generation !== this.generation) return;
      this._send({type: "offer", negotiation_id: this.localOfferID, sdp: peer.localDescription});
    }

    async _connect(resumeToken, takeover = false) {
      const generation = ++this.generation;
      this.abortAttempt?.();
      clearTimeout(this.attemptTimer); clearTimeout(this.offerTimer);
      this.videoTransceiver = null; this.displayAudioSender = null;
      this.negotiation = Promise.resolve();
      this.negotiationPending = false;
      this.options.onPeerReplaced?.();
      this.attemptTimer = setTimeout(() => {
        if (generation !== this.generation || this.stopped || this.peer?.connectionState === 'connected') return;
        this.abortAttempt?.();
        this.recovering = false;
        this._recover(new Error('Media connection timed out'));
      }, 10000);
      clearInterval(this.heartbeat);
      clearTimeout(this.iceTimer);
	  clearInterval(this.diagnosticsTimer);
      this.socket?.close();
      this.peer?.close();
      this.onProgress("Fetching relay configuration…");
      const iceServers = await this._bounded(this.fetchCredentials());
      if (this.stopped || generation !== this.generation) throw new Error("Voice connection cancelled");
      this.onProgress("Preparing encrypted media…");
      const peer = this.createPeer({iceServers});
      this.peer = peer;
      const pendingLocal = [], pendingRemote = [];
      for (const track of this.stream.getTracks()) peer.addTrack(track, this.stream);
      this.displayAudioSender = peer.addTransceiver("audio", {direction: "sendrecv"}).sender;
      this.videoTransceiver = peer.addTransceiver("video", {direction: "sendrecv", sendEncodings: [{rid:"q",scaleResolutionDownBy:4,maxBitrate:250000},{rid:"h",scaleResolutionDownBy:2,maxBitrate:750000},{rid:"f",maxBitrate:2500000}]});
      const codecs = globalThis.RTCRtpSender?.getCapabilities?.('video')?.codecs;
      if (codecs) this.videoTransceiver.setCodecPreferences?.([...codecs.filter(codec=>codec.mimeType.toLowerCase()==='video/vp8'),...codecs.filter(codec=>codec.mimeType.toLowerCase()!=='video/vp8')]);
      peer.ontrack = event => { if (!this.stopped && generation === this.generation) this.onTrack(event); };
      peer.onicecandidate = event => {
        if (this.stopped || generation !== this.generation || !event.candidate) return;
        const frame = {type: "candidate", candidate: event.candidate.toJSON()};
        if (this.socket?.readyState === 1) this._send(frame); else pendingLocal.push(frame);
      };
      peer.onconnectionstatechange = () => this._peerState(peer, generation);
      peer.oniceconnectionstatechange = () => this._peerState(peer, generation);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (this.stopped || generation !== this.generation) { peer.close(); throw new Error('Media connection cancelled'); }
      this.localOfferID = `client-${++this.offerNumber}`;
      const socket = this.createSocket();
      this.socket = socket;
      this.onProgress("Opening media signaling…");
      return this._bounded(new Promise((resolve, reject) => {
        let settled = false;
		let connected = false;
        let frameQueue = Promise.resolve();
        const fail = error => { if (!settled) { settled = true; reject(error); } };
        this.abortAttempt = () => fail(new Error('Media connection cancelled'));
        socket.onopen = () => {
          if (this.stopped || generation !== this.generation) return socket.close();
          this.onProgress("Waiting for the media server…");
          this._send({type: "join", room_id: this.roomID, resume_token: resumeToken, takeover, capabilities: ['negotiation-id'], negotiation_id: this.localOfferID, sdp: peer.localDescription});
          pendingLocal.splice(0).forEach(frame => this._send(frame));
          this.lastHeartbeatAck = Date.now();
          this.heartbeat = setInterval(() => this._heartbeat(socket, generation), this.heartbeatInterval);
        };
        const handleFrame = async frame => {
          if (this.stopped || generation !== this.generation) return;
          if (frame.type === "heartbeat-ack") { this.lastHeartbeatAck = Date.now(); return; }
          if (frame.type === 'command-error') { this.onFrame(frame); return; }
          if (frame.type === "error") {
            const error = new Error(frame.error || "Voice connection failed");
            error.code = frame.code || "signaling_error";
            if (['moderated', 'superseded', 'already_active', 'unauthorized', 'join_failed'].includes(error.code)) {
              fail(error); this._terminate('failed', error); return;
            }
            fail(error);
            socket.close();
            return;
          }
          if (frame.type === "answer") {
            if (frame.negotiation_id && frame.negotiation_id !== this.localOfferID) return;
            // A simultaneous server offer may have rolled back this client's
            // offer. Its eventual answer is then obsolete and must not tear
            // down the otherwise-stable session.
            if (peer.signalingState && peer.signalingState !== "have-local-offer") return;
            this.onProgress("Finishing media connection…");
            await peer.setRemoteDescription(frame.sdp);
            if (this.stopped || generation !== this.generation) return;
            this.localOfferID = ""; clearTimeout(this.offerTimer);
            for (const candidate of pendingRemote.splice(0)) peer.addIceCandidate(candidate).catch(() => {});
            if (frame.resume_token) {
              this.resumeToken = frame.resume_token;
              this.onResumeToken(frame.resume_token);
              this._send({type: "mute-state", muted: this.stream.getAudioTracks?.()[0]?.enabled === false});
            }
			if (!connected) {
			  connected = true;
			  this._startDiagnostics(peer, generation);
			  if (!settled) { settled = true; resolve(); }
			}
            if (this.negotiationPending) { this.negotiationPending = false; await this.renegotiate(); }
            return;
          }
          if (frame.type === "candidate" && frame.candidate) {
            if (peer.remoteDescription) peer.addIceCandidate(frame.candidate).catch(() => {}); else pendingRemote.push(frame.candidate);
            return;
          }
          if (frame.type === "offer") {
            await this._withNegotiation(async () => {
              const retryLocalOffer = peer.signalingState === "have-local-offer";
              if (retryLocalOffer) await peer.setLocalDescription({type: "rollback"});
              await peer.setRemoteDescription(frame.sdp);
              const answer = await peer.createAnswer();
              await peer.setLocalDescription(answer);
              if (this.stopped || generation !== this.generation) return;
              this._send({type: "answer", negotiation_id: frame.negotiation_id, sdp: peer.localDescription});
              if (retryLocalOffer) {
                this.localOfferID = `client-${++this.offerNumber}`;
                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                if (this.stopped || generation !== this.generation) return;
                this._send({type: "offer", negotiation_id: this.localOfferID, sdp: peer.localDescription});
              }
            });
            return;
          }
          this.onFrame(frame);
        };
        socket.onmessage = event => {
          frameQueue = frameQueue.then(() => handleFrame(JSON.parse(event.data))).catch(error => {
            if (['moderated', 'superseded', 'already_active', 'unauthorized', 'join_failed'].includes(error.code)) {
              fail(error); this._terminate('failed', error); return;
            }
            fail(error);
            socket.close();
          });
        };
        socket.onerror = () => {
          if (connected) socket.close();
          else fail(new Error("Voice signaling failed"));
        };
        socket.onclose = () => {
          if (this.stopped || generation !== this.generation) return;
          clearInterval(this.heartbeat);
          const error = new Error("Voice signaling closed");
		  if (!connected) fail(error); else this._recover(error);
        };
      }));
    }

    async _recover(cause) {
      if (this.stopped || this.recovering) return;
      const terminal = error => ['moderated', 'superseded', 'already_active', 'unauthorized', 'join_failed'].includes(error?.code);
      if (terminal(cause)) { this._terminate('failed', cause); return; }
      this.recovering = true;
      this._state('recovering', cause);
      this.recoveryDeadline ||= Date.now() + this.recoveryTimeout;
      while (!this.stopped && Date.now() < this.recoveryDeadline) {
        const generation = this.generation;
        const delay = this.recoveryDelays[Math.min(this.recoveryAttempt || 0, this.recoveryDelays.length - 1)] || 0;
        this.recoveryAttempt = (this.recoveryAttempt || 0) + 1;
        if (delay) await new Promise(resolve => setTimeout(resolve, Math.min(delay, Math.max(0, this.recoveryDeadline - Date.now()))));
        if (this.stopped || generation !== this.generation || Date.now() >= this.recoveryDeadline) break;
        try {
          await this._connect(this.resumeToken, false);
          this.recovering = false;
          return;
        } catch (error) {
          cause = error;
          if (terminal(error)) break;
          if (error.code === 'invalid_resume') { this.resumeToken = ''; this.onResumeToken(''); }
        }
      }
      if (!this.stopped) this._terminate('failed', cause);
    }

    _bounded(promise, timeout = 10000) {
      return new Promise((resolve, reject) => {
        const remaining = this.recoveryDeadline ? this.recoveryDeadline - Date.now() : timeout;
        const timer = setTimeout(() => reject(new Error('Media operation timed out')), Math.max(0, Math.min(timeout, remaining)));
        Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timer));
      });
    }

    _terminate(state, error) {
      this.stopped = true;
      this.recovering = false;
      this.generation++;
      this.abortAttempt?.(); this.abortAttempt = null; clearTimeout(this.attemptTimer); clearTimeout(this.offerTimer);
      this.recoveryDeadline = 0; this.recoveryAttempt = 0;
      clearInterval(this.heartbeat);
      clearTimeout(this.iceTimer);
	  clearInterval(this.diagnosticsTimer);
      this.socket?.close();
      this.peer?.close();
      this.socket = null;
      this.peer = null;
      this.videoTransceiver = null;
      if (!this.localMediaReleased) {
        this.localMediaReleased = true;
        this.stream?.getTracks().forEach(track => track.stop?.());
        this.options.releaseCapture?.();
      }
      this._state(state, error);
    }

    _peerState(peer, generation) {
      if (this.stopped || peer !== this.peer || generation !== this.generation) return;
      const state = peer.connectionState || peer.iceConnectionState;
      clearTimeout(this.iceTimer);
      if (state === "connected" || state === "completed") {
        clearTimeout(this.iceTimer);
        this.recovering = false; this.recoveryDeadline = 0; this.recoveryAttempt = 0; clearTimeout(this.attemptTimer); if (!this.localOfferID) clearTimeout(this.offerTimer);
        this._state("connected");
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
		  this.onDiagnostics({schema:"allchat.media.test/v1",at:new Date().toISOString(),roomID:this.roomID,generation,state:this.state,connectionState:peer.connectionState||"",iceConnectionState:peer.iceConnectionState||"",signalingState:peer.signalingState||"",inbound,outbound});
		} catch (_) {}
	  };
	  collect();
	  this.diagnosticsTimer=setInterval(collect,this.diagnosticsInterval);
	}

    _send(frame) {
      if (this.socket?.readyState !== 1) return false;
      if (frame.type === 'offer') {
        clearTimeout(this.offerTimer);
        const generation = this.generation, id = frame.negotiation_id;
        this.offerTimer = setTimeout(() => {
          if (!this.stopped && generation === this.generation && id === this.localOfferID) this._recover(new Error('Media negotiation timed out'));
        }, 10000);
      }
      this.socket.send(JSON.stringify({version: 1, ...frame}));
      return true;
    }

    _withNegotiation(action) {
      const generation = this.generation;
      const result = this.negotiation.catch(() => {}).then(() => { if (this.stopped || generation !== this.generation) return; return action(); });
      this.negotiation = result.catch(() => {});
      return result;
    }

    _state(state, error) {
      if (this.state === state && !error) return;
      this.state = state;
      this.onState(state, error);
    }

    _waitForGathering(peer) {
      if (!peer.iceGatheringState || peer.iceGatheringState === "complete") return Promise.resolve();
      return this._bounded(new Promise(resolve => {
        const changed = () => {
          if (peer.iceGatheringState !== "complete") return;
          peer.removeEventListener("icegatheringstatechange", changed);
          resolve();
        };
        peer.addEventListener("icegatheringstatechange", changed);
      }));
    }
  }

  window.AllChatVoiceConnection = VoiceConnection;
})();
