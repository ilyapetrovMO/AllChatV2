(() => {
  "use strict";

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

	const installVoiceChannelPresence=async()=>{
	  window.allchatVoicePending ||= new Map();
	  const response=await fetch("/api/v1/channels");if(!response.ok)return;
	  const overview=await response.json(),voiceChannels=(overview.channels||[]).filter(channel=>channel.type==="voice");
	  const discover=()=>{const rows=[];voiceChannels.forEach(channel=>document.querySelectorAll(`a[href="/channels/${CSS.escape(channel.id)}"]`).forEach(link=>{link.classList.add("voice-link");let list=link.nextElementSibling;if(!list?.matches(`[data-voice-participants="${CSS.escape(channel.id)}"]`)){list=document.createElement("ul");list.className="voice-channel-members participant-list";list.dataset.voiceParticipants=channel.id;list.setAttribute("aria-label",`${channel.name} participants`);link.after(list)}rows.push({channel,list})}));return rows};
	  const refresh=async({channel,list})=>{try{const result=await fetch(`/api/v1/voice/${channel.id}/participants`);if(!result.ok)return;const state=await result.json(),profiles=state.members||{},participants=[...(state.participants||[])],pending=window.allchatVoicePending.get(channel.id);if(pending){profiles[pending.member_id]=pending.profile||profiles[pending.member_id]||{};const existing=participants.find(item=>item.member_id===pending.member_id);if(existing)existing.pending_status=pending.status;else participants.push({member_id:pending.member_id,connected:false,server_muted:false,speaking:false,pending_status:pending.status})}list.replaceChildren();participants.forEach(participant=>{const profile=profiles[participant.member_id]||{},item=document.createElement("li"),avatar=document.createElement(profile.avatar_url?"img":"span"),name=document.createElement("span");item.dataset.participantId=participant.member_id;item.classList.toggle("reconnecting",!participant.connected);item.classList.toggle("speaking",!!participant.speaking);if(profile.avatar_url){avatar.src=profile.avatar_url;avatar.alt=""}else{avatar.textContent=Array.from(profile.username||state.names?.[participant.member_id]||"?")[0].toUpperCase();avatar.className="voice-member-fallback"}name.textContent=profile.display_name||profile.username||state.names?.[participant.member_id]||"Member";item.append(avatar,name);if(participant.screen_sharing){const sharing=document.createElement("span");sharing.className="voice-member-screen";sharing.textContent="▣";sharing.title="Sharing screen";sharing.setAttribute("aria-label",sharing.title);item.append(sharing)}if(participant.pending_status){const pendingState=document.createElement("small");pendingState.className="voice-member-state";pendingState.textContent=participant.pending_status;item.append(pendingState)}if(participant.server_muted||participant.muted){const muted=document.createElement("span");muted.className="voice-member-muted";muted.textContent="⌁";muted.title=participant.server_muted?"Server muted":"Muted";muted.setAttribute("aria-label",muted.title);item.append(muted)}list.append(item)})}catch(_){}};
	  const refreshAll=()=>discover().forEach(refresh);document.addEventListener("allchat:voice-pending",refreshAll);document.addEventListener("allchat:view-swapped",refreshAll);await Promise.all(discover().map(refresh));setInterval(()=>{if(!document.hidden)refreshAll()},2000);
	};
	if(document.querySelector(".channel-nav"))installVoiceChannelPresence().catch(()=>{}).finally(()=>import("/assets/voice-sidebar.js").catch(()=>{}));
	if(document.querySelector(".channel-nav"))import("/assets/channel-navigation.js").catch(()=>{});

  const conversation = document.querySelector(".conversation-layout");
  if (conversation) {
    const popover = document.createElement("section");
    popover.className = "member-popover";
    popover.hidden = true;
    popover.setAttribute("aria-label", "Member profile");
    popover.innerHTML = `<div class="member-popover-banner"><button class="member-popover-more" type="button" aria-label="Member actions" aria-expanded="false">•••</button><div class="member-action-menu" role="menu" hidden><button type="button" role="menuitem" data-member-action="dm">Message</button><button type="button" role="menuitem" class="danger-text" data-member-action="block">Block</button><button type="button" role="menuitem" class="danger-text" data-member-action="report">Report Member</button><button type="button" role="menuitem" data-member-action="copy">Copy Member ID</button></div></div><div class="member-popover-body"><div class="member-popover-avatar"></div><h2></h2><p class="member-popover-username"></p><span class="badge member-popover-role" hidden>Community Owner</span><p class="member-popover-status" aria-live="polite"></p></div>`;
    document.body.append(popover);
    const more = popover.querySelector(".member-popover-more");
    const menu = popover.querySelector(".member-action-menu");
    const status = popover.querySelector(".member-popover-status");
    const currentMemberID = document.body.dataset.memberId;
    const csrf = document.querySelector('[name="csrf_token"]')?.value || "";
    let selectedMember;
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

  if (document.querySelector(".channel-topic")?.textContent.trim() === "Direct Message") {
	import("/assets/call.js");
  }
})();
