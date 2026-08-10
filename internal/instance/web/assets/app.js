(() => {
  if (window.__allchatWebSocketBatches) return;
  window.__allchatWebSocketBatches = true;
  const NativeWebSocket = window.WebSocket;
  class AllChatWebSocket extends EventTarget {
    constructor(url, protocols) {
      super();
      this.native = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      if (typeof this.native.addEventListener !== "function") return this.native;
      this.queue = [];
      this.draining = false;
      for (const type of ["open", "close", "error"]) this.native.addEventListener(type, event => this.emit(type, event));
      this.native.addEventListener("message", event => {
        let frame;
        try { frame = JSON.parse(event.data); } catch (_) { this.emit("message", event); return; }
        if (frame.type !== "events" || !Array.isArray(frame.events)) { this.emit("message", event); return; }
        this.queue.push(...frame.events.map(item => JSON.stringify({type: item.type, cursor: item.cursor, channel_id: item.channel_id, payload: item.payload})));
        if (this.queue.length > 1000) {
          this.queue.length = 0;
          this.emit("message", {data: JSON.stringify({type:"snapshot_required", cursor:frame.cursor})});
          return;
        }
        this.drain();
      });
    }
    emit(type, source) { const event = type === "message" ? new MessageEvent(type, {data: source.data}) : new Event(type); this.dispatchEvent(event); this[`on${type}`]?.call(this, event); }
    drain() { if (this.draining || !this.queue.length) return; this.draining = true; const next = () => { const data = this.queue.shift(); if (data !== undefined) this.emit("message", {data}); if (this.queue.length) setTimeout(next, 32); else this.draining = false; }; next(); }
    send(data) { return this.native.send(data); }
    close(code, reason) { this.queue.length = 0; return this.native.close(code, reason); }
    get readyState() { return this.native.readyState; }
    get url() { return this.native.url; }
    get protocol() { return this.native.protocol; }
    get extensions() { return this.native.extensions; }
    get bufferedAmount() { return this.native.bufferedAmount; }
    get binaryType() { return this.native.binaryType; }
    set binaryType(value) { this.native.binaryType = value; }
  }
  Object.defineProperties(AllChatWebSocket, {CONNECTING:{value:0},OPEN:{value:1},CLOSING:{value:2},CLOSED:{value:3},allchatBatches:{value:true}});
  window.WebSocket = AllChatWebSocket;
})();

(() => {
  "use strict";

  // Keep user-facing strings and instant formatting behind one small seam so
  // later locale packs do not need to rewrite feature code.
  window.allchatText ||= Object.freeze({screenUnavailable: "Screen sharing is unavailable on this browser.", microphoneUnavailable: "Microphone access is unavailable on this browser."});
  window.allchatFormatInstant ||= value => new Intl.DateTimeFormat(undefined, {dateStyle: "medium", timeStyle: "short"}).format(new Date(value));
  const localizeInstants = root => root.querySelectorAll?.("time[data-utc]").forEach(node => { try { node.textContent = window.allchatFormatInstant(node.dataset.utc); } catch (_) {} });
  localizeInstants(document);
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => { if(node.nodeType !== 1)return;localizeInstants(node); }))).observe(document.documentElement, {subtree:true, childList:true});
  const nameInteractiveMembers = root => root.querySelectorAll?.(".participant-list li, .voice-channel-members li").forEach(item => { item.tabIndex = 0; item.setAttribute("role", "button"); });
  nameInteractiveMembers(document);
  document.addEventListener("allchat:view-swapped", () => nameInteractiveMembers(document));
  document.addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === " ") && event.target.matches?.(".participant-list li, .voice-channel-members li")) { event.preventDefault(); event.target.click(); } });

  // Channel runtimes are installed by the SPA router without reloading head
  // scripts, so the conversation follower must exist in the persistent shell.
  window.createConversationFollower ||= (messages, prompt, threshold = 120) => {
    let following = true;
    const nearBottom = () => messages.scrollHeight - messages.scrollTop - messages.clientHeight < threshold;
    const setFollowing = value => { following = value; prompt.hidden = value; };
    const scrollToLatest = () => { messages.scrollTop = messages.scrollHeight; setFollowing(true); };
    const followMediaGrowth = event => {
      if (following && event.target.matches("img, video")) requestAnimationFrame(scrollToLatest);
    };
    messages.addEventListener("scroll", () => setFollowing(nearBottom()), {passive: true});
    messages.addEventListener("load", followMediaGrowth, true);
    messages.addEventListener("loadedmetadata", followMediaGrowth, true);
    prompt.addEventListener("click", scrollToLatest);
    return {isFollowing: () => following, nearBottom, scrollToLatest, setFollowing};
  };

  document.addEventListener("click", event => {
    const toggle = event.target.closest("[data-sidebar-toggle]");
    const sidebar = document.querySelector(".channel-sidebar");
    if (!toggle || !sidebar) return;
    const open = sidebar.dataset.open !== "true";
    sidebar.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("keydown", event => {
    const sidebar = document.querySelector(".channel-sidebar");
    const toggle = document.querySelector("[data-sidebar-toggle]");
    if (event.key === "Escape" && sidebar?.dataset.open === "true") {
      sidebar.dataset.open = "false";
      toggle?.setAttribute("aria-expanded", "false");
      toggle?.focus();
    }
  });

  document.addEventListener("keydown", event => {
    const item = event.target.closest?.('[role="menuitem"]');
    if (!item || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...item.closest('[role="menu"]')?.querySelectorAll('[role="menuitem"]') || []].filter(candidate => !candidate.disabled);
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(item), next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  });

  document.querySelectorAll("[data-confirm]").forEach(control => control.addEventListener("click", event => {
    if (!confirm(control.dataset.confirm)) event.preventDefault();
  }));

  const setCommunityMenu = (menu, toggle, open) => {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  const completeCommunityMenu = () => document.querySelectorAll("[data-community-menu]").forEach(menu => {
    if (!menu.querySelector('a[href="/admin/channels"]')) return;
    const before = menu.querySelector('a[href="/profile"]');
    for (const [href, label] of [["/admin/invitations", "Invitations"], ["/admin/roles", "Roles"], ["/admin/soundboard", "Soundboard"]]) {
      if (menu.querySelector(`a[href="${href}"]`)) continue;
      const link = document.createElement("a");
      link.href = href;
      link.role = "menuitem";
      link.textContent = label;
      before ? before.before(link) : menu.append(link);
    }
  });
  completeCommunityMenu();
  document.addEventListener("allchat:view-swapped", completeCommunityMenu);
  document.addEventListener("click", event => {
    const communityToggle = event.target.closest("[data-community-menu-toggle]");
    if (communityToggle) {
      const menu = communityToggle.closest(".community-switcher")?.querySelector("[data-community-menu]");
      if (menu) setCommunityMenu(menu, communityToggle, menu.hidden);
      return;
    }
    const memberToggle = event.target.closest("#member-menu-toggle");
    if (memberToggle) {
      const menu = memberToggle.closest(".member-panel")?.querySelector("#member-menu");
      if (menu) {
        menu.hidden = !menu.hidden;
        memberToggle.setAttribute("aria-expanded", String(!menu.hidden));
        if (!menu.hidden) menu.querySelector('[role="menuitem"]')?.focus();
      }
      return;
    }
    const presence = event.target.closest("[data-presence-mode]");
    if (presence) {
      const mode = presence.dataset.presenceMode, panel = presence.closest(".member-panel"), status = panel?.querySelector("#member-menu-status"), indicator = panel?.querySelector("#member-presence"), csrf = panel?.querySelector('[name="csrf_token"]')?.value || document.querySelector('[name="csrf_token"]')?.value || "";
      fetch("/api/v1/presence-mode", {method: "PUT", headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf}, body: JSON.stringify({mode})}).then(response => {
        if (!response.ok) throw new Error();
        indicator?.classList.toggle("dnd", mode === "dnd");
        indicator?.classList.toggle("online", mode === "available");
        if (status) status.textContent = mode === "dnd" ? "Status set to Do Not Disturb." : "Status set to Online.";
      }).catch(() => { if (status) status.textContent = "Could not update status."; });
      return;
    }
    const copy = event.target.closest("#copy-member-id");
    if (copy) {
      const status = copy.closest(".member-panel")?.querySelector("#member-menu-status");
      navigator.clipboard.writeText(copy.dataset.memberId).then(() => { if (status) status.textContent = "Member ID copied."; }).catch(() => { if (status) status.textContent = "Could not copy Member ID."; });
      return;
    }
    document.querySelectorAll("[data-community-menu]:not([hidden])").forEach(menu => setCommunityMenu(menu, menu.closest(".community-switcher").querySelector("[data-community-menu-toggle]"), false));
    if (!event.target.closest(".member-panel")) document.querySelectorAll("#member-menu:not([hidden])").forEach(menu => { menu.hidden = true; menu.closest(".member-panel").querySelector("#member-menu-toggle")?.setAttribute("aria-expanded", "false"); });
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    document.querySelectorAll("[data-community-menu]:not([hidden])").forEach(menu => { const toggle = menu.closest(".community-switcher").querySelector("[data-community-menu-toggle]"); setCommunityMenu(menu, toggle, false); toggle.focus(); });
    document.querySelectorAll("#member-menu:not([hidden])").forEach(menu => { const toggle = menu.closest(".member-panel").querySelector("#member-menu-toggle"); menu.hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.focus(); });
  });

  document.querySelectorAll('input[type="text"]:not([autocomplete]), input:not([type]):not([autocomplete]), input[type="search"]:not([autocomplete]), textarea:not([autocomplete])').forEach(control => {
    control.setAttribute("autocomplete", "off");
    control.setAttribute("autocorrect", "off");
    control.setAttribute("autocapitalize", "off");
    control.spellcheck = false;
  });

  const installDirectMessageInbox = () => {
    window.allchatDirectMessageIDs ||= new Set();
    window.allchatMutedChannels ||= new Set();
    const cleanCommunityNavigation = () => {
      document.querySelectorAll('.community-rail a[href="/dms"], .community-menu a[href="/dms"]').forEach(link => {
        const separator = link.nextElementSibling?.classList.contains("rail-separator") ? link.nextElementSibling : null;
        link.remove();
        separator?.remove();
      });
      const communitySidebar = document.querySelector(".channel-sidebar .community-switcher")?.closest(".channel-sidebar");
      communitySidebar?.querySelectorAll(".channel-nav .channel-category").forEach(heading => {
        if (heading.textContent.trim().toLowerCase() !== "direct messages") return;
        if (!heading.querySelector("a")) {
          const link = document.createElement("a");
          link.href = "/dms";
          link.className = "dm-category-link";
          link.textContent = "Direct Messages";
          heading.replaceChildren(link);
        }
      });
      [...(communitySidebar?.querySelectorAll(".channel-nav .dm-link") || [])].slice(5).forEach(link => link.remove());
    };
    const renderShortlist = items => {
      const sidebar = document.querySelector(".channel-sidebar .community-switcher")?.closest(".channel-sidebar"), nav = sidebar?.querySelector(".channel-nav");
      if (!nav) return;
      nav.querySelectorAll(".dm-link").forEach(link => link.remove());
      nav.querySelectorAll(".channel-category").forEach(heading => { if (heading.textContent.trim().toLowerCase() === "direct messages") heading.remove(); });
      const fragment = document.createDocumentFragment(), heading = document.createElement("h2"), headingLink = document.createElement("a");
      heading.className = "channel-category dm-category";
      headingLink.className = "dm-category-link";
      headingLink.href = "/dms";
      headingLink.textContent = "Direct Messages";
      heading.append(headingLink);
      fragment.append(heading);
      items.slice(0, 5).forEach(item => {
        const link = document.createElement("a"), avatar = document.createElement(item.other.avatar_url ? "img" : "span"), name = document.createElement("span");
        link.className = "dm-link";
        link.href = `/channels/${item.id}`;
        link.classList.toggle("unread", Number(item.unread || 0) > 0);
        if (item.other.avatar_url) { avatar.src = item.other.avatar_url; avatar.alt = ""; }
        else { avatar.className = "dm-avatar-fallback"; avatar.textContent = Array.from(item.other.username || "?")[0].toUpperCase(); }
        name.textContent = item.other.display_name || item.other.username;
        link.append(avatar, name);
        fragment.append(link);
      });
      nav.insertBefore(fragment, nav.firstElementChild);
    };
    const ensureButton = () => {
      const header = document.querySelector(".content-header");
      if (!header) return null;
      let button = header.querySelector("[data-dm-button]");
      if (!button) {
        button = document.createElement("a");
        button.className = "button-ghost dm-header-button";
        button.href = "/dms";
        button.dataset.dmButton = "";
        button.setAttribute("aria-label", "Direct Messages");
        button.title = "Direct Messages";
        button.innerHTML = '<span aria-hidden="true">✦</span><span class="dm-unread-dot" data-dm-unread hidden></span>';
        const actions = header.querySelector(".header-actions");
        actions ? actions.prepend(button) : header.append(button);
      }
      return button;
    };
    let directMessages = new Map(), unread = 0;
    const renderUnread = () => {
      const dot = ensureButton()?.querySelector("[data-dm-unread]");
      if (!dot) return;
      dot.hidden = unread < 1;
      dot.setAttribute("aria-label", unread === 1 ? "1 unread Direct Message" : `${unread} unread Direct Messages`);
    };
    const refresh = async () => {
      const response = await fetch("/api/v1/dms");
      if (!response.ok) return;
      const value = await response.json();
      const items = value.direct_messages || [];
      directMessages = new Map(items.map(item => [item.id, item]));
      window.allchatDirectMessageIDs = new Set(directMessages.keys());
      unread = [...directMessages.values()].reduce((total, item) => total + Number(item.unread || 0), 0);
      renderShortlist(items);
      renderUnread();
    };
    cleanCommunityNavigation();
    ensureButton();
    refresh().catch(() => {});
    fetch("/api/v1/notification-settings").then(response => response.ok ? response.json() : null).then(settings => settings?.muted_channel_ids?.forEach(id => window.allchatMutedChannels.add(id))).catch(() => {});
    document.addEventListener("allchat:view-swapped", () => { cleanCommunityNavigation(); ensureButton(); refresh().catch(() => {}); });
    setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 2000);

    let cursor = null, retry = 250, notificationsAllowed = true;
    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const query = cursor === null ? "" : `?cursor=${cursor}`;
      const socket = new WebSocket(`${protocol}//${location.host}/api/v1/realtime${query}`);
      let heartbeat;
      socket.onopen = () => { retry = 250; socket.send(JSON.stringify({type: "heartbeat"})); heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type: "heartbeat"})); }, 1000); };
      socket.onmessage = async event => {
        const frame = JSON.parse(event.data);
        if (Number.isFinite(frame.cursor)) cursor = frame.cursor;
        if (frame.type === "state.ephemeral") notificationsAllowed = frame.payload?.presence?.[document.body.dataset.memberId] !== "dnd";
        if (frame.type !== "message.created" || !frame.payload || frame.payload.author_id === document.body.dataset.memberId) return;
        if (!directMessages.has(frame.payload.channel_id)) await refresh().catch(() => {});
        if (!directMessages.has(frame.payload.channel_id)) return;
        const viewing = document.body.dataset.channelId === frame.payload.channel_id;
        if (viewing) {
          const csrf = document.querySelector('[name="csrf_token"]')?.value;
          if (csrf && frame.payload.sequence) fetch(`/api/v1/dms/${frame.payload.channel_id}/read-position`, {method: "PUT", headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf}, body: JSON.stringify({sequence: frame.payload.sequence})}).then(refresh).catch(() => {});
          return;
        }
        unread++;
        renderUnread();
        if (notificationsAllowed && !window.allchatMutedChannels.has(frame.payload.channel_id) && Notification.permission === "granted") {
          const preview = frame.payload.body || (frame.payload.attachments?.length ? "Sent an attachment" : "New message");
          const notice = new Notification(`${frame.payload.author_name} sent you a Direct Message`, {body: preview.slice(0, 180), tag: `allchat-dm-${frame.payload.channel_id}`});
          notice.onclick = () => { window.focus(); location.href = `/channels/${frame.payload.channel_id}`; };
        }
      };
      socket.onclose = () => { clearInterval(heartbeat); setTimeout(connect, retry = Math.min(retry * 2, 5000)); };
    };
    connect();
  };
  if (document.body.dataset.memberId || document.querySelector(".member-panel")) installDirectMessageInbox();

	const installVoiceChannelPresence=async()=>{
	  window.allchatVoicePending ||= new Map();
	  const participantSnapshots=new Map();
	  const response=await fetch("/api/v1/channels");if(!response.ok)return;
	  const overview=await response.json(),voiceChannels=(overview.channels||[]).filter(channel=>channel.type==="voice");
	  const discover=()=>{const rows=[];voiceChannels.forEach(channel=>document.querySelectorAll(`a[href="/channels/${CSS.escape(channel.id)}"]`).forEach(link=>{link.classList.add("voice-link");let list=link.nextElementSibling;if(!list?.matches(`[data-voice-participants="${CSS.escape(channel.id)}"]`)){list=document.createElement("ul");list.className="voice-channel-members participant-list";list.dataset.voiceParticipants=channel.id;list.setAttribute("aria-label",`${channel.name} participants`);link.after(list)}rows.push({channel,list})}));return rows};
	  const refresh=async({channel,list})=>{try{const result=await fetch(`/api/v1/voice/${channel.id}/participants`);if(!result.ok)return;const state=await result.json(),profiles=state.members||{},participants=[...(state.participants||[])],connected=new Set(participants.filter(item=>item.connected).map(item=>item.member_id)),previous=participantSnapshots.get(channel.id),pending=window.allchatVoicePending.get(channel.id);participantSnapshots.set(channel.id,connected);if(previous&&window.allchatActiveVoiceRoom===channel.id){const self=document.body.dataset.memberId,joined=[...connected].some(id=>id!==self&&!previous.has(id)),left=[...previous].some(id=>id!==self&&!connected.has(id));if(joined)window.allchatVoiceEarcon?.("join");if(left)window.allchatVoiceEarcon?.("leave")}if(pending){profiles[pending.member_id]=pending.profile||profiles[pending.member_id]||{};const existing=participants.find(item=>item.member_id===pending.member_id);if(existing)existing.pending_status=pending.status;else participants.push({member_id:pending.member_id,connected:false,server_muted:false,speaking:false,pending_status:pending.status})}list.replaceChildren();participants.forEach(participant=>{const profile=profiles[participant.member_id]||{},item=document.createElement("li"),avatar=document.createElement(profile.avatar_url?"img":"span"),name=document.createElement("span");item.dataset.participantId=participant.member_id;item.dataset.voiceRoom=channel.id;item.dataset.serverMuted=String(!!participant.server_muted);item.classList.toggle("reconnecting",!participant.connected);item.classList.toggle("speaking",!!participant.speaking);if(profile.avatar_url){avatar.src=profile.avatar_url;avatar.alt=""}else{avatar.textContent=Array.from(profile.username||state.names?.[participant.member_id]||"?")[0].toUpperCase();avatar.className="voice-member-fallback"}name.textContent=profile.display_name||profile.username||state.names?.[participant.member_id]||"Member";item.append(avatar,name);if(participant.screen_sharing){const sharing=document.createElement("span");sharing.className="voice-member-screen";sharing.textContent="▣";sharing.title="Sharing screen";sharing.setAttribute("aria-label",sharing.title);item.append(sharing)}if(participant.pending_status){const pendingState=document.createElement("small");pendingState.className="voice-member-state";pendingState.textContent=participant.pending_status;item.append(pendingState)}if(participant.server_muted||participant.muted){const muted=document.createElement("span");muted.className="voice-member-muted";muted.textContent="⌁";muted.title=participant.server_muted?"Server muted":"Muted";muted.setAttribute("aria-label",muted.title);item.append(muted)}list.append(item)})}catch(_){}};
	  const refreshAll=()=>discover().forEach(refresh);document.addEventListener("allchat:voice-pending",refreshAll);document.addEventListener("allchat:view-swapped",refreshAll);await Promise.all(discover().map(refresh));setInterval(()=>{if(!document.hidden)refreshAll()},2000);
	};
	if(document.querySelector(".channel-nav"))installVoiceChannelPresence().catch(()=>{}).finally(()=>import("/assets/voice-sidebar.js").catch(()=>{}));
	if(document.querySelector(".channel-nav"))import("/assets/channel-navigation.js").catch(()=>{});

  const conversation = document.querySelector(".conversation-layout");
  if (document.body.dataset.memberId) {
    const popover = document.createElement("section");
    popover.className = "member-popover";
    popover.hidden = true;
    popover.setAttribute("aria-label", "Member profile");
    popover.innerHTML = `<div class="member-popover-banner"><button class="member-popover-more" type="button" aria-label="Member actions" aria-expanded="false">•••</button><div class="member-action-menu" role="menu" hidden><button type="button" role="menuitem" data-member-action="dm">Message</button><button type="button" role="menuitem" class="danger-text" data-member-action="block">Block</button><button type="button" role="menuitem" class="danger-text" data-member-action="report">Report Member</button><button type="button" role="menuitem" data-member-action="copy">Copy Member ID</button></div></div><div class="member-popover-body"><div class="member-popover-avatar"></div><h2></h2><p class="member-popover-username"></p><span class="badge member-popover-role" hidden>Community Owner</span><p class="member-popover-status" aria-live="polite"></p></div>`;
    document.body.append(popover);
    const voiceMenu = document.createElement("div");
    voiceMenu.className = "voice-member-context";
    voiceMenu.hidden = true;
    voiceMenu.setAttribute("role", "menu");
    voiceMenu.innerHTML = `<button type="button" role="menuitem" data-voice-member-action="profile">Profile</button><button type="button" role="menuitem" data-voice-member-action="mention">Mention</button><button type="button" role="menuitem" data-voice-member-action="dm">Message</button><hr><button type="button" role="menuitem" data-voice-member-action="server-mute">Server Mute</button><button type="button" role="menuitem" class="danger-text" data-voice-member-action="disconnect">Disconnect</button><hr><button type="button" role="menuitem" data-voice-member-action="copy">Copy User ID</button>`;
    document.body.append(voiceMenu);
    const more = popover.querySelector(".member-popover-more");
    const menu = popover.querySelector(".member-action-menu");
    const status = popover.querySelector(".member-popover-status");
    const currentMemberID = document.body.dataset.memberId;
    const csrf = document.querySelector('[name="csrf_token"]')?.value || "";
    let selectedMember;
    let selectedVoiceItem;
    let canModerate = false;
    fetch("/api/v1/moderation-records?limit=1").then(response => {canModerate=response.ok}).catch(()=>{});
    let membersPromise;
    const members = () => membersPromise ||= fetch("/api/v1/members").then(response => response.ok ? response.json() : Promise.reject(new Error("Could not load Member profile."))).then(value => value.members || value);
    const setActionsOpen = open => {
      menu.hidden = !open;
      more.setAttribute("aria-expanded", String(open));
    };
    const identifyMember = async trigger => {
      const items = await members();
      const explicitID = trigger.closest("[data-participant-id]")?.dataset.participantId;
      if (explicitID) return items.find(item => item.id === explicitID);
      const username = trigger.closest(".dm-profile-card")?.querySelector("p")?.textContent.trim().replace(/^@/, "");
      if (username) return items.find(item => item.username === username);
      const name = trigger.textContent.trim();
      return items.find(item => (item.display_name || item.username) === name);
    };
    const showMember = (member, anchor) => {
      selectedMember = member;
      status.textContent = "";
      setActionsOpen(false);
      popover.querySelector("h2").textContent = member.display_name || member.username;
      popover.querySelector(".member-popover-username").textContent = `@${member.username}`;
      popover.querySelector(".member-popover-role").hidden = !member.owner;
      const avatar = popover.querySelector(".member-popover-avatar");
      avatar.replaceChildren();
      if (member.avatar_url) {
        const image = document.createElement("img");
        image.src = member.avatar_url;
        image.alt = "";
        avatar.append(image);
      } else {
        const fallback = document.createElement("span");
        fallback.textContent = Array.from(member.username || "?")[0].toUpperCase();
        avatar.append(fallback);
      }
      const ownProfile = member.id === currentMemberID;
      more.hidden = ownProfile;
      const bounds = anchor.getBoundingClientRect();
	  const left = Math.min(innerWidth - 318, Math.max(8, bounds.left));
	  popover.classList.toggle("actions-left", left + 496 > innerWidth && left >= 204);
      popover.style.left = `${left}px`;
      popover.style.top = `${Math.min(innerHeight - 390, Math.max(8, bounds.bottom + 8))}px`;
      popover.hidden = false;
    };
    document.addEventListener("click", async event => {
      if (!event.target.closest(".voice-member-context")) voiceMenu.hidden = true;
      const trigger = event.target.closest(".message > strong, .participant-list li, .dm-profile-card");
      if (trigger) {
        event.preventDefault();
        try {
          const member = await identifyMember(trigger);
          if (member) showMember(member, trigger);
        } catch (error) {
          console.error(error);
        }
        return;
      }
      if (!popover.hidden && !event.target.closest(".member-popover")) popover.hidden = true;
    });
    document.addEventListener("contextmenu", async event => {
      const item=event.target.closest("[data-voice-participants] > [data-participant-id]");
      if(!item)return;
      event.preventDefault();
      selectedVoiceItem=item;
      selectedMember=await identifyMember(item).catch(()=>null);
      if(!selectedMember)return;
      const own=selectedMember.id===currentMemberID;
      voiceMenu.querySelector('[data-voice-member-action="mention"]').hidden=own;
      voiceMenu.querySelector('[data-voice-member-action="dm"]').hidden=own;
      voiceMenu.querySelector('[data-voice-member-action="server-mute"]').hidden=own||!canModerate;
      voiceMenu.querySelector('[data-voice-member-action="disconnect"]').hidden=own||!canModerate;
      voiceMenu.querySelector('[data-voice-member-action="server-mute"]').textContent=item.dataset.serverMuted==="true"?"Server Unmute":"Server Mute";
      voiceMenu.hidden=false;
      voiceMenu.style.left=`${Math.max(8,Math.min(innerWidth-224,event.clientX))}px`;
      voiceMenu.style.top=`${Math.max(8,Math.min(innerHeight-voiceMenu.offsetHeight-8,event.clientY))}px`;
    });
    voiceMenu.addEventListener("click",async event=>{
      const action=event.target.closest("[data-voice-member-action]")?.dataset.voiceMemberAction;
      if(!action||!selectedMember||!selectedVoiceItem)return;
      voiceMenu.hidden=true;
      if(action==="profile")return showMember(selectedMember,selectedVoiceItem);
      if(action==="copy")return navigator.clipboard.writeText(selectedMember.id);
      if(action==="mention"){const input=document.getElementById("message-body");if(input){input.value+=`${input.value?" ":""}@${selectedMember.username} `;input.focus()}return}
      if(action==="dm"){const response=await fetch("/api/v1/dms",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({member_id:selectedMember.id})});if(response.ok)location.href=`/channels/${(await response.json()).id}`;return}
      const room=selectedVoiceItem.dataset.voiceRoom,reason=prompt(action==="disconnect"?"Reason for disconnecting this Member? (optional)":"Reason for changing Server Mute? (optional)")||"";
      const muted=selectedVoiceItem.dataset.serverMuted==="true",method=action==="disconnect"?"POST":muted?"DELETE":"PUT",suffix=action==="disconnect"?"disconnect":"mute";
      await fetch(`/api/v1/media/rooms/${room}/participants/${selectedMember.id}/${suffix}`,{method,headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({reason})});
    });
    more.addEventListener("click", () => setActionsOpen(menu.hidden));
    menu.addEventListener("click", async event => {
      const action = event.target.closest("[data-member-action]")?.dataset.memberAction;
      if (!action || !selectedMember) return;
      setActionsOpen(false);
      try {
        if (action === "copy") {
          await navigator.clipboard.writeText(selectedMember.id);
          status.textContent = "Member ID copied.";
        } else if (action === "dm") {
          const response = await fetch("/api/v1/dms", {method: "POST", headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf}, body: JSON.stringify({member_id: selectedMember.id})});
          if (!response.ok) throw new Error("Could not open Direct Message.");
          location.href = `/channels/${(await response.json()).id}`;
        } else if (action === "block") {
          const response = await fetch(`/api/v1/blocks/${selectedMember.id}`, {method: "PUT", headers: {"X-CSRF-Token": csrf}});
          if (!response.ok) throw new Error("Could not block Member.");
          status.textContent = "Member blocked. Existing history remains visible.";
          event.target.textContent = "Blocked";
          event.target.disabled = true;
		} else if (action === "report") {
		  const reason = prompt("Why should moderators review this Member?");
		  if (!reason) return;
		  const response = await fetch("/api/v1/reports", {method: "POST", headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf}, body: JSON.stringify({target_member_id: selectedMember.id, reason})});
		  if (!response.ok) throw new Error("Could not submit Report.");
		  status.textContent = "Report submitted for moderator review.";
        }
      } catch (error) {
        status.textContent = error.message;
      }
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !popover.hidden) {
        popover.hidden = true;
        setActionsOpen(false);
      }
    });
  }

  if (document.body.dataset.memberId) import("/assets/call.js");
  const installAvatarControls=root=>{
    const profileForm=root.querySelector?.('form[action="/profile"]');if(!profileForm||profileForm.querySelector("[data-avatar-control]"))return;
    const control=document.createElement("fieldset");control.dataset.avatarControl="";control.innerHTML='<legend>Avatar</legend><div class="profile-avatar-editor"><img alt="Current avatar" hidden><span class="member-avatar-fallback">?</span><label>Choose image<input type="file" accept="image/png,image/jpeg,image/gif,image/webp"></label><button type="button" data-avatar-save>Upload avatar</button><button type="button" class="button-ghost danger-text" data-avatar-remove>Remove avatar</button></div><p class="muted" data-avatar-status aria-live="polite"></p>';
    profileForm.insertBefore(control,profileForm.firstElementChild?.nextElementSibling||profileForm.firstElementChild);const file=control.querySelector('input[type="file"]'),image=control.querySelector("img"),fallback=control.querySelector("span"),status=control.querySelector("[data-avatar-status]"),csrf=profileForm.querySelector('[name="csrf_token"]').value,avatarURL=document.querySelector('.member-summary img')?.src;
    if(avatarURL){image.src=avatarURL;image.hidden=false;fallback.hidden=true}
    control.querySelector("[data-avatar-save]").onclick=async()=>{if(!file.files[0]){status.textContent="Choose an image first.";return}const response=await fetch("/api/v1/profile/avatar",{method:"PUT",headers:{"X-CSRF-Token":csrf,"Content-Type":file.files[0].type||"application/octet-stream"},body:file.files[0]});status.textContent=response.ok?"Avatar updated.":"Could not update avatar.";if(response.ok){image.src=URL.createObjectURL(file.files[0]);image.hidden=false;fallback.hidden=true}};
    control.querySelector("[data-avatar-remove]").onclick=async()=>{const response=await fetch("/api/v1/profile/avatar",{method:"DELETE",headers:{"X-CSRF-Token":csrf}});status.textContent=response.ok?"Avatar removed.":"Could not remove avatar.";if(response.ok){image.hidden=true;fallback.hidden=false}};
  };
  installAvatarControls(document);document.addEventListener("allchat:view-swapped",event=>installAvatarControls(event.detail?.root||document));
})();
