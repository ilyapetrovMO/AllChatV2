(() => {
  if (!document.querySelector('link[rel~="icon"]')) {
    const favicon = document.createElement("link"); favicon.rel = "icon"; favicon.type = "image/png"; favicon.href = "/assets/favicon.png"; document.head.append(favicon);
  }
  // Selected Lucide icons, ISC licensed: https://lucide.dev/license
  const iconPaths = {
    bell: '<path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.84 18 12.28 18 8a6 6 0 0 0-12 0c0 4.28-1.41 5.84-2.74 7.33"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/><polyline points="14 2 14 8 20 8"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    messages: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0 1 22 16.92Z"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>'
  };
  const icon=(name, className="")=>{const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");svg.setAttribute("data-lucide",name);svg.setAttribute("class",`lucide-icon ${className}`.trim());svg.innerHTML=iconPaths[name]||"";return svg};
  const setIcon=(element,name)=>{if(!element)return;element.replaceChildren(icon(name))};
  window.allchatMediaOwnerID ||= (trackID="",streamID="")=>{for(const value of [streamID,trackID]){const match=/^(?:member|audio|screen)-(.+)$/.exec(value);if(match)return match[1]}return ""};
  const installIcons=(root=document)=>{
    for(const [selector,name] of [[".mobile-menu","menu"],[".dm-rail-mark","messages"],[".member-settings","settings"],[".notification-bell","bell"],[".mobile-members","users"],[".media-stage-view .hash","volume"],[".attachment-button","paperclip"]])root.querySelectorAll?.(selector).forEach(element=>setIcon(element,name));
    root.querySelectorAll?.('[data-community-menu-toggle] > [aria-hidden="true"]').forEach(element=>setIcon(element,"chevron-down"));
    root.querySelectorAll?.('.community-mark[href="/"]:not(.dm-rail-mark)').forEach(element=>{setIcon(element,"home");if(!element.getAttribute("aria-label"))element.setAttribute("aria-label","Community Home");if(!element.getAttribute("title"))element.setAttribute("title","Community Home")});
    root.querySelectorAll?.(".message-attachment").forEach(link=>{if(link.querySelector("svg"))return;link.textContent=link.textContent.replace(/^📎\s*/,"");link.prepend(icon("paperclip"))});
  };
  const removeDuplicateSearchEntries=(root=document)=>root.querySelectorAll?.('a[href="/search"]').forEach(link=>link.remove());
  const normalizeSettingsNavigation=(root=document)=>{
	root.querySelectorAll?.('.settings-nav > a[href="/"], [data-community-return]').forEach(link=>link.remove());
	root.querySelectorAll?.('.channel-sidebar').forEach(sidebar=>{
		if(sidebar.querySelector('.community-header')?.textContent.trim()!=="Community Settings")return;
		const nav=sidebar.querySelector('.settings-nav');if(!nav)return;
		const title=root.querySelector('.content-header h1')?.textContent.trim()||"";
		const active={"Admin Dashboard":"/admin/dashboard","Community Settings":"/admin/settings","Channels":"/admin/channels","Roles":"/admin/roles","Invitations":"/admin/invitations","Soundboard":"/admin/soundboard"}[title];
		nav.replaceChildren(...[["/admin/dashboard","Dashboard"],["/admin/settings","General"],["/admin/channels","Channels"],["/admin/roles","Roles"],["/admin/invitations","Invitations"],["/admin/soundboard","Soundboard"]].map(([href,label])=>{const link=document.createElement("a");link.href=href;link.textContent=label;if(href===active)link.setAttribute("aria-current","page");return link}));
	});
  };
	const installMarkdownCodeHighlighting=(root=document)=>root.querySelectorAll?.('.community-markdown pre code:not([data-highlighted]),.message .body pre code:not([data-highlighted])').forEach(code=>{
		code.dataset.highlighted="true";const language=[...code.classList].find(name=>name.startsWith("language-"))?.slice(9)||"";
		const span=(kind,value)=>{const node=document.createElement("span");node.className="syntax-"+kind;node.textContent=value;return node};
		if(language==="json"){try{const value=JSON.parse(code.textContent),fragment=document.createDocumentFragment();const write=(item,depth=0)=>{if(item===null){fragment.append(span("literal","null"));return}if(typeof item==="string"){fragment.append(span("string",JSON.stringify(item)));return}if(typeof item==="number"||typeof item==="boolean"){fragment.append(span("literal",String(item)));return}const array=Array.isArray(item),entries=array?item:Object.entries(item);fragment.append(document.createTextNode(array?"[":"{"));if(entries.length)fragment.append(document.createTextNode("\n"));entries.forEach((entry,index)=>{fragment.append(document.createTextNode("  ".repeat(depth+1)));if(!array){fragment.append(span("key",JSON.stringify(entry[0])),document.createTextNode(": "));write(entry[1],depth+1)}else write(entry,depth+1);fragment.append(document.createTextNode(index<entries.length-1?",\n":"\n"))});fragment.append(document.createTextNode("  ".repeat(depth)+(array?"]":"}")))};write(value);code.replaceChildren(fragment)}catch(_){}}
		else if(language==="bash"||language==="sh"||language==="shell"){const fragment=document.createDocumentFragment();code.textContent.split(/(\s+|"[^"]*"|'[^']*')/).filter(Boolean).forEach(token=>fragment.append(/^['"]/.test(token)?span("string",token):/^(echo|cd|curl|go|npm|npx|git|sudo)$/.test(token)?span("keyword",token):document.createTextNode(token)));code.replaceChildren(fragment)}
	});
  const installGlobalSearch=(root=document)=>{
    root.querySelectorAll?.('.content > form[action="/search"]').forEach(form=>form.remove());
    root.querySelectorAll?.(".content-header").forEach((header,index)=>{
      if(header.querySelector('[role="search"]'))return;
      const form=document.createElement("form"),label=document.createElement("label"),input=document.createElement("input");
      form.className="header-search global-header-search";form.role="search";form.method="get";form.action="/search";
      label.className="sr-only";label.htmlFor=`global-search-${index}`;label.textContent="Search Community";
      input.id=label.htmlFor;input.name="q";input.type="search";input.maxLength=200;input.placeholder="Search Community";input.autocomplete="off";
      if(location.pathname==="/search")input.value=new URLSearchParams(location.search).get("q")||"";
      form.append(label,input);let actions=header.querySelector(".header-actions");if(!actions){actions=document.createElement("div");actions.className="header-actions";header.append(actions)}actions.append(form);
    });
	root.querySelectorAll?.('.header-search:not([data-filters-ready])').forEach(form=>{
		form.dataset.filtersReady="true";const input=form.querySelector('input[name="q"]');if(!input)return;
		const menu=document.createElement("div");menu.className="search-filter-menu";menu.hidden=true;
		[["from:","From a specific user"],["in:","Sent in a specific channel"],["has:file","Includes a file"],["has:image","Includes an image"],["has:link","Includes a link"],["mentions:","Mentions a specific user"],["before:","Sent before a date"],["after:","Sent after a date"]].forEach(([token,title])=>{const button=document.createElement("button");button.type="button";button.dataset.searchToken=token;button.innerHTML=`<strong>${title}</strong><small>${token}${token.endsWith(":")?"…":""}</small>`;menu.append(button)});
		form.append(menu);input.addEventListener("focus",()=>menu.hidden=false);input.addEventListener("input",()=>menu.hidden=false);input.addEventListener("keydown",event=>{if(event.key==="Escape"){menu.hidden=true;input.blur()}});menu.addEventListener("pointerdown",event=>event.preventDefault());menu.addEventListener("click",event=>{const token=event.target.closest("[data-search-token]")?.dataset.searchToken;if(!token)return;const space=input.value&& !input.value.endsWith(" ")?" ":"";input.value+=space+token+(token.includes(":")&&!token.endsWith(":")?" ":"");input.focus()});form.addEventListener("focusout",()=>setTimeout(()=>menu.hidden=true,120));
	});
	const settingsForm=root.querySelector?.('form[action="/admin/settings"]');
	if(settingsForm&&!settingsForm.querySelector('[name="home_markdown"]')){const label=document.createElement("label"),textarea=document.createElement("textarea"),hint=document.createElement("p");label.textContent="Community home (Markdown)";textarea.name="home_markdown";textarea.rows=12;textarea.maxLength=100000;textarea.disabled=true;hint.className="muted";hint.textContent="Rules, greetings, and links shown on Community Home. Markdown formatting is supported.";label.append(textarea);settingsForm.querySelector("button")?.before(label,hint);fetch("/api/v1/community-home").then(response=>response.ok?response.json():null).then(value=>{textarea.value=value?.markdown||""}).catch(()=>{}).finally(()=>textarea.disabled=false)}
  };
	  window.allchatIcon=icon;window.allchatSetIcon=setIcon;installIcons();removeDuplicateSearchEntries();normalizeSettingsNavigation();installGlobalSearch();installMarkdownCodeHighlighting();new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)installMarkdownCodeHighlighting(node.matches?.("code")?node.parentElement:node)}))).observe(document.body,{childList:true,subtree:true});document.addEventListener("allchat:view-swapped",event=>{const root=event.detail?.root||document;installIcons(root);removeDuplicateSearchEntries(root);normalizeSettingsNavigation(root);installGlobalSearch(root);installMarkdownCodeHighlighting(root)});
  if (window.__allchatWebSocketBatches) return;
  window.__allchatWebSocketBatches = true;
  const NativeWebSocket = window.WebSocket;
  class AllChatWebSocket extends EventTarget {
    constructor(url, protocols) {
      super();
      this.native = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      if (typeof this.native.addEventListener !== "function") return this.native;
      this.queue = [];
      this.maxQueueDepth = 0;
      this.draining = false;
      this.livenessTimer = null;
      this.lastInboundAt = Date.now();
      const liveness = window.__allchatWebSocketLiveness || {};
      const checkInterval = liveness.checkInterval || 5000;
      const timeout = liveness.timeout || 15000;
      this.native.addEventListener("open", event => {
        this.lastInboundAt = Date.now();
        if (String(url).includes("/api/v1/realtime")) this.livenessTimer = setInterval(() => {
          if (this.native.readyState === NativeWebSocket.OPEN && Date.now() - this.lastInboundAt > timeout) this.native.close(4000, "Realtime connection timed out");
        }, checkInterval);
        this.emit("open", event);
      });
      this.native.addEventListener("close", event => { clearInterval(this.livenessTimer); this.emit("close", event); });
      this.native.addEventListener("error", event => this.emit("error", event));
      this.native.addEventListener("message", event => {
        this.lastInboundAt = Date.now();
        let frame;
        try { frame = JSON.parse(event.data); } catch (_) { this.emit("message", event); return; }
        if (frame.type !== "events" || !Array.isArray(frame.events)) { this.emit("message", event); return; }
        for (const item of frame.events) {
          const encoded = JSON.stringify({type: item.type, cursor: item.cursor, channel_id: item.channel_id, payload: item.payload});
          if (item.type === "read.updated") {
            const member = item.payload?.member_id || "";
            const prefix = `\"type\":\"read.updated\"`;
            const existing = this.queue.findIndex(value => value.includes(prefix) && value.includes(`\"channel_id\":\"${item.channel_id}\"`) && (!member || value.includes(`\"member_id\":\"${member}\"`)));
            if (existing >= 0) { this.queue[existing] = encoded; continue; }
          }
          this.queue.push(encoded);
        }
        this.maxQueueDepth = Math.max(this.maxQueueDepth, this.queue.length);
        sessionStorage.setItem("allchat.realtime.queue_high_water", String(Math.max(Number(sessionStorage.getItem("allchat.realtime.queue_high_water") || 0), this.maxQueueDepth)));
        if (this.queue.length > 1000) {
          this.queue.length = 0;
          this.emit("message", {data: JSON.stringify({type:"snapshot_required", cursor:frame.cursor})});
          return;
        }
        this.drain();
      });
    }
    emit(type, source) { const event = type === "message" ? new MessageEvent(type, {data: source.data}) : new Event(type); this.dispatchEvent(event); this[`on${type}`]?.call(this, event); }
    drain() { if (this.draining || !this.queue.length) return; this.draining = true; const next = () => { for(let count=0;count<16&&this.queue.length;count++){const data=this.queue.shift();this.emit("message",{data})}if(this.queue.length)requestAnimationFrame(next);else this.draining=false;};requestAnimationFrame(next); }
    send(data) { return this.native.send(data); }
    close(code, reason) { this.queue.length = 0; clearInterval(this.livenessTimer); return this.native.close(code, reason); }
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

  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta && !viewportMeta.content.includes("interactive-widget=")) viewportMeta.content += ",interactive-widget=resizes-content";
  const syncVisualViewport = height => {
    const value = Number(height ?? window.visualViewport?.height ?? window.innerHeight);
    if (Number.isFinite(value) && value > 0) document.documentElement.style.setProperty("--allchat-visual-height", `${Math.round(value)}px`);
  };
  window.syncAllChatVisualViewport = syncVisualViewport;
  syncVisualViewport();
  window.visualViewport?.addEventListener("resize", () => syncVisualViewport(), {passive: true});
  window.addEventListener("orientationchange", () => syncVisualViewport(), {passive: true});

  const notificationCenterReady = import("/assets/notification-service.js").then(() => window.installAllChatNotificationCenter?.()).catch(() => null);

  // Keep user-facing strings and instant formatting behind one small seam so
  // later locale packs do not need to rewrite feature code.
  window.allchatText ||= Object.freeze({screenUnavailable: "Screen sharing is unavailable on this browser.", microphoneUnavailable: "Microphone access is unavailable on this browser."});
  window.addEventListener("allchat:voice-compatibility", event => {
    const message=event.detail?.message;if(!message)return;
    let notice=document.querySelector("[data-voice-compatibility]");
    if(!notice){notice=document.createElement("div");notice.className="voice-compatibility-notice";notice.dataset.voiceCompatibility="";notice.setAttribute("role","status");notice.setAttribute("aria-live","polite");document.body.append(notice)}
    notice.textContent=message;notice.hidden=false;clearTimeout(notice.dismissTimer);notice.dismissTimer=setTimeout(()=>{notice.hidden=true},8000);
  });
  window.allchatFormatInstant ||= value => new Intl.DateTimeFormat(undefined, {dateStyle: "medium", timeStyle: "short"}).format(new Date(value));
  const localizeInstants = root => root.querySelectorAll?.("time[data-utc]").forEach(node => { try { node.textContent = window.allchatFormatInstant(node.dataset.utc); } catch (_) {} });
  localizeInstants(document);
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => { if(node.nodeType !== 1)return;localizeInstants(node); }))).observe(document.documentElement, {subtree:true, childList:true});
  const nameInteractiveMembers = root => root.querySelectorAll?.(".participant-list li, .voice-channel-members li").forEach(item => { item.tabIndex = 0; item.setAttribute("role", "button"); });
  const groupMemberSidebar = sidebar => {
    if (!sidebar || sidebar.querySelector(".dm-profile-card")) return;
    const initialList = sidebar.querySelector(":scope > .participant-list"), existing = sidebar.querySelector("[data-member-groups]"), source = initialList || existing;
    const items = [...(source?.querySelectorAll("[data-participant-id]") || [])];
    let groups = existing;
    if (!groups) {
      groups = document.createElement("div"); groups.dataset.memberGroups = ""; groups.className = "member-groups";
      ["owner", "online", "offline"].forEach(key => { const section=document.createElement("section"),heading=document.createElement("h2"),list=document.createElement("ul");section.className="member-group";section.dataset.memberGroup=key;heading.className="participant-heading";list.className="participant-list";section.append(heading,list);groups.append(section); });
      sidebar.querySelector(":scope > .participant-heading")?.remove(); initialList?.remove(); sidebar.append(groups);
    }
    const buckets = {owner: [], online: [], offline: []};
    items.forEach(item => { const owner=item.querySelector("small")?.textContent.trim()==="Owner",dot=item.querySelector(".participant-presence"),connected=["online","dnd","idle","mobile"].some(state=>dot?.classList.contains(state)),key=owner?"owner":connected?"online":"offline";buckets[key].push(item); });
    const labels = {owner: "OWNER", online: "ONLINE", offline: "OFFLINE"};
    Object.entries(buckets).forEach(([key,members]) => { const section=groups.querySelector(`[data-member-group="${key}"]`),list=section.querySelector(".participant-list");section.querySelector(".participant-heading").textContent=`${labels[key]} — ${members.length}`;list.append(...members); });
  };
  const groupAllMemberSidebars = () => document.querySelectorAll(".participant-sidebar").forEach(groupMemberSidebar);
  const applyPresenceClass = (dot, state) => {
    if (!dot) return;
    ["online", "dnd", "idle", "mobile", "offline"].forEach(value => dot.classList.toggle(value, value === state || value === "offline" && !["online", "dnd", "idle", "mobile"].includes(state)));
    const label = state === "dnd" ? "Do Not Disturb" : state === "idle" ? "AFK" : state === "mobile" ? "Online on mobile" : state === "online" ? "Online" : "Offline";
    dot.title = label; dot.setAttribute("aria-label", label);
  };
  const updateMemberPresence = presence => {
	    document.querySelectorAll("[data-participant-id]").forEach(item => {
	      const state = presence?.[item.dataset.participantId] || "offline", dot = item.querySelector(".participant-presence");
	      applyPresenceClass(dot, state);
	    });
	    const selfID=document.body.dataset.memberId,selfState=presence?.[selfID]||"offline";applyPresenceClass(document.getElementById("member-presence"),selfState);
    groupAllMemberSidebars();
  };
  window.updateAllChatMemberPresence = updateMemberPresence;
	let drawerReturnFocus = null;
	const mobileBackdrop = () => {
	  let backdrop=document.querySelector("[data-mobile-drawer-backdrop]");
	  if (!backdrop) { backdrop=document.createElement("button");backdrop.type="button";backdrop.className="mobile-drawer-backdrop";backdrop.dataset.mobileDrawerBackdrop="";backdrop.setAttribute("aria-label","Close navigation panels");backdrop.hidden=true;document.body.append(backdrop); }
	  return backdrop;
	};
	const syncMobileBackdrop = () => { mobileBackdrop().hidden = !document.querySelector('.channel-sidebar[data-open="true"], .participant-sidebar[data-open="true"]'); };
	const setMobileDrawer = (drawer, open, toggle) => {
	  if (!drawer) return;
	  if (open) { drawerReturnFocus=toggle||document.activeElement; document.querySelectorAll('.channel-sidebar[data-open="true"], .participant-sidebar[data-open="true"]').forEach(other=>{if(other!==drawer)other.dataset.open="false"}); }
	  drawer.dataset.open=String(open);
	  document.querySelectorAll(drawer.classList.contains("participant-sidebar")?'[data-members-toggle]':'[data-sidebar-toggle]').forEach(button=>button.setAttribute("aria-expanded",String(open)));
	  syncMobileBackdrop();
	  if (open) drawer.querySelector('[data-sidebar-close], [data-members-close]')?.focus();
	  else if (drawerReturnFocus?.isConnected) { drawerReturnFocus.focus(); drawerReturnFocus=null; }
	};
	const closeMobileDrawers = () => {
	  document.querySelectorAll('.channel-sidebar[data-open="true"], .participant-sidebar[data-open="true"]').forEach(drawer=>drawer.dataset.open="false");
	  document.querySelectorAll('[data-sidebar-toggle], [data-members-toggle]').forEach(button=>button.setAttribute("aria-expanded","false"));
	  syncMobileBackdrop();
	  if (drawerReturnFocus?.isConnected) drawerReturnFocus.focus(); drawerReturnFocus=null;
	};
	const installMobileDrawers = () => {
	  const sidebar=document.querySelector(".channel-sidebar");
	  if (sidebar && !sidebar.querySelector("[data-sidebar-close]")) { const close=document.createElement("button");close.type="button";close.className="mobile-sidebar-close button-ghost";close.dataset.sidebarClose="";close.setAttribute("aria-label","Close conversation navigation");close.textContent="×";sidebar.prepend(close); }
	  const participants=document.querySelector(".content-shell .participant-sidebar"), header=document.querySelector(".content-shell .content-header");
	  let toggle=header?.querySelector("[data-members-toggle]");
	  if (participants?.querySelector(".participant-list") && header) {
		if (!participants.querySelector("[data-members-close]")) { const close=document.createElement("button");close.type="button";close.className="mobile-members-close button-ghost";close.dataset.membersClose="";close.setAttribute("aria-label","Close Community Members");close.textContent="×";participants.prepend(close); }
		if (!toggle) { toggle=document.createElement("button");toggle.type="button";toggle.className="mobile-members button-ghost";toggle.dataset.membersToggle="";toggle.setAttribute("aria-label","Open Community Members");toggle.setAttribute("aria-expanded","false");window.allchatSetIcon?.(toggle,"users");const actions=header.querySelector(".header-actions");actions?actions.after(toggle):header.append(toggle); }
	  } else toggle?.remove();
	  mobileBackdrop(); syncMobileBackdrop();
	};
  const installCommunityHomeMembers = async () => {
    const main = document.querySelector(".content-shell");
    if (!main || main.querySelector(".content-header h1")?.textContent.trim() !== "Community Guide" || main.dataset.communityMembersInstalled) return;
    main.dataset.communityMembersInstalled = "pending";
    try {
      const [membersResponse, presenceResponse] = await Promise.all([fetch("/api/v1/members"), fetch("/api/v1/presence")]);
      if (!membersResponse.ok) throw new Error("Members unavailable");
      const members = (await membersResponse.json()).members || [], presence = presenceResponse.ok ? (await presenceResponse.json()).presence : {};
      if (!main.isConnected || main.querySelector(".content-header h1")?.textContent.trim() !== "Community Guide") return;
      const aside = document.createElement("aside"), heading = document.createElement("h2"), list = document.createElement("ul");
      aside.className = "participant-sidebar"; aside.setAttribute("aria-label", "Community Members");
      heading.className = "participant-heading"; heading.textContent = `Members — ${members.length}`;
      list.className = "participant-list";
      members.forEach(member => {
        const item = document.createElement("li"), avatarWrap = document.createElement("span"), avatar = document.createElement(member.avatar_url ? "img" : "span"), dot = document.createElement("span"), name = document.createElement("span");
        item.dataset.participantId = member.id; avatarWrap.className = "participant-avatar-wrap";
        if (member.avatar_url) { avatar.src = member.avatar_url; avatar.alt = ""; }
        else { avatar.className = "participant-avatar-fallback"; avatar.textContent = Array.from(member.username || "?")[0].toUpperCase(); }
	        const state = presence?.[member.id] || "offline"; dot.className = "participant-presence"; applyPresenceClass(dot, state);
        name.textContent = member.display_name || member.username;
        if (member.owner) { const owner = document.createElement("small"); owner.textContent = " Owner"; name.append(owner); }
        avatarWrap.append(avatar, dot); item.append(avatarWrap, name); list.append(item);
      });
      aside.append(heading, list); main.append(aside); groupMemberSidebar(aside); main.classList.add("community-home"); main.dataset.communityMembersInstalled = "true"; nameInteractiveMembers(aside); installMobileDrawers();
    } catch (_) { delete main.dataset.communityMembersInstalled; }
  };
  groupAllMemberSidebars();
  nameInteractiveMembers(document);
  installCommunityHomeMembers();
  installMobileDrawers();
  document.addEventListener("allchat:view-swapped", () => { closeMobileDrawers(); groupAllMemberSidebars(); nameInteractiveMembers(document); installCommunityHomeMembers(); installMobileDrawers(); });
  document.addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === " ") && event.target.matches?.(".participant-list li, .voice-channel-members li")) { event.preventDefault(); event.target.click(); } });

  // Channel runtimes are installed by the SPA router without reloading head
  // scripts, so the conversation follower must exist in the persistent shell.
  window.createConversationFollower ||= (messages, prompt, threshold = 120) => {
    let following = true;
    let presentLoader = null;
    const nearBottom = () => messages.scrollHeight - messages.scrollTop - messages.clientHeight < threshold;
    const setFollowing = value => { following = value; prompt.hidden = value; };
    const scrollToLatest = async () => { if (presentLoader) await presentLoader(); messages.scrollTop = messages.scrollHeight; setFollowing(true); };
    const followMediaGrowth = event => {
      if (following && event.target.matches("img, video")) requestAnimationFrame(scrollToLatest);
    };
    messages.addEventListener("scroll", () => setFollowing(nearBottom()), {passive: true});
    messages.addEventListener("load", followMediaGrowth, true);
    messages.addEventListener("loadedmetadata", followMediaGrowth, true);
    prompt.addEventListener("click", scrollToLatest);
    return {isFollowing: () => following, nearBottom, scrollToLatest, setFollowing, setPresentLoader: loader => { presentLoader = loader; }};
  };

  document.addEventListener("click", event => {
	const sidebarToggle=event.target.closest("[data-sidebar-toggle]"),membersToggle=event.target.closest("[data-members-toggle]");
	if(sidebarToggle){const drawer=document.querySelector(".channel-sidebar");setMobileDrawer(drawer,drawer?.dataset.open!=="true",sidebarToggle);return}
	if(membersToggle){const drawer=document.querySelector(".content-shell .participant-sidebar");setMobileDrawer(drawer,drawer?.dataset.open!=="true",membersToggle);return}
	if(event.target.closest("[data-sidebar-close], [data-members-close], [data-mobile-drawer-backdrop]")){closeMobileDrawers();return}
	if(event.target.closest('.channel-sidebar[data-open="true"] a'))closeMobileDrawers();
  });
  document.addEventListener("keydown", event => {
	if (event.key === "Escape" && document.querySelector('.channel-sidebar[data-open="true"], .participant-sidebar[data-open="true"]')) closeMobileDrawers();
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
	const settings=[...menu.querySelectorAll('a')].find(link=>link.textContent.trim()==="Community Settings");if(settings)settings.href="/admin/settings";
    const before = menu.querySelector('a[href="/profile"]');
    for (const [href, label] of [["/admin/dashboard", "Dashboard"], ["/admin/invitations", "Invitations"], ["/admin/roles", "Roles"], ["/admin/soundboard", "Soundboard"]]) {
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
        if (Number(item.unread || 0) > 0) link.append(unreadIndicator());
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
        button.append(window.allchatIcon("messages"));button.insertAdjacentHTML("beforeend",'<span class="dm-unread-dot" data-dm-unread hidden></span>');
        const actions = header.querySelector(".header-actions");
        actions ? actions.prepend(button) : header.append(button);
      }
      return button;
    };
    const unreadIndicator = () => { const dot=document.createElement("span");dot.className="conversation-unread-dot";dot.setAttribute("aria-label","Unread Messages");return dot; };
    const setConversationUnread = (channelID, value) => {
      const link=document.querySelector(`.channel-nav a[href="/channels/${CSS.escape(channelID)}"]`);if(!link)return;
      link.classList.toggle("unread",value);
      const dot=link.querySelector(".conversation-unread-dot");
      if(value&&!dot)link.append(unreadIndicator());else if(!value)dot?.remove();
    };
    let directMessages = new Map(), channels = new Map(), channelStates = new Map(), unread = 0;
    const renderUnread = () => {
      const dot = ensureButton()?.querySelector("[data-dm-unread]");
      if (!dot) return;
      dot.hidden = unread < 1;
      dot.setAttribute("aria-label", unread === 1 ? "1 unread Direct Message" : `${unread} unread Direct Messages`);
    };
    const refresh = async () => {
      const [response, channelResponse, stateResponse] = await Promise.all([fetch("/api/v1/dms"), fetch("/api/v1/channels"), fetch("/api/v1/state/channels")]);
      if (!response.ok) return;
      const value = await response.json(), overview = channelResponse.ok ? await channelResponse.json() : {channels: []};
      const items = value.direct_messages || [];
      directMessages = new Map(items.map(item => [item.id, item]));
      channels = new Map((overview.channels || []).map(item => [item.id, item]));
      const stateValue=stateResponse.ok?await stateResponse.json():{channels:[]};channelStates=new Map((stateValue.channels||[]).map(item=>[item.channel_id,item]));
      window.allchatDirectMessageIDs = new Set(directMessages.keys());
      unread = [...directMessages.values()].reduce((total, item) => total + Number(item.unread || 0), 0);
      renderShortlist(items);
      directMessages.forEach((item,channelID)=>setConversationUnread(channelID,Number(item.unread||0)>0));
      channelStates.forEach((state,channelID)=>setConversationUnread(channelID,Number(state.unread||0)>0));
      renderUnread();
    };
    cleanCommunityNavigation();
    ensureButton();
    refresh().catch(() => {});
    document.addEventListener("allchat:view-swapped", () => { cleanCommunityNavigation(); ensureButton(); refresh().catch(() => {}); });
    setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 2000);

    let cursor = null, retry = 250, activitySocket = null, lastActivitySent = 0;
    const reportActivity = () => {
      const now = Date.now();
      if (document.hidden || now - lastActivitySent < 10000 || activitySocket?.readyState !== WebSocket.OPEN) return;
      activitySocket.send(JSON.stringify({type: "activity", active: true}));
      lastActivitySent = now;
    };
    ["pointerdown", "keydown", "touchstart"].forEach(type => document.addEventListener(type, reportActivity, {capture: true, passive: true}));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { lastActivitySent = 0; reportActivity(); } });
    window.addEventListener("focus", () => { lastActivitySent = 0; reportActivity(); });
    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const query = cursor === null ? "" : `?cursor=${cursor}`;
      const socket = new WebSocket(`${protocol}//${location.host}/api/v1/realtime${query}`);
      activitySocket = socket;
      let heartbeat;
      socket.onopen = () => { retry = 250; socket.send(JSON.stringify({type: "heartbeat"})); heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type: "heartbeat"})); }, 1000); };
      socket.onmessage = async event => {
        const frame = JSON.parse(event.data);
        if (Number.isFinite(frame.cursor)) cursor = frame.cursor;
        if (frame.type === "state.ephemeral") updateMemberPresence(frame.payload?.presence);
        if (frame.type !== "message.created" || !frame.payload) return;
        const center = window.allchatNotifications;
        const currentMemberID = document.body.dataset.memberId || center?.settings?.current_member_id;
        if (currentMemberID && frame.payload.author_id === currentMemberID) return;
        if (!directMessages.has(frame.payload.channel_id) && !channels.has(frame.payload.channel_id)) await refresh().catch(() => {});
        const direct = directMessages.has(frame.payload.channel_id), channel = channels.get(frame.payload.channel_id);
        if (!direct && !channel) return;
        const viewing = document.body.dataset.channelId === frame.payload.channel_id, focused = !document.hidden && document.hasFocus();
        if (direct && viewing && focused) {
          const csrf = document.querySelector('[name="csrf_token"]')?.value;
          if (csrf && frame.payload.sequence) fetch(`/api/v1/dms/${frame.payload.channel_id}/read-position`, {method: "PUT", headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf}, body: JSON.stringify({sequence: frame.payload.sequence})}).then(refresh).catch(() => {});
        }
        window.AllChatNotificationPolicy.handleIncomingMessage(frame.payload, {
          updateUnread: () => {
            if (viewing && focused) return;
            if (direct) { unread++; renderUnread(); }
            setConversationUnread(frame.payload.channel_id,true);
          },
          notify: message => {
            if (center) return center.handleMessage(message, {directMessage: direct, channelName: direct ? "" : channel.name});
            notificationCenterReady.then(ready => {
              if (message.author_id !== ready?.settings?.current_member_id) ready?.handleMessage(message, {directMessage: direct, channelName: direct ? "" : channel.name});
            });
          },
        });
      };
      socket.onclose = () => { clearInterval(heartbeat); if (activitySocket === socket) activitySocket = null; setTimeout(connect, retry = Math.min(retry * 2, 5000)); };
    };
    connect();
  };
  if (document.querySelector(".app-shell")) installDirectMessageInbox();

	const installVoiceChannelPresence=async()=>{
	  window.allchatVoicePending ||= new Map();
	  const participantSnapshots=new Map();
	  const response=await fetch("/api/v1/channels");if(!response.ok)return;
	  const overview=await response.json(),voiceChannels=(overview.channels||[]).filter(channel=>channel.type==="voice");
	  const discover=()=>{const rows=[];voiceChannels.forEach(channel=>document.querySelectorAll(`a[href="/channels/${CSS.escape(channel.id)}"]`).forEach(link=>{link.classList.add("voice-link");let list=link.nextElementSibling;if(!list?.matches(`[data-voice-participants="${CSS.escape(channel.id)}"]`)){list=document.createElement("ul");list.className="voice-channel-members participant-list";list.dataset.voiceParticipants=channel.id;list.setAttribute("aria-label",`${channel.name} participants`);link.after(list)}rows.push({channel,list})}));return rows};
	  const refresh=async({channel,list})=>{try{const result=await fetch(`/api/v1/voice/${channel.id}/participants`);if(!result.ok)return;const state=await result.json(),profiles=state.members||{},participants=[...(state.participants||[])],connected=new Set(participants.filter(item=>item.connected).map(item=>item.member_id)),previous=participantSnapshots.get(channel.id),pending=window.allchatVoicePending.get(channel.id);participantSnapshots.set(channel.id,connected);if(previous&&window.allchatActiveVoiceRoom===channel.id){const self=document.body.dataset.memberId,joined=[...connected].some(id=>id!==self&&!previous.has(id)),left=[...previous].some(id=>id!==self&&!connected.has(id));if(joined)window.allchatVoiceEarcon?.("join");if(left)window.allchatVoiceEarcon?.("leave")}if(pending){profiles[pending.member_id]=pending.profile||profiles[pending.member_id]||{};const existing=participants.find(item=>item.member_id===pending.member_id);if(existing)existing.pending_status=pending.status;else participants.push({member_id:pending.member_id,connected:false,server_muted:false,speaking:false,pending_status:pending.status})}list.replaceChildren();participants.forEach(participant=>{const profile=profiles[participant.member_id]||{},item=document.createElement("li"),avatar=document.createElement(profile.avatar_url?"img":"span"),name=document.createElement("span");item.dataset.participantId=participant.member_id;item.dataset.voiceRoom=channel.id;item.dataset.serverMuted=String(!!participant.server_muted);item.classList.toggle("reconnecting",!participant.connected);item.classList.toggle("speaking",!!participant.speaking);if(profile.avatar_url){avatar.src=profile.avatar_url;avatar.alt=""}else{avatar.textContent=Array.from(profile.username||state.names?.[participant.member_id]||"?")[0].toUpperCase();avatar.className="voice-member-fallback"}name.textContent=profile.display_name||profile.username||state.names?.[participant.member_id]||"Member";item.append(avatar,name);if(participant.screen_sharing){const sharing=document.createElement("span");sharing.className="voice-member-screen";sharing.textContent="▣";sharing.title="Sharing screen";sharing.setAttribute("aria-label",sharing.title);item.append(sharing)}if(participant.pending_status){const pendingState=document.createElement("small");pendingState.className="voice-member-state";pendingState.textContent=participant.pending_status;item.append(pendingState)}if(participant.server_muted||participant.muted){const muted=document.createElement("span");muted.className="voice-member-muted";muted.textContent="⌁";muted.title=participant.server_muted?"Server muted":"Muted";muted.setAttribute("aria-label",muted.title);item.append(muted)}list.append(item)})}catch(_){}};
	  const refreshAll=()=>discover().forEach(refresh);document.addEventListener("allchat:voice-pending",refreshAll);document.addEventListener("allchat:view-swapped",refreshAll);await Promise.all(discover().map(refresh));setInterval(()=>{if(!document.hidden)refreshAll()},2000);
	};
	if(document.querySelector(".channel-nav"))installVoiceChannelPresence().catch(()=>{}).finally(()=>import("/assets/rnnoise.js").then(()=>import("/assets/voice-settings.js")).then(()=>import("/assets/voice-connection.js")).then(()=>import("/assets/voice-sidebar.js")).catch(()=>{}));
	if(document.querySelector(".channel-nav"))import("/assets/channel-navigation.js").catch(()=>{});

  const conversation = document.querySelector(".conversation-layout");
  const installMemberInteractions = () => {
    if (!document.body.dataset.memberId || document.querySelector(".member-popover")) return;
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
	      const banner = popover.querySelector(".member-popover-banner");
	      banner.style.backgroundImage = member.banner_url ? `url(${JSON.stringify(member.banner_url)})` : "";
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
  };
  installMemberInteractions();
  document.addEventListener("allchat:view-swapped", installMemberInteractions);

  if (document.body.dataset.memberId) import("/assets/call.js");
  const installProfileImages=root=>import("/assets/profile-images.js").then(module=>module.installProfileImageControls(root)).catch(()=>{});
  installProfileImages(document);document.addEventListener("allchat:view-swapped",event=>installProfileImages(event.detail?.root||document));
  const installVoiceSettingsLink=root=>{const nav=root.querySelector?.(".settings-nav");if(!nav||nav.closest(".channel-sidebar")?.querySelector(".community-header")?.textContent.trim()!=="Member Settings"||nav.querySelector('a[href="/voice-video"]'))return;const link=document.createElement("a");link.href="/voice-video";link.textContent="Voice & Video";const sessions=nav.querySelector('a[href="/sessions"]');sessions?nav.insertBefore(link,sessions):nav.append(link)};
  installVoiceSettingsLink(document);document.addEventListener("allchat:view-swapped",event=>installVoiceSettingsLink(event.detail?.root||document));
  const installVoiceSettings=root=>{if(!root.querySelector?.("[data-voice-settings]"))return;import("/assets/voice-settings-page.js").then(()=>window.installAllChatVoiceSettings?.(root)).catch(()=>{})};
  installVoiceSettings(document);document.addEventListener("allchat:view-swapped",event=>installVoiceSettings(event.detail?.root||document));

  const installSoundboard = root => {
    if (!root.querySelector?.("#sound-upload")) return;
    import("/assets/soundboard-admin.js").then(module => module.installSoundboardAdmin(root)).catch(() => {});
  };
  installSoundboard(document);
  document.addEventListener("allchat:view-swapped", event => installSoundboard(event.detail?.root || document));
  const installRingtoneSettings=root=>{if(!root.querySelector?.("[data-community-ringtone]"))return;import("/assets/ringtone-settings.js").then(()=>window.installAllChatRingtoneSettings?.(root)).catch(()=>{})};
  installRingtoneSettings(document);document.addEventListener("allchat:view-swapped",event=>installRingtoneSettings(event.detail?.root||document));
  const installAdminDashboard=root=>{if(!root.querySelector?.("[data-admin-dashboard]"))return;import("/assets/admin-dashboard.js").then(()=>window.installAllChatAdminDashboard?.(root)).catch(()=>{})};
  installAdminDashboard(document);
  document.addEventListener("allchat:view-swapped",event=>installAdminDashboard(event.detail?.root||document));

  const installVersionWatcher=()=>{
    let loadedBuild="",prompted=false;
    const check=async()=>{try{const response=await fetch("/api/v1/version",{cache:"no-store"});if(!response.ok)return;const value=await response.json();if(!loadedBuild){loadedBuild=value.build_id;return}if(!prompted&&value.build_id&&value.build_id!==loadedBuild){prompted=true;const notice=document.createElement("aside");notice.className="client-update-notice";notice.setAttribute("role","status");const copy=document.createElement("span");copy.textContent="AllChat was updated. Reload to use the new version.";const reload=document.createElement("button");reload.type="button";reload.textContent="Reload";reload.onclick=()=>location.reload();notice.append(copy,reload);document.body.append(notice)}}catch{}};
    check();setInterval(()=>{if(!document.hidden)check()},60000);document.addEventListener("visibilitychange",()=>{if(!document.hidden)check()});
  };
  installVersionWatcher();
})();
