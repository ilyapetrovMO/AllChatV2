// AllChat is free software under the GNU Affero General Public License v3.0 or later.
(function (global) {
  const TOAST_COOLDOWN_MS = 1500;
  const SOUND_COOLDOWN_MS = 1000;

  if (!document.querySelector('link[rel="manifest"]')) {
    const manifest = document.createElement("link"); manifest.rel = "manifest"; manifest.href = "/manifest.webmanifest"; document.head.append(manifest);
  }

  const normalizedLevel = value => {
    const level = String(value || "default").toLowerCase().replaceAll("-", "_");
    return ["default", "all_messages", "mentions_only", "nothing"].includes(level) ? level : "default";
  };

  const effectiveLevel = state => {
    const channelLevel = normalizedLevel(state.channelSetting?.level);
    return channelLevel === "default" ? normalizedLevel(state.serverSetting?.level || "all_messages") : channelLevel;
  };

  const directlyMentions = (message, currentUserID) => (message.mentions || []).some(mention =>
    (typeof mention === "string" ? mention : mention.id || mention.member_id) === currentUserID
  );

  const shouldNotify = (message, state) => {
    if (!message || !state?.currentUserID || message.author_id === state.currentUserID) return false;
    if (state.appFocused && message.channel_id === state.activeChannelID) return false;
    if (state.serverSetting?.muted || state.channelSetting?.muted) return false;
    const level = effectiveLevel(state);
    if (level === "nothing") return false;
    return level === "all_messages" || (level === "mentions_only" && directlyMentions(message, state.currentUserID));
  };

  const plainPreview = message => {
    const fallback = message.attachments?.length ? "Sent an attachment" : "New message";
    return String(message.body || fallback).replace(/[*_~`>#\[\]()]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
  };

  const handleIncomingMessage = (message, {updateUnread = () => {}, notify = () => {}} = {}) => {
    updateUnread(message);
    return notify(message);
  };

  class AllChatNotificationService {
    constructor({now = () => Date.now(), notifier = null, playSound = null, onRecent = null} = {}) {
      this.now = now;
      this.notifier = notifier;
      this.playSound = playSound;
      this.onRecent = onRecent;
      this.lastToastByConversation = new Map();
      this.lastSoundAt = -Infinity;
      this.recent = [];
    }

    handleMessage(message, state) {
      if (!shouldNotify(message, state)) return {toast: false, sound: false};
      const now = this.now();
      const lastToast = this.lastToastByConversation.get(message.channel_id) ?? -Infinity;
      if (now - lastToast < TOAST_COOLDOWN_MS) return {toast: false, sound: false};
      const direct = Boolean(state.directMessage);
      const channelName = state.channelName || "conversation";
      const notification = {
        conversationID: message.channel_id,
        author: message.author_name || "A Member",
        title: direct ? (message.author_name || "Direct Message") : `${message.author_name || "A Member"} in #${channelName}`,
        body: plainPreview(message),
        href: `/channels/${encodeURIComponent(message.channel_id)}`,
      };
      this.lastToastByConversation.set(message.channel_id, now);
      this.notifier?.notify(notification);
      this.recent.unshift({...notification, createdAt: now});
      this.recent.splice(20);
      this.onRecent?.(this.recent.slice());
      let sound = false;
      if (state.serverSetting?.soundEnabled !== false && now - this.lastSoundAt >= SOUND_COOLDOWN_MS) {
        this.lastSoundAt = now;
        this.playSound?.();
        sound = true;
      }
      return {toast: true, sound};
    }
  }

  const browserNotifier = {
    notify(notification) {
      if (!("Notification" in global) || global.Notification.permission !== "granted") return;
      const notice = new global.Notification(notification.title, {body: notification.body, tag: `allchat-${notification.conversationID}`});
      notice.onclick = () => {
        global.focus();
        if (global.allchatNavigate) global.allchatNavigate(notification.href);
        else global.location.href = notification.href;
        notice.close?.();
      };
    }
  };

  const playBrowserSound = () => {
    const AudioContext = global.AudioContext || global.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.13);
    oscillator.onended = () => context.close();
  };

  const csrfToken = () => document.querySelector('[name="csrf_token"]')?.value || "";
  const option = (value, label) => { const item = document.createElement("option"); item.value = value; item.textContent = label; return item; };

  const applicationServerKey = value => {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const decoded = atob((value + padding).replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(decoded, character => character.charCodeAt(0));
  };

  const syncWebPushSubscription = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in global) || global.Notification?.permission !== "granted") return false;
    const [registration, configResponse] = await Promise.all([
      navigator.serviceWorker.register("/push-service-worker.js", {scope: "/"}),
      fetch("/api/v1/web-push/config"),
    ]);
    if (!configResponse.ok) throw new Error("Web Push configuration unavailable");
    const config = await configResponse.json();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) subscription = await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: applicationServerKey(config.public_key)});
    const response = await fetch("/api/v1/web-push/subscription", {
      method: "PUT", headers: {"Content-Type": "application/json", "X-CSRF-Token": csrfToken()}, body: JSON.stringify(subscription),
    });
    if (!response.ok) throw new Error("Could not enable background notifications");
    return true;
  };

  const installNotificationCenter = async () => {
    if (global.allchatNotifications) return global.allchatNotifications;
    let settings = {community: {level: "all_messages", muted: false, sound_enabled: true}, channels: {}};
    let settingsAvailable = true;
    try {
      const response = await fetch("/api/v1/notification-settings");
      if (!response.ok) throw new Error("Notification settings unavailable");
      settings = {...settings, ...await response.json()};
    } catch (_) {
      settingsAvailable = false;
    }
    settings.channels ||= {};
    const service = new AllChatNotificationService({notifier: browserNotifier, playSound: playBrowserSound, onRecent: () => renderRecent()});
    const center = global.allchatNotifications = {
      settings,
      service,
      handleMessage(message, details = {}) {
        const channel = settings.channels[message.channel_id] || {level: "default", muted: false};
        return service.handleMessage(message, {
          currentUserID: document.body.dataset.memberId || settings.current_member_id,
          activeChannelID: document.body.dataset.channelId || "",
          appFocused: !document.hidden && document.hasFocus(),
          serverSetting: {level: settings.community.level, muted: settings.community.muted, soundEnabled: settings.community.sound_enabled},
          channelSetting: channel,
          ...details,
        });
      }
    };
    let popover, recentList, removeBellDismiss = () => {};
    const save = async (url, value) => {
      const result = await fetch(url, {method: "PUT", headers: {"Content-Type": "application/json", "X-CSRF-Token": csrfToken()}, body: JSON.stringify(value)});
      if (!result.ok) throw new Error("Could not save notification settings");
    };
    const renderRecent = () => {
      if (!recentList) return;
      recentList.replaceChildren();
      if (!service.recent.length) { const empty = document.createElement("li"); empty.className = "muted"; empty.textContent = "No recent notifications"; recentList.append(empty); return; }
      service.recent.forEach(item => { const row = document.createElement("li"), link = document.createElement("a"), author = document.createElement("strong"), body = document.createElement("span"); link.href = item.href; author.textContent = item.title; body.textContent = item.body; link.append(author, body); row.append(link); recentList.append(row); });
    };
    const installBell = () => {
      const header = document.querySelector(".content-header");
      if (!header) return;
      let actions = header.querySelector(".header-actions");
      if (!actions) { actions = document.createElement("div"); actions.className = "header-actions"; header.append(actions); }
      actions.querySelector("#notifications")?.remove();
      if (actions.querySelector("[data-notification-bell]")) return;
      removeBellDismiss();
      const wrap = document.createElement("div"), bell = document.createElement("button");
      wrap.className = "notification-center";
      bell.type = "button"; bell.className = "notification-bell button-ghost"; bell.dataset.notificationBell = "";
      bell.setAttribute("aria-label", "Notifications"); bell.setAttribute("aria-expanded", "false"); window.allchatSetIcon?.(bell, "bell");
      const installedPopover = popover = document.createElement("section"); installedPopover.className = "notification-popover"; installedPopover.hidden = true;
      const heading = document.createElement("h2"); heading.textContent = "Notifications";
      const settingsStatus = document.createElement("p"); settingsStatus.className = "muted notification-settings-status"; settingsStatus.textContent = "Saved notification settings are temporarily unavailable; defaults are shown."; settingsStatus.hidden = settingsAvailable;
      const permission = document.createElement("button"); permission.type = "button"; permission.className = "button-secondary notification-permission";
      const pushAvailable = "Notification" in global && "serviceWorker" in navigator && "PushManager" in global;
      const updatePermission = () => { permission.textContent = !pushAvailable ? "Background notifications unavailable" : global.Notification.permission === "granted" ? "Background notifications enabled" : "Enable background notifications"; permission.disabled = !pushAvailable || global.Notification.permission === "granted"; };
      updatePermission(); permission.onclick = async () => {
        try { await global.Notification.requestPermission(); if (global.Notification.permission === "granted") await syncWebPushSubscription(); }
        catch (error) { global.alert(error.message); }
        updatePermission();
      };
      const communityLabel = document.createElement("label"), communitySelect = document.createElement("select");
      communityLabel.append("Community", communitySelect); communitySelect.append(option("all_messages", "All Messages"), option("mentions_only", "Mentions Only"), option("nothing", "Nothing")); communitySelect.value = settings.community.level;
      const communityMute = document.createElement("label"), communityMuteInput = document.createElement("input"); communityMute.className = "notification-check"; communityMuteInput.type = "checkbox"; communityMuteInput.checked = settings.community.muted; communityMute.append(communityMuteInput, "Mute Community");
      const sound = document.createElement("label"), soundInput = document.createElement("input"); sound.className = "notification-check"; soundInput.type = "checkbox"; soundInput.checked = settings.community.sound_enabled; sound.append(soundInput, "Notification sound");
      const ringtone = document.createElement("label"), ringtoneInput = document.createElement("input"), ringtoneReset = document.createElement("button"), ringtoneStatus = document.createElement("span");ringtone.textContent="Incoming call ringtone";ringtoneInput.type="file";ringtoneInput.accept="audio/mpeg,audio/wav,audio/ogg";ringtoneInput.onchange=async()=>{const file=ringtoneInput.files?.[0];if(!file)return;try{const type=file.type||(/\.ogg$/i.test(file.name)?"audio/ogg":/\.wav$/i.test(file.name)?"audio/wav":"audio/mpeg"),response=await fetch("/api/v1/member-ringtone",{method:"PUT",headers:{"Content-Type":type,"X-CSRF-Token":csrfToken()},body:file});if(!response.ok)throw new Error("Could not save ringtone");settings.member_ringtone_set=true;settings.ringtone_source="member";ringtoneStatus.textContent="Custom ringtone";ringtoneReset.hidden=false}catch(error){global.alert(error.message)}};ringtone.append(ringtoneInput);ringtoneReset.type="button";ringtoneReset.className="button-secondary";ringtoneReset.textContent="Use Community default";ringtoneReset.hidden=!settings.member_ringtone_set;ringtoneReset.onclick=async()=>{try{const response=await fetch("/api/v1/member-ringtone",{method:"DELETE",headers:{"X-CSRF-Token":csrfToken()}});if(!response.ok)throw new Error("Could not reset ringtone");settings.member_ringtone_set=false;settings.ringtone_source=settings.community_ringtone_set?"community":"tone";ringtoneStatus.textContent=settings.community_ringtone_set?"Community ringtone":"Generated tone";ringtoneReset.hidden=true}catch(error){global.alert(error.message)}};ringtoneStatus.className="muted";ringtoneStatus.textContent=settings.ringtone_source==="member"?"Custom ringtone":settings.ringtone_source==="community"?"Community ringtone":"Generated tone";
      const saveCommunity = async () => { settings.community = {level: communitySelect.value, muted: communityMuteInput.checked, sound_enabled: soundInput.checked}; await save("/api/v1/notification-settings", settings.community); };
      communitySelect.onchange = communityMuteInput.onchange = soundInput.onchange = () => saveCommunity().catch(error => global.alert(error.message));
      popover.append(heading, settingsStatus, permission, communityLabel, communityMute, sound, ringtone, ringtoneStatus, ringtoneReset);
      const channelID = document.body.dataset.channelId;
      if (channelID) {
        const channelSetting = settings.channels[channelID] ||= {level: "default", muted: false};
        const channelLabel = document.createElement("label"), channelSelect = document.createElement("select");
        channelLabel.append("This conversation", channelSelect); channelSelect.append(option("default", "Default"), option("all_messages", "All Messages"), option("mentions_only", "Mentions Only"), option("nothing", "Nothing")); channelSelect.value = channelSetting.level;
        const channelMute = document.createElement("label"), channelMuteInput = document.createElement("input"); channelMute.className = "notification-check"; channelMuteInput.type = "checkbox"; channelMuteInput.checked = channelSetting.muted; channelMute.append(channelMuteInput, "Mute conversation");
        const saveChannel = async () => { channelSetting.level = channelSelect.value; channelSetting.muted = channelMuteInput.checked; await save(`/api/v1/channels/${encodeURIComponent(channelID)}/notification-settings`, channelSetting); };
        channelSelect.onchange = channelMuteInput.onchange = () => saveChannel().catch(error => global.alert(error.message));
        popover.append(channelLabel, channelMute);
      }
      const recentHeading = document.createElement("h3"); recentHeading.textContent = "Recent"; recentList = document.createElement("ul"); recentList.className = "notification-recent"; popover.append(recentHeading, recentList); renderRecent();
      bell.onclick = () => { installedPopover.hidden = !installedPopover.hidden; bell.setAttribute("aria-expanded", String(!installedPopover.hidden)); };
      const dismiss = event => { if (!wrap.contains(event.target)) { installedPopover.hidden = true; bell.setAttribute("aria-expanded", "false"); } };
      document.addEventListener("click", dismiss);
      removeBellDismiss = () => document.removeEventListener("click", dismiss);
      wrap.append(bell, installedPopover); actions.prepend(wrap);
    };
    installBell(); document.addEventListener("allchat:view-swapped", installBell);
    if (global.Notification?.permission === "granted") syncWebPushSubscription().catch(() => {});
    return center;
  };

  global.AllChatNotificationPolicy = {shouldNotify, effectiveLevel, plainPreview, handleIncomingMessage};
  global.AllChatNotificationService = AllChatNotificationService;
  global.installAllChatNotificationCenter = installNotificationCenter;
})(window);
