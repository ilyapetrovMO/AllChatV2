import { FormEvent, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { createMediaFrameQueue, createMediaJoinFrame, desktopMediaOwnerID, mediaDisconnectMessage, serializeSessionDescription, type DesktopMediaFrame } from "./media-signaling";
import { applyDesktopOutputPreferences, captureDesktopMicrophone, defaultDesktopVoicePreferences, desktopMemberOutputVolume, loadDesktopVoicePreferences, saveDesktopVoicePreferences, type DesktopMicrophoneCapture, type DesktopVoicePreferences } from "./voice-capture";
import { insertMention, matchMention } from "./mentions";

import type { DesktopBridge, ShellState } from "../shared/desktop-bridge";
import { normalizeInstanceUrl } from "../shared/instance-url";
import type { Attachment, InstanceViewState } from "../shared/instance-state";
import type {
  InstanceAction,
  InstanceActionResult,
} from "../shared/instance-actions";

export function App({ bridge }: { bridge: DesktopBridge }) {
  const [state, setState] = useState<ShellState | null>(null);
  const [error, setError] = useState("");
  const [instanceState, setInstanceState] = useState<InstanceViewState | null>(
    null,
  );
  const [managingCommunities, setManagingCommunities] = useState(false);
  const [addingCommunity, setAddingCommunity] = useState(false);
  const [communityHomeRevision, setCommunityHomeRevision] = useState(0);
  const [directCallActive, setDirectCallActive] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register" | "recover">("login");

  useEffect(() => {
    void bridge.getShellState().then(setState);
  }, [bridge]);
  useEffect(() => {
    const update = (event: Event) => setDirectCallActive(Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active));
    window.addEventListener("allchat:direct-call-active", update);
    return () => window.removeEventListener("allchat:direct-call-active", update);
  }, []);

  const active = state?.instances.find(
    ({ id }) => id === state.activeInstanceId,
  );

  useEffect(() => {
    setInstanceState(null);
    if (!active?.session) return;
    let current = true;
    void bridge
      .loadInstance(active.id)
      .then((value) => {
        if (current) setInstanceState(value);
      })
      .catch((cause) => {
        if (current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not synchronize the Instance.",
          );
      });
    return () => {
      current = false;
    };
  }, [active?.id, active?.session?.sessionId, bridge]);

  useEffect(() => {
    if (!active?.session || !instanceState) return;
    return bridge.watchInstance(active.id, setInstanceState);
  }, [active?.id, active?.session?.sessionId, bridge, !!instanceState]);

  useEffect(() => {
    if (!instanceState?.community.name) return;
    void bridge.getShellState().then(setState);
  }, [bridge, instanceState?.community.name]);

  async function addInstance(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      const baseUrl = normalizeInstanceUrl(String(values.get("baseUrl") ?? ""));
      setState(
        await bridge.addInstance({
          displayName: new URL(baseUrl).host,
          baseUrl,
        }),
      );
      setAddingCommunity(false);
      setManagingCommunities(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not add the Instance.",
      );
    }
  }

  async function login(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!active) return;
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      setState(
        await bridge.loginInstance({
          instanceId: active.id,
          username: String(values.get("username") ?? ""),
          password: String(values.get("password") ?? ""),
        }),
      );
      setManagingCommunities(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
    }
  }

  async function register(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!active) return;
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      setState(await bridge.registerInstance({ instanceId: active.id, invitationToken: String(values.get("invitationToken") || ""), username: String(values.get("username") || ""), password: String(values.get("password") || "") }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not register."); }
  }

  async function recover(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!active) return;
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      await bridge.recoverInstance({ instanceId: active.id, recoveryToken: String(values.get("recoveryToken") || ""), password: String(values.get("password") || "") });
      setAuthMode("login");
      setError("Password replaced. Sign in with your new password.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not recover the Account."); }
  }

  async function executeAction(
    action: InstanceAction,
  ): Promise<InstanceActionResult | undefined> {
    if (!active) return undefined;
    const reactionAction = action.type === "set_reaction" ? action : null;
    const applyReaction = (activeReaction: boolean) => {
      setInstanceState((current) => current ? {
        ...current,
        messages: Object.fromEntries(Object.entries(current.messages).map(([channelId, messages]) => [
          channelId,
          messages.map((message) => message.id === reactionAction?.messageId
            ? { ...message, reactions: updateReaction(message.reactions || [], reactionAction.emoji, activeReaction) }
            : message),
        ])),
      } : current);
    };
    if (reactionAction) applyReaction(reactionAction.active);
    let result: InstanceActionResult;
    try {
      result = await bridge.executeInstance(active.id, action);
    } catch (error) {
      if (reactionAction) applyReaction(!reactionAction.active);
      throw error;
    }
    if (action.type === "set_block" && result.type === "accepted") {
      setInstanceState((current) => current ? {
        ...current,
        direct_messages: current.direct_messages.map((directMessage) =>
          directMessage.other.id === action.memberId
            ? { ...directMessage, blocked_by_me: action.blocked }
            : directMessage,
        ),
      } : current);
    }
    if (result.type === "message") {
      setInstanceState((current) =>
        current
          ? {
              ...current,
              messages: {
                ...current.messages,
                [result.message.channel_id]: mergeMessage(
                  current.messages[result.message.channel_id] || [],
                  result.message,
                ),
              },
            }
          : current,
      );
    } else if (result.type === "messages") {
      setInstanceState((current) =>
        current
          ? {
              ...current,
              messages: {
                ...current.messages,
                [result.conversationId]: mergeMessages(
                  current.messages[result.conversationId] || [],
                  result.page.messages,
                  result.direction,
                ),
              },
            }
          : current,
      );
    } else if (result.type === "deleted_message") {
      setInstanceState((current) =>
        current
          ? {
              ...current,
              messages: {
                ...current.messages,
                [result.conversationId]: (
                  current.messages[result.conversationId] || []
                ).map((message) =>
                  message.id === result.messageId
                    ? { ...message, deleted: true }
                    : message,
                ),
              },
            }
          : current,
      );
    } else if (result.type === "read_position") {
      setInstanceState((current) =>
        current
          ? {
              ...current,
              channel_states: current.channel_states.map((channel) =>
                channel.channel_id === result.conversationId
                  ? { ...channel, read_sequence: result.sequence, unread: 0 }
                  : channel,
              ),
            }
          : current,
      );
    } else if (result.type === "member") {
      setInstanceState((current) =>
        current
          ? {
              ...current,
              member:
                current.member.id === result.member.id
                  ? result.member
                  : current.member,
              members: current.members.map((member) =>
                member.id === result.member.id ? result.member : member,
              ),
            }
          : current,
      );
    } else if (result.type === "direct_message") {
      setInstanceState((current) =>
        current
          ? {
              ...current,
              direct_messages: [
                result.directMessage,
                ...current.direct_messages.filter(
                  ({ id }) => id !== result.directMessage.id,
                ),
              ],
            }
          : current,
      );
    } else if (result.type === "account_deleted") {
      setState(await bridge.logoutInstance(active.id));
      setInstanceState(null);
    }
    return result;
  }

  return (
    <>
    <DesktopTitleBar onAction={(action) => void bridge.controlWindow?.(action)} />
    <main className="shell">
      <aside className="instance-rail" aria-label="Instances">
        <button
          className="brand-mark"
          type="button"
          aria-label="Home"
          title="Home"
          aria-current={managingCommunities ? "page" : undefined}
          disabled={directCallActive}
          aria-description={directCallActive ? "End the active Direct Call before leaving this Community" : undefined}
          onClick={() => { setAddingCommunity(false); setManagingCommunities(true); }}
        >
          <Icon name="home" />
        </button>
        {state && state.instances.map((instance) => (
          <button
            className="instance-button"
            key={instance.id}
            disabled={isCommunitySwitchDisabled(directCallActive, instance.id, state.activeInstanceId)}
            onClick={() => {
              if (instance.id === state.activeInstanceId) {
                setCommunityHomeRevision((value) => value + 1);
                setManagingCommunities(false);
                setAddingCommunity(false);
                setError("");
                return;
              }
              void bridge.selectInstance(instance.id).then((next) => {
              setState(next);
              setCommunityHomeRevision((value) => value + 1);
              setManagingCommunities(false);
              setAddingCommunity(false);
              setError("");
              });
            }}
            aria-label={`${instance.displayName} Instance`}
            aria-current={
              instance.id === state.activeInstanceId ? "page" : undefined
            }
          >
			{instance.avatarUrl ? <AuthenticatedImage path={instance.avatarUrl} alt="" className="instance-avatar" fallback={instance.displayName.slice(0, 1).toUpperCase()} onAction={(action) => bridge.executeInstance(instance.id, action)} /> : instance.displayName.slice(0, 1).toUpperCase()}
          </button>
        ))}
        {state && <button className="instance-button add-instance-button" type="button" aria-label="Add Community" title="Add Community" disabled={directCallActive} onClick={() => { setAddingCommunity(true); setManagingCommunities(false); setError(""); }}><Icon name="plus" /></button>}
      </aside>
      <section className="content">
        {!state ? (
          <p>Starting AllChat…</p>
        ) : state.instances.length === 0 || addingCommunity ? (
          <div className="empty-state">
            <p className="eyebrow">Desktop Canary</p>
            <h1>{state.instances.length === 0 ? "Add your first Instance" : "Add a Community"}</h1>
            <p>
              Connect an AllChat Community to start messaging from the desktop
              client.
            </p>
            <form
              className="onboarding-form"
              onSubmit={(event) => void addInstance(event)}
            >
              <label>
                Community address
                <input
                  name="baseUrl"
                  type="text"
                  inputMode="url"
                  spellCheck={false}
                  placeholder="chat.example"
                  required
                />
              </label>
              <button type="submit">Add Instance</button>
            </form>
            {error && <p role="alert">{error}</p>}
          </div>
        ) : managingCommunities ? (
          <div className="community-manager">
            <p className="eyebrow">AllChat Desktop</p>
            <h1>Communities</h1>
            <p>Switch between your Communities or sign out of an account on this device.</p>
            <div className="community-account-list">
              {state.instances.map((instance) => (
                <article key={instance.id}>
                  <span className="instance-button" aria-hidden="true">{instance.displayName.slice(0, 1).toUpperCase()}</span>
                  <span><strong>{instance.displayName}</strong><small>{instance.session?.member.displayName || instance.session?.member.username || "Signed out"}<br />{instance.baseUrl}</small></span>
                  <button type="button" onClick={() => void bridge.selectInstance(instance.id).then((next) => { setState(next); setManagingCommunities(false); setError(""); })}>{instance.id === state.activeInstanceId ? "Open" : "Switch"}</button>
                  {instance.session && <button className="danger-button" type="button" onClick={() => void bridge.logoutInstance(instance.id).then(setState).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not sign out."))}>Sign Out</button>}
                </article>
              ))}
            </div>
            <button type="button" onClick={() => { setAddingCommunity(true); setManagingCommunities(false); }}>Add Community</button>
            {error && <p role="alert">{error}</p>}
          </div>
        ) : active && !active.session ? (
          <div className="empty-state">
            <p className="eyebrow">{active.displayName}</p>
            <h1>{authMode === "login" ? "Sign in to your Community" : authMode === "register" ? "Join your Community" : "Recover your Account"}</h1>
            <p>{active.baseUrl}</p>
            <nav className="auth-tabs" aria-label="Authentication">
              <button type="button" aria-current={authMode === "login" ? "page" : undefined} onClick={() => setAuthMode("login")}>Sign in</button>
              <button type="button" aria-current={authMode === "register" ? "page" : undefined} onClick={() => setAuthMode("register")}>Register</button>
              <button type="button" aria-current={authMode === "recover" ? "page" : undefined} onClick={() => setAuthMode("recover")}>Recovery</button>
            </nav>
            {authMode === "login" && <form
              className="onboarding-form"
              onSubmit={(event) => void login(event)}
            >
              <label>
                Username
                <input name="username" autoComplete="username" required />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <button type="submit">Sign in</button>
            </form>}
            {authMode === "register" && <form className="onboarding-form" onSubmit={(event) => void register(event)}><label>Invitation token<input name="invitationToken" required /></label><label>Username<input name="username" autoComplete="username" required /></label><label>Password<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label><button type="submit">Create Account</button></form>}
            {authMode === "recover" && <form className="onboarding-form" onSubmit={(event) => void recover(event)}><label>Recovery token<input name="recoveryToken" required /></label><label>New password<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label><button type="submit">Replace password</button></form>}
            {error && <p role="alert">{error}</p>}
          </div>
        ) : instanceState ? (
          <CommunityShell
            key={active!.id}
            instanceId={active!.id}
            state={instanceState}
            homeRequestRevision={communityHomeRevision}
            onAction={executeAction}
            connectMedia={bridge.connectMedia}
            onConversationChange={(conversationId) => bridge.setNotificationContext?.(active!.id, conversationId)}
          />
        ) : (
          <div className="empty-state">
            <p>Synchronizing {active?.displayName}…</p>
            {error && <p role="alert">{error}</p>}
          </div>
        )}
      </section>
    </main>
    </>
  );
}

export function isCommunitySwitchDisabled(callActive: boolean, instanceId: string, activeInstanceId: string | null): boolean {
  return callActive && instanceId !== activeInstanceId;
}

export function mostRecentEditableMessage(
  messages: InstanceViewState["messages"][string],
  currentMemberId: string,
) {
  return messages
    .slice(-10)
    .reverse()
    .find((message) => message.author_id === currentMemberId && !message.deleted);
}

function DesktopTitleBar({ onAction }: { onAction(action: import("../shared/desktop-bridge").WindowControlAction): void }) {
  return <header className="desktop-titlebar" aria-label="Window controls">
    <span className="desktop-titlebar-title">AllChat</span>
    <nav>
      <button type="button" aria-label="Minimize window" title="Minimize" onClick={() => onAction("minimize")}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5h8" /></svg></button>
      <button type="button" aria-label="Maximize window" title="Maximize" onClick={() => onAction("toggle-maximize")}><svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.25" y="2.25" width="7.5" height="7.5" /></svg></button>
      <button className="desktop-window-close" type="button" aria-label="Close window" title="Close" onClick={() => onAction("close")}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 2.5 7 7m0-7-7 7" /></svg></button>
    </nav>
  </header>;
}

function CommunityShell({
  instanceId,
  state,
  homeRequestRevision,
  onAction,
  connectMedia,
  onConversationChange,
}: {
  instanceId: string;
  state: InstanceViewState;
  homeRequestRevision: number;
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
  connectMedia?: DesktopBridge["connectMedia"];
  onConversationChange?(conversationId: string | null): void;
}) {
  const [conversation, setConversation] = useState<{
    id: string;
    name: string;
    type: "text" | "voice" | "dm";
    topic?: string;
  } | null>(null);
  const [homeView, setHomeView] = useState<"community" | "direct-messages">("community");
  const [directMessageMemberId, setDirectMessageMemberId] = useState("");
  const [communityGuide, setCommunityGuide] = useState<string | null>(null);
  const [voiceParticipantsByChannel, setVoiceParticipantsByChannel] = useState<Record<string, import("../shared/instance-actions").VoiceParticipant[]>>({});
  const [requestedVoiceRoom, setRequestedVoiceRoom] = useState<string | null>(null);
  const [directCall, setDirectCall] = useState<import("../shared/instance-actions").DirectCall | null>(null);
  const [settingsView, setSettingsView] = useState<
    "profile" | "voice" | "notifications" | "sessions" | "safety" | "community" | null
  >(null);
  const [communitySettingsSection, setCommunitySettingsSection] = useState("general");
  const [draft, setDraft] = useState("");
  const [mentionCaret, setMentionCaret] = useState(-1);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<
    import("../shared/instance-state").SearchResult[] | null
  >(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFiltersOpen, setSearchFiltersOpen] = useState(false);
  const [showPins, setShowPins] = useState(false);
	const [pinnedMessages, setPinnedMessages] = useState<import("../shared/instance-state").Message[] | null>(null);
  const [membersOpen, setMembersOpen] = useState(true);
  const [communityMenuOpen, setCommunityMenuOpen] = useState(false);
  const [memberMenuOpen, setMemberMenuOpen] = useState(false);
  const [presenceOverride, setPresenceOverride] = useState<"online" | "dnd" | null>(null);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [memberPopover, setMemberPopover] = useState<{
    memberId: string;
    left: number;
    top: number;
  } | null>(null);
  const [memberActionsOpen, setMemberActionsOpen] = useState(false);
  const [voiceMemberMenu, setVoiceMemberMenu] = useState<{
    participant: import("../shared/instance-actions").VoiceParticipant;
    left: number;
    top: number;
    directCall?: boolean;
  } | null>(null);
  const [sessions, setSessions] = useState<
    import("../shared/instance-actions").SessionInfo[] | null
  >(null);
  const [reports, setReports] = useState<
    import("../shared/instance-actions").Report[] | null
  >(null);
  const [records, setRecords] = useState<
    import("../shared/instance-actions").ModerationRecord[] | null
  >(null);

  useEffect(() => {
    setConversation(null);
    setHomeView("community");
    setSettingsView(null);
    setCommunityMenuOpen(false);
    setMemberMenuOpen(false);
    setSearchResults(null);
    setShowPins(false);
  }, [homeRequestRevision]);

  useEffect(() => {
    if (!reactionPickerMessageId) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("[data-reaction-picker], [data-reaction-trigger]")) setReactionPickerMessageId(null);
    };
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReactionPickerMessageId(null);
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismissWithKeyboard);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismissWithKeyboard);
    };
  }, [reactionPickerMessageId]);
  useEffect(() => {
    if (!memberMenuOpen) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".member-menu-anchor")) setMemberMenuOpen(false);
    };
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMemberMenuOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismissWithKeyboard);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismissWithKeyboard);
    };
  }, [memberMenuOpen]);
  useEffect(() => {
    void onAction({ type: "community_home" }).then((result) => {
      if (result?.type === "community_home") setCommunityGuide(result.markdown);
    }).catch(() => setCommunityGuide(""));
  }, [instanceId]);
  useEffect(() => {
    let lastActivitySent = 0;
    const reportActivity = () => {
      const now = Date.now();
      if (document.hidden || now - lastActivitySent < 10_000) return;
      lastActivitySent = now;
      void onAction({ type: "report_activity", active: true });
    };
    document.addEventListener("pointerdown", reportActivity, { capture: true, passive: true });
    document.addEventListener("keydown", reportActivity, { capture: true });
    window.addEventListener("focus", reportActivity);
    reportActivity();
    return () => {
      document.removeEventListener("pointerdown", reportActivity, { capture: true });
      document.removeEventListener("keydown", reportActivity, { capture: true });
      window.removeEventListener("focus", reportActivity);
    };
  }, [instanceId]);
  const lastTypingAt = useRef(0);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const historyLoading = useRef(new Set<string>());
  const historyExhausted = useRef<Record<string, boolean>>({});
  const newerHistoryTruncated = useRef<Record<string, boolean>>({});
  const prependScrollHeight = useRef<number | null>(null);
  const [messageWindowStarts, setMessageWindowStarts] = useState<Record<string, number | null>>({});
  const [awayFromPresent, setAwayFromPresent] = useState(false);
  const categories = [...state.categories]
    .filter(({ archived }) => !archived)
    .sort(byPosition);
  const channels = [...state.channels].filter(({ archived }) => !archived);
  const activeDirectMessage = conversation?.type === "dm"
    ? state.direct_messages.find(({ id }) => id === conversation.id)
    : undefined;
  const directMessageBlocked = !!(activeDirectMessage?.blocked_by_me || activeDirectMessage?.blocked_me);
  useEffect(() => {
    onConversationChange?.(conversation && conversation.type !== "voice" ? conversation.id : null);
    return () => onConversationChange?.(null);
  }, [conversation?.id, conversation?.type, onConversationChange]);
  const mentionMatch = useMemo(() => matchMention(draft, mentionCaret, state.members.map((member) => ({ id: member.id, username: member.username, displayName: member.displayName }))), [draft, mentionCaret, state.members]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chooseMention = (username: string) => {
    if (!mentionMatch) return;
    const insertion = insertMention(draft, mentionMatch, username);
    setDraft(insertion.value);
    setMentionCaret(-1);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(insertion.caret, insertion.caret);
    });
  };
  const directCallActive = !!(directCall?.state === "accepted" && conversation?.type === "dm" && directCall.direct_message_id === conversation.id);
  useEffect(() => {
    if (!memberPopover) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-member-popover], [data-member-trigger]")) return;
      setMemberPopover(null);
    };
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMemberPopover(null);
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismissWithKeyboard);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismissWithKeyboard);
    };
  }, [memberPopover]);
  useEffect(() => {
    if (!voiceMemberMenu) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("[data-voice-member-menu]")) setVoiceMemberMenu(null);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [voiceMemberMenu]);
  useEffect(() => {
    if (!notificationMenuOpen) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".notification-center")) setNotificationMenuOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [notificationMenuOpen]);
  useEffect(() => {
    stickToBottom.current = true;
    setAwayFromPresent(false);
    setDraft(
      conversation
        ? localStorage.getItem(draftKey(instanceId, conversation.id)) || ""
        : "",
    );
    setEditingMessageId(null);
	setShowPins(false);
	setPinnedMessages(null);
    if (conversation && conversation.type !== "voice") {
      const messages = state.messages[conversation.id] || [];
      historyExhausted.current[conversation.id] = (messages[0]?.sequence || 1) <= 1;
      newerHistoryTruncated.current[conversation.id] = false;
      setMessageWindowStarts((current) => ({ ...current, [conversation.id]: null }));
      const last = messages.at(-1);
      if (last)
        void onAction({
          type: "update_read_position",
          conversationId: conversation.id,
          direct: conversation.type === "dm",
          sequence: last.sequence,
        });
    }
  }, [conversation?.id, instanceId]);
  const voiceChannelIds = channels.filter(({ type }) => type === "voice").map(({ id }) => id);
  const voiceChannelKey = voiceChannelIds.join("\u0000");
  useEffect(() => {
    let current = true;
    const refresh = () => {
      for (const channelId of voiceChannelIds) {
        void onAction({ type: "list_voice_participants", channelId })
          .then((result) => {
            if (!current || result?.type !== "voice_participants") return;
            setVoiceParticipantsByChannel((value) => ({ ...value, [channelId]: result.participants }));
          })
          .catch(() => undefined);
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [voiceChannelKey]);
  const visibleVoiceParticipants = conversation?.type === "voice"
    ? voiceParticipantsByChannel[conversation.id] || []
    : [];
  const visibleMessageCount = conversation ? (state.messages[conversation.id] || []).length : 0;
  useLayoutEffect(() => {
    const list = messageListRef.current;
    if (!list) return;
    if (prependScrollHeight.current !== null) {
      list.scrollTop += list.scrollHeight - prependScrollHeight.current;
      prependScrollHeight.current = null;
      return;
    }
    if (!stickToBottom.current) return;
    list.scrollTop = list.scrollHeight;
  }, [conversation?.id, visibleMessageCount, messageWindowStarts[conversation?.id || ""], state.messages[conversation?.id || ""]?.[0]?.id]);

  const allConversationMessages = conversation ? state.messages[conversation.id] || [] : [];
  const requestedWindowStart = conversation ? messageWindowStarts[conversation.id] : null;
  const messageWindowStart = requestedWindowStart === null || requestedWindowStart === undefined
    ? Math.max(0, allConversationMessages.length - 80)
    : Math.max(0, Math.min(requestedWindowStart, Math.max(0, allConversationMessages.length - 1)));
  const renderedConversationMessages = allConversationMessages.slice(messageWindowStart, messageWindowStart + 80);

  async function loadOlderMessages(): Promise<void> {
    if (!conversation || conversation.type === "voice" || historyLoading.current.has(conversation.id)) return;
    const list = messageListRef.current;
    if (messageWindowStart > 0) {
      prependScrollHeight.current = list?.scrollHeight ?? null;
      setMessageWindowStarts((current) => ({ ...current, [conversation.id]: Math.max(0, messageWindowStart - 50) }));
      return;
    }
    const first = allConversationMessages[0];
    if (!first || first.sequence <= 1 || historyExhausted.current[conversation.id]) return;
    historyLoading.current.add(conversation.id);
    prependScrollHeight.current = list?.scrollHeight ?? null;
    try {
      const result = await onAction({ type: "load_messages", conversationId: conversation.id, direct: conversation.type === "dm", before: first.sequence, limit: 50 });
      if (result?.type !== "messages") return;
      historyExhausted.current[conversation.id] = !result.page.has_more;
      const incoming = result.page.messages.filter((message) => !allConversationMessages.some(({ id }) => id === message.id)).length;
      if (allConversationMessages.length + incoming > 300) newerHistoryTruncated.current[conversation.id] = true;
      setMessageWindowStarts((current) => ({ ...current, [conversation.id]: 0 }));
    } finally {
      historyLoading.current.delete(conversation.id);
    }
  }

  async function loadPresentMessages(): Promise<void> {
    if (!conversation || conversation.type === "voice" || historyLoading.current.has(conversation.id)) return;
    historyLoading.current.add(conversation.id);
    try {
      let after = allConversationMessages.at(-1)?.sequence || 0;
      let hasMore = newerHistoryTruncated.current[conversation.id] || false;
      for (let page = 0; hasMore && after && page < 100; page += 1) {
        const result = await onAction({ type: "load_messages", conversationId: conversation.id, direct: conversation.type === "dm", after, limit: 100 });
        if (result?.type !== "messages" || !result.page.messages.length) break;
        after = result.page.next_after || result.page.messages.at(-1)?.sequence || after;
        hasMore = result.page.has_more;
      }
      newerHistoryTruncated.current[conversation.id] = false;
      stickToBottom.current = true;
      setAwayFromPresent(false);
      setMessageWindowStarts((current) => ({ ...current, [conversation.id]: null }));
      const list = messageListRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    } finally {
      historyLoading.current.delete(conversation.id);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      !conversation ||
      conversation.type === "voice" ||
      (!draft.trim() && attachments.length === 0)
    )
      return;
    const body = draft;
    const attachmentIds: string[] = [];
    for (const file of attachments) {
      const result = await onAction({
        type: "upload_attachment",
        name: file.name,
        contentType: file.type || "application/octet-stream",
        data: new Uint8Array(await file.arrayBuffer()),
      });
      if (result?.type === "attachment")
        attachmentIds.push(result.attachment.id);
    }
    await onAction(
      editingMessageId
        ? { type: "edit_message", messageId: editingMessageId, body }
        : {
            type: "send_message",
            conversationId: conversation.id,
            direct: conversation.type === "dm",
            body,
            attachmentIds,
            ...(replyTo ? { replyTo } : {}),
          },
    );
    setDraft("");
    setEditingMessageId(null);
    setReplyTo(null);
    setAttachments([]);
    localStorage.removeItem(draftKey(instanceId, conversation.id));
  }
  const memberGroups = [
    {
      label: "Owner",
      members: state.members.filter((member) => member.owner),
    },
    {
      label: "Online",
      members: state.members.filter(
        (member) =>
          !member.owner &&
          (state.presence[member.id] || "offline") !== "offline",
      ),
    },
    {
      label: "Offline",
      members: state.members.filter(
        (member) =>
          !member.owner &&
          (state.presence[member.id] || "offline") === "offline",
      ),
    },
  ];
  const showMemberPopover = (memberId: string, bounds: DOMRect) => {
    setMemberActionsOpen(false);
    setMemberPopover({
      memberId,
      left: Math.min(window.innerWidth - 308, Math.max(8, bounds.left)),
      top: Math.min(window.innerHeight - 378, Math.max(8, bounds.bottom + 8)),
    });
  };
  return (
    <div className={`community-shell${settingsView === "community" ? " community-settings-open" : settingsView ? " member-settings-open" : ""}`}>
      <aside className="conversation-sidebar">
        {settingsView && settingsView !== "community" && (
          <>
            <div className="member-settings-heading">Member Settings</div>
            <nav className="member-settings-navigation" aria-label="User settings">
              <button
                aria-current={settingsView === "profile" ? "page" : undefined}
                onClick={() => setSettingsView("profile")}
              >My Account</button>
              <button
                aria-current={settingsView === "voice" ? "page" : undefined}
                onClick={() => setSettingsView("voice")}
              >Voice &amp; Video</button>
              <button
                aria-current={settingsView === "notifications" ? "page" : undefined}
                onClick={() => setSettingsView("notifications")}
              >Notifications</button>
              <button
                type="button"
                aria-current={settingsView === "sessions" ? "page" : undefined}
                onClick={() => {
                  setSettingsView("sessions");
                  void onAction({ type: "list_sessions" }).then((result) => {
                    if (result?.type === "sessions") setSessions(result.sessions);
                  });
                }}
              >Sessions</button>
              <button
                type="button"
                aria-current={settingsView === "safety" ? "page" : undefined}
                onClick={() => {
                  setSettingsView("safety");
                  void onAction({ type: "list_reports" }).then((result) => {
                    if (result?.type === "reports") setReports(result.reports);
                  });
                  if (state.member.owner) void onAction({ type: "list_moderation_records" }).then((result) => {
                    if (result?.type === "moderation_records") setRecords(result.records);
                  });
                }}
              >Safety</button>
              <div className="member-settings-separator" />
              <button type="button" onClick={() => setSettingsView(null)}>Back to Community</button>
            </nav>
          </>
        )}
        <div className="community-switcher">
          <button
            className="community-header"
            type="button"
            aria-haspopup="menu"
            aria-expanded={communityMenuOpen}
            onClick={() => setCommunityMenuOpen((value) => !value)}
          >
            <strong>{state.community.name}</strong>
            <Icon name="chevron-down" />
          </button>
          {communityMenuOpen && (
            <nav className="community-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setRequestedVoiceRoom(null);
                  setConversation(null);
                  setHomeView("community");
                  setSettingsView(null);
                  setCommunityMenuOpen(false);
                }}
              >
                <Icon name="home" />
                Community Home
              </button>
              {state.member.owner && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSettingsView("community");
                    setCommunityMenuOpen(false);
                  }}
                >
                  <Icon name="settings" />
                  Community Settings
                </button>
              )}
            </nav>
          )}
        </div>
        <nav className="conversation-nav" aria-label="Community conversations">
          <button
            className="direct-messages-home"
            type="button"
            onClick={() => {
              setRequestedVoiceRoom(null);
              setConversation(null);
              setHomeView("direct-messages");
              setSettingsView(null);
            }}
          >
            Direct Messages
          </button>
          {state.direct_messages.map((dm) => (
            <button
              type="button"
              key={dm.id}
              aria-label={memberName(dm.other)}
              aria-current={conversation?.id === dm.id ? "page" : undefined}
              onClick={() => {
                setSettingsView(null);
                setConversation({
                  id: dm.id,
                  name: memberName(dm.other),
                  type: "dm",
                });
              }}
            >
              <AuthenticatedImage
                path={dm.other.avatarUrl}
                alt=""
                className="avatar"
                fallback={memberName(dm.other).slice(0, 1).toUpperCase()}
                onAction={onAction}
              />
              <span>{memberName(dm.other)}</span>
              {dm.unread > 0 && <span className="unread">{dm.unread}</span>}
            </button>
          ))}
          {categories.map((category) => (
            <section key={category.id}>
              <h2>{category.name}</h2>
              {channels
                .filter(({ category_id }) => category_id === category.id)
                .sort(byPosition)
                .map((channel) => (
                  <Fragment key={channel.id}>
                  <button
                    type="button"
                    aria-label={channel.name}
                    aria-current={
                      conversation?.id === channel.id ? "page" : undefined
                    }
                    onClick={() => {
                      setSettingsView(null);
                      if (channel.type === "voice" && requestedVoiceRoom !== channel.id) {
                        setRequestedVoiceRoom(channel.id);
                        return;
                      }
                      setConversation({
                        id: channel.id,
                        name: channel.name,
                        type: channel.type,
                        topic:
                          channel.topic ||
                          `${category.name} ${channel.type === "text" ? "Text" : "Voice"} Channel`,
                      });
                    }}
                  >
                    <Icon name={channel.type === "voice" ? "volume" : "hash"} />
                    <span>{channel.name}</span>
                  </button>
                  {channel.type === "voice" && (voiceParticipantsByChannel[channel.id]?.length || 0) > 0 && (
                    <ul className="voice-channel-members" aria-label={`${channel.name} participants`}>
                      {voiceParticipantsByChannel[channel.id].map((participant) => {
                        const member = state.members.find(({ id }) => id === participant.member_id);
                        const name = member ? memberName(member) : "Member";
                        return <li
                          className={participant.speaking ? "speaking" : ""}
                          key={participant.member_id}
                          role="button"
                          aria-label={`${name} voice participant`}
                          tabIndex={0}
                          onClick={(event) => showMemberPopover(participant.member_id, event.currentTarget.getBoundingClientRect())}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setVoiceMemberMenu({
                              participant,
                              left: Math.min(window.innerWidth - 224, event.clientX),
                              top: Math.min(window.innerHeight - 250, event.clientY),
                            });
                          }}
                        >
                          <AuthenticatedImage path={member?.avatarUrl} alt="" className="avatar" fallback={name.slice(0, 1).toUpperCase()} onAction={onAction} />
                          <span>{name}</span>
                          {(participant.muted || participant.server_muted) && <small>Muted</small>}
                        </li>;
                      })}
                    </ul>
                  )}
                  </Fragment>
                ))}
            </section>
          ))}
        </nav>
        <div id="desktop-call-controls" />
        <footer className="member-panel">
          <div className="member-menu-anchor">
            <button className="member-summary" type="button" aria-label="Open Member menu" aria-haspopup="menu" aria-expanded={memberMenuOpen} onClick={() => setMemberMenuOpen((value) => !value)}>
              <span className="member-summary-avatar">
                <AuthenticatedImage path={state.member.avatarUrl} alt="" className="avatar" fallback={memberName(state.member).slice(0, 1).toUpperCase()} onAction={onAction} />
                <span className={`presence-dot ${presenceOverride || state.presence[state.member.id] || "offline"}`} />
              </span>
              <span className="member-identity"><strong>{memberName(state.member)}</strong><small>@{state.member.username}</small></span>
            </button>
            {memberMenuOpen && <nav className="desktop-member-menu" role="menu" aria-label="Presence status">
              <button type="button" role="menuitem" onClick={() => { setPresenceOverride("online"); setMemberMenuOpen(false); void onAction({ type: "set_presence", mode: "available" }); }}><span className="presence-choice online" />Online</button>
              <button type="button" role="menuitem" onClick={() => { setPresenceOverride("dnd"); setMemberMenuOpen(false); void onAction({ type: "set_presence", mode: "dnd" }); }}><span className="presence-choice dnd" />Do Not Disturb</button>
            </nav>}
          </div>
          <button
            type="button"
            aria-label="User Settings"
            onClick={() => setSettingsView("profile")}
          >
            <Icon name="settings" />
          </button>
        </footer>
      </aside>
      <section className="conversation-content">
        <header>
          <h1>
            {!settingsView && conversation?.type === "text" && (
              <Icon name="hash" />
            )}
            {!settingsView && conversation?.type === "voice" && (
              <Icon name="volume" />
            )}
            {settingsView === "community"
              ? communitySettingsSection === "dashboard" ? "Admin Dashboard" : "Community Settings"
              : settingsView === "profile"
                ? "My Account"
                : settingsView === "voice"
                  ? "Voice & Video"
                  : settingsView === "notifications"
                    ? "Notifications"
                    : settingsView === "sessions"
                      ? "Sessions"
                      : settingsView === "safety"
                        ? "Safety"
                : conversation?.name || (homeView === "direct-messages" ? "Direct Messages" : "Home")}
          </h1>
          {conversation?.type === "text" && conversation.topic && (
            <span className="channel-topic">{conversation.topic}</span>
          )}
          {conversation?.type === "voice" && (
            <span className="media-stage-status">Voice Room</span>
          )}
          <div className="header-actions">
            {activeDirectMessage && (
              <button
                className="header-button"
                type="button"
                onClick={() => void onAction({
                  type: "set_block",
                  memberId: activeDirectMessage.other.id,
                  blocked: !activeDirectMessage.blocked_by_me,
                })}
              >
                {activeDirectMessage.blocked_by_me ? "Unblock" : "Block"}
              </button>
            )}
            <DirectCallControls
              conversation={directMessageBlocked ? null : conversation}
              directCallNames={Object.fromEntries(state.direct_messages.map((directMessage) => [directMessage.id, directMessage.other.displayName || directMessage.other.username]))}
              currentMemberId={state.member.id}
              instanceId={instanceId}
              onAction={onAction}
              connectMedia={connectMedia}
              requestedVoiceRoom={requestedVoiceRoom}
              requestedVoiceRoomName={channels.find(({ id }) => id === requestedVoiceRoom)?.name || "Voice Channel"}
              onOpenDirectCall={(directMessageId) => {
                const directMessage = state.direct_messages.find(({ id }) => id === directMessageId);
                if (!directMessage) return;
                setSettingsView(null);
                setHomeView("direct-messages");
                setConversation({ id: directMessage.id, name: memberName(directMessage.other), type: "dm" });
              }}
              onVoiceRoomChange={(roomId) => {
                const previousRoom = requestedVoiceRoom;
                setRequestedVoiceRoom(roomId);
                if (!roomId && previousRoom) {
                  setVoiceParticipantsByChannel((current) => ({
                    ...current,
                    [previousRoom]: (current[previousRoom] || []).filter(({ member_id }) => member_id !== state.member.id),
                  }));
                }
              }}
              onCallChange={setDirectCall}
            />
            {state.connection === "offline" && (
              <span className="offline-badge">Offline</span>
            )}
            {conversation && conversation.type !== "voice" && (
              <div className="notification-center">
                <button
                  className="header-button icon-button"
                  type="button"
                  aria-label="Notifications"
                  aria-expanded={notificationMenuOpen}
                  onClick={() => setNotificationMenuOpen((value) => !value)}
                >
                  <Icon name="bell" />
                </button>
                {notificationMenuOpen && (
                  <section className="notification-popover" aria-label="Notification settings">
                    <h2>Notifications</h2>
                    <label>
                      Community
                      <select
                        aria-label="Community notification level"
                        defaultValue={state.notifications.community.level}
                        onChange={(event) => void onAction({
                          type: "set_community_notifications",
                          level: event.target.value as "all_messages" | "mentions_only" | "nothing",
                          muted: state.notifications.community.muted,
                          soundEnabled: state.notifications.community.sound_enabled ?? true,
                        })}
                      >
                        <option value="all_messages">All Messages</option>
                        <option value="mentions_only">Mentions Only</option>
                        <option value="nothing">Nothing</option>
                      </select>
                    </label>
                    <label className="notification-check">
                      <input
                        type="checkbox"
                        defaultChecked={state.notifications.community.muted}
                        onChange={(event) => void onAction({
                          type: "set_community_notifications",
                          level: state.notifications.community.level === "default" ? "all_messages" : state.notifications.community.level,
                          muted: event.target.checked,
                          soundEnabled: state.notifications.community.sound_enabled ?? true,
                        })}
                      />
                      Mute Community
                    </label>
                    <label className="notification-check">
                      <input
                        type="checkbox"
                        defaultChecked={state.notifications.community.sound_enabled ?? true}
                        onChange={(event) => void onAction({
                          type: "set_community_notifications",
                          level: state.notifications.community.level === "default" ? "all_messages" : state.notifications.community.level,
                          muted: state.notifications.community.muted,
                          soundEnabled: event.target.checked,
                        })}
                      />
                      Notification sound
                    </label>
                    <label>
                      This conversation
                      <select
                        aria-label="Conversation notification level"
                        defaultValue={state.notifications.channels[conversation.id]?.level || "default"}
                        onChange={(event) => void onAction({
                          type: "set_channel_notifications",
                          channelId: conversation.id,
                          level: event.target.value as "default" | "all_messages" | "mentions_only" | "nothing",
                          muted: state.notifications.channels[conversation.id]?.muted || false,
                        })}
                      >
                        <option value="default">Default</option>
                        <option value="all_messages">All Messages</option>
                        <option value="mentions_only">Mentions Only</option>
                        <option value="nothing">Nothing</option>
                      </select>
                    </label>
                    <label className="notification-check">
                      <input
                        type="checkbox"
                        defaultChecked={state.notifications.channels[conversation.id]?.muted || false}
                        onChange={(event) => void onAction({
                          type: "set_channel_notifications",
                          channelId: conversation.id,
                          level: state.notifications.channels[conversation.id]?.level || "default",
                          muted: event.target.checked,
                        })}
                      />
                      Mute conversation
                    </label>
                  </section>
                )}
              </div>
            )}
            {conversation?.type === "text" && (
              <button
                className="header-button icon-button"
                type="button"
                aria-label="Pinned Messages"
                title="Pinned Messages"
				onClick={() => {
				  if (showPins) { setShowPins(false); return; }
				  void onAction({ type: "list_pins", channelId: conversation.id }).then((result) => {
					if (result?.type === "messages") { setPinnedMessages(result.page.messages); setShowPins(true); }
				  });
				}}
              >
                <Icon name="pin" />
              </button>
            )}
            {!settingsView && homeView === "community" && (!conversation || conversation.type === "text") && (
              <button
                className="header-button icon-button"
                type="button"
                aria-label={membersOpen ? "Hide Members" : "Show Members"}
                title="Members"
                aria-pressed={membersOpen}
                onClick={() => setMembersOpen((value) => !value)}
              >
                <Icon name="users" />
              </button>
            )}
            <form
              className="header-search"
              role="search"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSearchFiltersOpen(false);
              }}
              onSubmit={(event) => {
                event.preventDefault();
                const query = String(
                  new FormData(event.currentTarget).get("query") || "",
                );
                setSearchFiltersOpen(false);
                void onAction({ type: "search_messages", query }).then(
                  (result) => {
                    if (result?.type === "search_results")
                      setSearchResults(result.results);
                  },
                );
              }}
            >
              <Icon name="search" />
              <input
                name="query"
                type="search"
                aria-label="Search Messages"
                placeholder={settingsView ? "Search Community" : "Search"}
                maxLength={200}
                required
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onFocus={() => setSearchFiltersOpen(true)}
              />
              {searchFiltersOpen && <div className="search-filter-menu" role="menu" aria-label="Search filters">{[["from:", "From a specific user"], ["in:", "Sent in a specific channel"], ["has:file", "Includes a file"], ["has:image", "Includes an image"], ["has:link", "Includes a link"], ["mentions:", "Mentions a specific user"], ["before:", "Sent before a date"], ["after:", "Sent after a date"]].map(([token, label]) => <button type="button" role="menuitem" key={token} onMouseDown={(event) => event.preventDefault()} onClick={() => { setSearchQuery((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${token}`); }}><strong>{label}</strong><small>{token}{token.endsWith(":") ? "…" : ""}</small></button>)}</div>}
            </form>
          </div>
        </header>
        {settingsView && !searchResults ? settingsView === "community" ? (
          <div className="community-settings-layout">
            <CommunityAdministration state={state} onAction={onAction} onSectionChange={setCommunitySettingsSection} />
          </div>
        ) : (
          <div className="settings-layout">
            <section className="settings-content">
              {settingsView === "profile" && <>
              <h2>Profile</h2>
              <p className="settings-description">Control how other Members recognize you.</p>
              <ProfileImages member={state.member} onAction={onAction} />
              <form
                className="profile-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void onAction({
                    type: "update_profile",
                    username: String(data.get("username") || ""),
                    displayName: String(data.get("displayName") || ""),
                  });
                }}
              >
                <label>
                  Username
                  <input
                    name="username"
                    defaultValue={state.member.username}
                    required
                  />
                </label>
                <label>
                  Display Name
                  <input
                    name="displayName"
                    defaultValue={state.member.displayName || ""}
                  />
                </label>
                <button type="submit">Save Profile</button>
              </form>
              <div className="presence-controls">
                <strong>Presence</strong>
                <button
                  type="button"
                  onClick={() =>
                    void onAction({ type: "set_presence", mode: "available" })
                  }
                >
                  Online
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void onAction({ type: "set_presence", mode: "dnd" })
                  }
                >
                  Do Not Disturb
                </button>
              </div>
              </>}
              {settingsView === "voice" && (
                <VoiceVideoSettings memberId={state.member.id} />
              )}
              {settingsView === "notifications" && (
                <NotificationSettings
                  state={state}
                  onAction={onAction}
                />
              )}
              {settingsView === "sessions" && (
                <section className="session-list">
                  <h2>Sessions</h2>
                  {!sessions && <p>Loading Sessions…</p>}
                  {sessions?.map((session) => (
                    <article key={session.id}>
                      <span>
                        <strong>{session.device}</strong>
                        <small>
                          {session.current
                            ? "Current Session"
                            : `Active ${session.last_activity}`}
                        </small>
                      </span>
                      {!session.current && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm(`Revoke the Session on ${session.device}?`)) return;
                            void onAction({
                              type: "revoke_session",
                              sessionId: session.id,
                            }).then(() =>
                              setSessions(
                                (current) =>
                                  current?.filter(
                                    ({ id }) => id !== session.id,
                                  ) || null,
                              ),
                            );
                          }}
                        >
                          Revoke
                        </button>
                      )}
                    </article>
                  ))}
                </section>
              )}
              {settingsView === "safety" && (
                <section className="settings-panel">
                  <h2>Safety</h2>
                  {!reports && <p>Loading Safety information…</p>}
              {reports && (
                <SafetyPanel
                  reports={reports}
                  records={records}
                  members={state.members}
                  onAction={onAction}
                  onReports={setReports}
                />
              )}
                </section>
              )}
            </section>
          </div>
        ) : searchResults ? (
          <div className="search-results">
            <h2>Search Results</h2>
            <button type="button" onClick={() => setSearchResults(null)}>
              Close Search
            </button>
            {searchResults.length ? (
              searchResults.map((result) => (
                <article key={result.message.id}>
                  <strong>
                    #{result.channel_name} · {result.message.author_name}
                  </strong>
                  <p>{result.snippet}</p>
                </article>
              ))
            ) : (
              <p>No results found.</p>
            )}
          </div>
        ) : conversation ? (
          conversation.type === "voice" ? (
            <section className="media-stage">
              <div className="media-stage-grid" data-tile-count={visibleVoiceParticipants.length}>
                {visibleVoiceParticipants.length === 0 ? (
                  <p className="media-stage-empty">No one is connected to this Voice Room.</p>
                ) : visibleVoiceParticipants.map((participant) => {
                  const member = state.members.find(({ id }) => id === participant.member_id);
                  const name = member ? memberName(member) : "Member";
                  return <article className={`media-stage-tile participant-tile ${participant.speaking ? "speaking" : ""}`} data-media-member-id={participant.member_id} key={participant.member_id} onContextMenu={(event) => {
                    event.preventDefault();
                    setVoiceMemberMenu({ participant, left: Math.min(window.innerWidth - 224, event.clientX), top: Math.min(window.innerHeight - 280, event.clientY) });
                  }}>
                    <div className="media-stage-visual"><AuthenticatedImage path={member?.avatarUrl} alt="" className="media-stage-avatar" fallback={name.slice(0, 1).toUpperCase()} onAction={onAction} /></div>
                    <strong>{name}</strong>
                    {participant.screen_sharing && <span>Sharing screen</span>}
                  </article>;
                })}
              </div>
            </section>
          ) : (
            <section className={directCallActive ? "conversation-workspace direct-call-workspace" : "conversation-workspace"}>
              {directCallActive && (
                <section className="media-stage direct-call-stage" aria-label="Direct Call grid">
                  <div className="media-stage-grid" data-tile-count={2}>
                    {[state.member, activeDirectMessage?.other].filter((member): member is import("../shared/desktop-bridge").MemberSummary => Boolean(member)).map((participant) => {
                      const name = memberName(participant);
                      return <article className="media-stage-tile participant-tile" data-media-member-id={participant.id} key={participant.id} onContextMenu={(event) => {
                        if (participant.id === state.member.id || !directCall) return;
                        event.preventDefault();
                        setVoiceMemberMenu({
                          directCall: true,
                          participant: { member_id: participant.id, room_id: directCall.id, connected: true, joined_at: directCall.created_at, server_muted: false, muted: false, speaking: false, screen_sharing: false },
                          left: Math.min(window.innerWidth - 224, event.clientX),
                          top: Math.min(window.innerHeight - 280, event.clientY),
                        });
                      }}>
                        <div className="media-stage-visual"><AuthenticatedImage path={participant.avatarUrl} alt="" className="media-stage-avatar" fallback={name.slice(0, 1).toUpperCase()} onAction={onAction} /></div>
                        <strong>{participant.id === state.member.id ? "You" : name}</strong>
                      </article>;
                    })}
                  </div>
                </section>
              )}
            <div
              className={directCallActive ? "message-list direct-call-chat" : "message-list"}
              aria-label={`${conversation.name} Messages`}
              ref={messageListRef}
              onLoadCapture={() => {
                const list = messageListRef.current;
                if (!list || !stickToBottom.current) return;
                list.scrollTop = list.scrollHeight;
                requestAnimationFrame(() => { if (stickToBottom.current) list.scrollTop = list.scrollHeight; });
              }}
              onLoadedMetadataCapture={() => {
                const list = messageListRef.current;
                if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
              }}
              onScroll={(event) => {
                const list = event.currentTarget;
                stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 72;
                setAwayFromPresent(!stickToBottom.current);
                if (list.scrollTop < 80) void loadOlderMessages();
                if (stickToBottom.current && requestedWindowStart !== null && requestedWindowStart !== undefined) {
                  const nextStart = Math.min(Math.max(0, allConversationMessages.length - 80), messageWindowStart + 50);
                  if (nextStart !== messageWindowStart) setMessageWindowStarts((current) => ({ ...current, [conversation.id]: nextStart }));
                  else if (newerHistoryTruncated.current[conversation.id]) void loadPresentMessages();
                }
              }}
            >
			  {(showPins ? (pinnedMessages || []) : renderedConversationMessages)
                .map((message) => (
                  <article className="message" key={message.id}>
                    <AuthenticatedImage
                      path={message.author_avatar_url}
                      alt=""
                      className="avatar"
                      fallback={message.author_name.slice(0, 1).toUpperCase()}
                      onAction={onAction}
                    />
                    <div>
                      <strong>{message.author_name}</strong>
                      <time dateTime={message.created_at}>
                        {formatMessageTime(message.created_at)}
                      </time>
                      {message.reply && (
                        <blockquote>
                          Replying to {message.reply.author_name}:{" "}
                          {message.reply.deleted
                            ? "Message deleted"
                            : message.reply.body}
                        </blockquote>
                      )}
                      <div className="message-body">{message.deleted ? "Message deleted" : <MessageBody body={message.body || ""} mentions={message.mentions || []} />}</div>
                      {message.body && (
                        <LinkPreview body={message.body} onAction={onAction} />
                      )}
                      {message.attachments?.map((attachment) => (
                        <AttachmentView
                          attachment={attachment}
                          key={attachment.id}
                          onAction={onAction}
                        />
                      ))}
                      {message.reactions?.map((reaction) => (
                        <button
                          className="reaction"
                          key={reaction.emoji}
                          aria-pressed={reaction.me}
                          onClick={() =>
                            void onAction({
                              type: "set_reaction",
                              messageId: message.id,
                              emoji: reaction.emoji,
                              active: !reaction.me,
                            })
                          }
                        >
                          {reaction.emoji} {reaction.count}
                        </button>
                      ))}
                      {message.pinned && <span className="pinned">Pinned</span>}
                      {!message.deleted && (
                        <span className="message-actions">
                          <button
                            type="button"
                            onClick={() => setReplyTo(message.id)}
                          >
                            Reply
                          </button>
                          <button
                            type="button"
                            data-reaction-trigger
                            aria-haspopup="menu"
                            aria-expanded={reactionPickerMessageId === message.id}
                            onClick={() => setReactionPickerMessageId((current) => current === message.id ? null : message.id)}
                          >
                            React
                          </button>
                          {reactionPickerMessageId === message.id && (
                            <EmojiPicker
                              reactions={message.reactions || []}
                              onSelect={(emoji, active) => {
                                void onAction({ type: "set_reaction", messageId: message.id, emoji, active });
                                setReactionPickerMessageId(null);
                              }}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              void onAction({
                                type: "set_pinned",
                                messageId: message.id,
                                active: !message.pinned,
                              })
                            }
                          >
                            {message.pinned ? "Unpin" : "Pin"}
                          </button>
                          {message.author_id !== state.member.id && (
                            <button
                              type="button"
                              onClick={() => {
                                const reason = window.prompt(
                                  "Why are you reporting this Message?",
                                );
                                if (reason)
                                  void onAction({
                                    type: "create_report",
                                    targetMessageId: message.id,
                                    reason,
                                  });
                              }}
                            >
                              Report
                            </button>
                          )}
                          {message.author_id === state.member.id && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setDraft(message.body || "");
                                  setEditingMessageId(message.id);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void onAction({
                                    type: "delete_message",
                                    messageId: message.id,
                                    conversationId: conversation.id,
                                  })
                                }
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              {awayFromPresent && (
                <button
                  className="jump-to-present"
                  type="button"
                  onClick={() => {
                    void loadPresentMessages();
                  }}
                >
                  Jump to present
                </button>
              )}
              {directMessageBlocked && (
                <div className="blocked-conversation">
                  {activeDirectMessage?.blocked_by_me
                    ? "You blocked this Member. Unblock them to send Messages."
                    : "This Member is not accepting Messages."}
                </div>
              )}
              {!directMessageBlocked && <div className="message-composer-wrap">
                <form
                className={`message-composer${draggingFiles ? " file-drag-active" : ""}`}
                onSubmit={(event) => void sendMessage(event)}
                onDragEnter={(event) => { event.preventDefault(); if (event.dataTransfer.types.includes("Files")) setDraggingFiles(true); }}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFiles(false); }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDraggingFiles(false);
                  const files = [...event.dataTransfer.files];
                  if (files.length) setAttachments((current) => appendUniqueFiles(current, files));
                }}
              >
                {replyTo && (
                  <div className="composer-context">
                    Replying to a Message{" "}
                    <button type="button" onClick={() => setReplyTo(null)}>
                      Cancel
                    </button>
                  </div>
                )}
                {editingMessageId && (
                  <div className="composer-context">
                    Editing Message{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMessageId(null);
                        setDraft("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  aria-label={`Message ${conversation.name}`}
                  placeholder={`Message #${conversation.name}`}
                  value={draft}
                  onKeyDown={(event) => {
                    if (mentionMatch) {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        setMentionIndex((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + mentionMatch.members.length) % mentionMatch.members.length);
                        return;
                      }
                      if (event.key === "Tab" || event.key === "Enter") {
                        event.preventDefault();
                        chooseMention(mentionMatch.members[Math.min(mentionIndex, mentionMatch.members.length - 1)].username);
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setMentionCaret(-1);
                        return;
                      }
                    }
                    if (event.key === "ArrowUp" && !draft && !editingMessageId && !replyTo) {
                      const message = mostRecentEditableMessage(allConversationMessages, state.member.id);
                      if (message) {
                        event.preventDefault();
                        setDraft(message.body || "");
                        setEditingMessageId(message.id);
                        requestAnimationFrame(() => {
                          const input = textareaRef.current;
                          if (input) input.setSelectionRange(input.value.length, input.value.length);
                        });
                        return;
                      }
                    }
                    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setMentionCaret(event.target.selectionStart);
                    setMentionIndex(0);
                    localStorage.setItem(
                      draftKey(instanceId, conversation.id),
                      event.target.value,
                    );
                    if (Date.now() - lastTypingAt.current > 3_000) {
                      lastTypingAt.current = Date.now();
                      void onAction({
                        type: "send_typing",
                        conversationId: conversation.id,
                      });
                    }
                  }}
                  onPaste={(event) => {
                    const files = [...event.clipboardData.items]
                      .filter((item) => item.kind === "file")
                      .map((item) => item.getAsFile())
                      .filter((file): file is File => Boolean(file));
                    if (!files.length) return;
                    event.preventDefault();
                    setAttachments((current) => appendUniqueFiles(current, files));
                  }}
                  onClick={(event) => setMentionCaret(event.currentTarget.selectionStart)}
                  onKeyUp={(event) => {
                    if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) setMentionCaret(event.currentTarget.selectionStart);
                  }}
                />
                {mentionMatch && <div className="mention-suggestions" role="listbox" aria-label="Mention a Member">{mentionMatch.members.map((member, index) => <button type="button" role="option" aria-selected={index === mentionIndex} key={member.id} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseMention(member.username)}><strong>{member.displayName || member.username}</strong><small>@{member.username}</small></button>)}</div>}
                <label className="attach-button">
                  <Icon name="paperclip" />
                  <span className="sr-only">Attach</span>
                  <input
                    type="file"
                    multiple
                    onChange={(event) =>
                      setAttachments((current) => appendUniqueFiles(current, [...(event.target.files || [])]))
                    }
                  />
                </label>
                {attachments.length > 0 && <AttachmentPreviewList files={attachments} onRemove={(index) => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} />}
                </form>
                <small className="typing-indicator" aria-live="polite">{typingSummary(state.typing.filter((item) => item.channel_id === conversation.id && item.member_id !== state.member.id).map((item) => item.member_name))}</small>
              </div>}
            </div>
            </section>
          )
        ) : homeView === "direct-messages" ? (
          <section className="dm-home">
            <div>
              <p className="eyebrow">Your conversations</p>
              <h2>Direct Messages</h2>
              <p>Choose a conversation from the sidebar, or start one with another Member.</p>
              <form
                className="dm-start-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!directMessageMemberId) return;
                  void onAction({ type: "open_dm", memberId: directMessageMemberId }).then((result) => {
                    if (result?.type !== "direct_message") return;
                    setConversation({
                      id: result.directMessage.id,
                      name: memberName(result.directMessage.other),
                      type: "dm",
                    });
                    setDirectMessageMemberId("");
                  });
                }}
              >
                <label>
                  Start a Direct Message
                  <select
                    aria-label="Start a Direct Message"
                    required
                    value={directMessageMemberId}
                    onChange={(event) => setDirectMessageMemberId(event.target.value)}
                  >
                    <option value="">Choose a Member</option>
                    {state.members.filter(({ id }) => id !== state.member.id).map((member) => (
                      <option value={member.id} key={member.id}>
                        {memberName(member)} (@{member.username})
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit">Open DM</button>
              </form>
            </div>
          </section>
        ) : (
          <div className="welcome">
            <p className="eyebrow">{state.community.name}</p>
            {communityGuide === null ? <p>Loading Community Guide…</p> : communityGuide ? <article className="community-guide" aria-label="Community Guide"><MarkdownContent value={communityGuide} /></article> : <><h2>Welcome, {memberName(state.member)}</h2><p>Select a Text Channel or Direct Message to start chatting.</p></>}
          </div>
        )}
      </section>
      {membersOpen && !settingsView && homeView === "community" && (!conversation || conversation.type === "text") && (
        <aside className="member-directory" aria-label="Members">
          {memberGroups.map((group) => (
            <section className="member-directory-group" key={group.label}>
              <h2>{group.label} — {group.members.length}</h2>
              {group.members.map((member) => (
                <button
                  type="button"
                  key={member.id}
                  data-member-trigger
                  onClick={(event) => {
                    showMemberPopover(member.id, event.currentTarget.getBoundingClientRect());
                  }}
                >
                  <span className="member-directory-avatar">
                    <AuthenticatedImage
                      path={member.avatarUrl}
                      alt=""
                      className="avatar"
                      fallback={memberName(member).slice(0, 1).toUpperCase()}
                      onAction={onAction}
                    />
                    <span
                      className={`presence-dot ${state.presence[member.id] || "offline"}`}
                    />
                  </span>
                  <span>{memberName(member)}</span>
                  <small>{member.owner ? "Owner" : `@${member.username}`}</small>
                </button>
              ))}
            </section>
          ))}
        </aside>
      )}
      {memberPopover &&
        (() => {
          const member = state.members.find(
            ({ id }) => id === memberPopover.memberId,
          );
          if (!member) return null;
          const dm = state.direct_messages.find(
            ({ other }) => other.id === member.id,
          );
          return createPortal(
            <section
              className="member-card"
              role="dialog"
              aria-label="Member profile"
              data-member-popover
              style={{
                position: "fixed",
                left: memberPopover.left,
                top: memberPopover.top,
              }}
            >
              <div className="member-card-banner">
                <AuthenticatedImage
                  path={member.bannerUrl}
                  alt=""
                  className="member-banner"
                  onAction={onAction}
                />
                {member.id !== state.member.id && <button className="member-card-more" type="button" aria-label="Member actions" aria-expanded={memberActionsOpen} onClick={() => setMemberActionsOpen((open) => !open)}>•••</button>}
              </div>
              <div className="member-card-body">
                <AuthenticatedImage
                  path={member.avatarUrl}
                  alt=""
                  className="member-card-avatar"
                  onAction={onAction}
                />
                <h3>{memberName(member)}</h3>
			    <p>@{member.username}{member.disabled ? " · Disabled" : ""}</p>
              </div>
              {member.id !== state.member.id && (
                <div className="member-card-actions" role="group" aria-label="Member actions" hidden={!memberActionsOpen}>
                  <button
                    type="button"
                    onClick={() =>
                      void onAction({
                        type: "open_dm",
                        memberId: member.id,
                      }).then((result) => {
                        if (result?.type === "direct_message") {
                          setConversation({
                            id: result.directMessage.id,
                            name: memberName(result.directMessage.other),
                            type: "dm",
                          });
                          setMembersOpen(false);
                          setMemberPopover(null);
                        }
                      })
                    }
                  >
                    Message
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() =>
                      void onAction({
                        type: "set_block",
                        memberId: member.id,
                        blocked: !dm?.blocked_by_me,
                      })
                    }
                  >
                    {dm?.blocked_by_me ? "Unblock" : "Block"}
                  </button>
				  {state.member.owner && !member.owner && <>
					<button type="button" onClick={() => void onAction({ type: "set_member_disabled", memberId: member.id, disabled: !member.disabled }).then(() => setMemberPopover(null))}>{member.disabled ? "Restore" : "Disable"}</button>
					<button className="danger-button" type="button" onClick={() => { const confirmation = window.prompt(`Permanently delete ${memberName(member)} and everything tied to this Member? Type understood to continue.`); if (confirmation !== "understood") return; void onAction({ type: "delete_member", memberId: member.id, confirmation }).then(() => setMemberPopover(null)); }}>Delete Member</button>
				  </>}
                </div>
              )}
            </section>,
            document.body,
          );
        })()}
      {voiceMemberMenu && createPortal((() => {
        const member = state.members.find(({ id }) => id === voiceMemberMenu.participant.member_id);
        if (!member) return <></>;
        const participant = voiceMemberMenu.participant;
        const preferences = loadDesktopVoicePreferences(state.member.id);
        const memberVolume = preferences.memberVolumes[member.id] ?? 1;
        return <nav
          className="voice-member-context"
          role="menu"
          aria-label="Voice Member actions"
          data-voice-member-menu
          style={{ position: "fixed", left: voiceMemberMenu.left, top: voiceMemberMenu.top }}
        >
          {member.id !== state.member.id && <label className="voice-member-volume">
            <span><Icon name="volume" /> {memberName(member)} volume</span>
            <output>{Math.round(memberVolume * 100)}%</output>
            <input aria-label={`${memberName(member)} volume`} type="range" min="0" max="1" step="0.05" value={memberVolume} onChange={(event) => {
              const next = Number(event.target.value);
              saveDesktopVoicePreferences(state.member.id, { ...preferences, memberVolumes: { ...preferences.memberVolumes, [member.id]: next } });
              setVoiceMemberMenu((current) => current ? { ...current } : null);
            }} />
          </label>}
          <button type="button" role="menuitem" onClick={() => {
            showMemberPopover(member.id, new DOMRect(voiceMemberMenu.left, voiceMemberMenu.top, 0, 0));
            setVoiceMemberMenu(null);
          }}>Profile</button>
          {member.id !== state.member.id && <button type="button" role="menuitem" onClick={() => void onAction({ type: "open_dm", memberId: member.id }).then((result) => {
            if (result?.type === "direct_message") setConversation({ id: result.directMessage.id, name: memberName(result.directMessage.other), type: "dm" });
            setVoiceMemberMenu(null);
          })}>Message</button>}
          {!voiceMemberMenu.directCall && state.member.owner && member.id !== state.member.id && <>
            <button type="button" role="menuitem" onClick={() => {
              void onAction({ type: "moderate_voice_participant", roomId: participant.room_id, memberId: member.id, action: participant.server_muted ? "unmute" : "mute" });
              setVoiceMemberMenu(null);
            }}>{participant.server_muted ? "Server Unmute" : "Server Mute"}</button>
            <button className="danger-text" type="button" role="menuitem" onClick={() => {
              void onAction({ type: "moderate_voice_participant", roomId: participant.room_id, memberId: member.id, action: "disconnect" });
              setVoiceMemberMenu(null);
            }}>Disconnect</button>
          </>}
          <button type="button" role="menuitem" onClick={() => {
            void navigator.clipboard.writeText(member.id);
            setVoiceMemberMenu(null);
          }}>Copy User ID</button>
        </nav>;
      })(), document.body)}
    </div>
  );
}

export function DirectCallControls({
  conversation,
  directCallNames = {},
  currentMemberId,
  instanceId,
  onAction,
  connectMedia,
  requestedVoiceRoom,
  requestedVoiceRoomName,
  onOpenDirectCall,
  onVoiceRoomChange,
  onCallChange,
}: {
  conversation: { id: string; name?: string; type: "text" | "voice" | "dm" } | null;
  directCallNames?: Record<string, string>;
  currentMemberId: string;
  instanceId: string;
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
  connectMedia?: DesktopBridge["connectMedia"];
  requestedVoiceRoom: string | null;
  requestedVoiceRoomName: string;
  onOpenDirectCall?(directMessageId: string): void;
  onVoiceRoomChange(roomId: string | null): void;
  onCallChange(call: import("../shared/instance-actions").DirectCall | null): void;
}) {
  const [call, setCall] = useState<import("../shared/instance-actions").DirectCall | null>(null);
  const [status, setStatus] = useState("");
  const transientStatus = useRef<ReturnType<typeof createTransientCallStatusController> | null>(null);
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const [sounds, setSounds] = useState<import("../shared/instance-actions").SoundboardSound[]>([]);
  const [outputVolume, setOutputVolume] = useState(() => loadDesktopVoicePreferences(currentMemberId).outputVolume);
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [remoteScreens, setRemoteScreens] = useState<Record<string, MediaStream>>({});
  const [voiceRoom, setVoiceRoom] = useState<string | null>(null);
  const voiceRoomRef = useRef<string | null>(null);
  const media = useRef<{ stream: MediaStream; capture: DesktopMicrophoneCapture; peer: RTCPeerConnection; socket: import("../shared/desktop-bridge").DesktopMediaConnection; audio: Map<string, HTMLAudioElement[]>; screen?: MediaStream; screenSender?: RTCRtpSender; screenAudioSenders: RTCRtpSender[] } | null>(null);
  const connectingRoom = useRef<string | null>(null);
  const heartbeat = useRef<number | null>(null);
  const connectionTimeout = useRef<number | null>(null);
  const mediaFailure = useRef("");
  transientStatus.current ||= createTransientCallStatusController(setStatus, () => media.current?.peer.connectionState === "connected" ? "Call connected" : null);

  const cleanup = () => {
    transientStatus.current?.clear();
    const active = media.current;
    media.current = null;
    active?.socket.send({ version: 1, type: "leave" });
    active?.socket.close();
    active?.peer.close();
    active?.capture.stop();
    active?.screen?.getTracks().forEach((track) => track.stop());
    active?.audio.forEach((elements) => elements.forEach((element) => element.remove()));
    if (heartbeat.current !== null) window.clearInterval(heartbeat.current);
    heartbeat.current = null;
    if (connectionTimeout.current !== null) window.clearTimeout(connectionTimeout.current);
    connectionTimeout.current = null;
    connectingRoom.current = null;
    setMuted(false);
    setSharing(false);
    setLocalScreen(null);
    setRemoteScreens({});
    setSoundboardOpen(false);
  };

  async function connect(activeCall: import("../shared/instance-actions").DirectCall): Promise<void> {
    if (media.current || connectingRoom.current || !connectMedia) return;
    connectingRoom.current = activeCall.id;
    mediaFailure.current = "";
    let provisionalCapture: DesktopMicrophoneCapture | null = null;
    try {
    setStatus("Requesting microphone permission…");
    const capture = await captureDesktopMicrophone(currentMemberId);
    const stream = capture.stream;
    provisionalCapture = capture;
    if (capture.compatibilityNotice) setStatus(capture.compatibilityNotice);
    const credentials = await onAction({ type: "turn_credentials" });
    if (credentials?.type !== "turn_credentials") throw new Error("TURN credentials unavailable.");
    const peer = new RTCPeerConnection({ iceServers: credentials.iceServers });
    const audio = new Map<string, HTMLAudioElement[]>();
    const pendingCandidates: RTCIceCandidateInit[] = [];
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.addTransceiver("audio", { direction: "sendrecv" });
    peer.addTransceiver("video", { direction: "recvonly" });
    let socket: import("../shared/desktop-bridge").DesktopMediaConnection | null = null;
    peer.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const encoded = candidate.toJSON();
      if (socket) socket.send({ version: 1, type: "candidate", candidate: encoded });
      else pendingCandidates.push(encoded);
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer);
    const signaling = createMediaFrameQueue(peer, (frame) => socket?.send(frame), {
      onAnswer: () => setStatus("Finishing media connection…"),
    });
    socket = await connectMedia(instanceId, (value) => {
      const frame = value as DesktopMediaFrame & { sound_url?: string };
      if (frame.type === "soundboard-played" && frame.sound_url) {
        void onAction({ type: "load_asset", path: frame.sound_url }).then((result) => {
          if (result?.type !== "asset") return;
          const url = URL.createObjectURL(new Blob([result.data as BlobPart], { type: result.contentType }));
          const element = new Audio(url);
          element.volume = outputVolume;
          element.onended = () => URL.revokeObjectURL(url);
          void element.play().catch(() => URL.revokeObjectURL(url));
        });
      }
      void signaling.push(value as DesktopMediaFrame).catch((error) => {
        mediaFailure.current = error instanceof Error ? error.message : "Media signaling failed.";
        setStatus(mediaFailure.current);
      });
    }, (reason) => setStatus(mediaDisconnectMessage(mediaFailure.current, reason)));
    media.current = { stream, capture, peer, socket, audio, screenAudioSenders: [] };
    provisionalCapture = null;
    peer.ontrack = ({ streams, track }) => {
      const remoteStream = streams[0] || new MediaStream([track]);
      if (track.kind === "video") {
        const fallbackOwner = activeCall.caller_id === currentMemberId ? activeCall.recipient_id : activeCall.caller_id;
        const owner = desktopMediaOwnerID(track.id, streams[0]?.id) || fallbackOwner;
        setRemoteScreens((current) => ({ ...current, [owner]: remoteStream }));
        const remove = () => setRemoteScreens((current) => { if (current[owner] !== remoteStream) return current; const next = { ...current }; delete next[owner]; return next; });
        track.addEventListener("ended", remove);
        track.addEventListener("mute", remove);
        track.addEventListener("unmute", () => setRemoteScreens((current) => ({ ...current, [owner]: remoteStream })));
        return;
      }
      if (track.kind !== "audio") return;
      const fallbackOwner = activeCall.caller_id === currentMemberId ? activeCall.recipient_id : activeCall.caller_id;
      const owner = desktopMediaOwnerID(track.id, streams[0]?.id) || fallbackOwner;
      const element = document.createElement("audio");
      element.autoplay = true;
      element.srcObject = remoteStream;
      applyDesktopOutputPreferences(element, currentMemberId, owner);
      document.body.append(element);
      audio.set(owner, [...(audio.get(owner) || []), element]);
      track.addEventListener("ended", () => {
        element.remove();
        const remaining = (audio.get(owner) || []).filter((item) => item !== element);
        if (remaining.length) audio.set(owner, remaining); else audio.delete(owner);
      });
      void element.play().catch(() => undefined);
    };
    const updateConnectionState = () => {
      if (peer.connectionState === "connected") {
        if (connectionTimeout.current !== null) window.clearTimeout(connectionTimeout.current);
        connectionTimeout.current = null;
        setStatus("Call connected");
      } else if (peer.connectionState === "failed" || peer.connectionState === "disconnected" || peer.iceConnectionState === "failed") {
        setStatus(`Media ${peer.connectionState || peer.iceConnectionState}`);
      }
    };
    peer.onconnectionstatechange = updateConnectionState;
    peer.oniceconnectionstatechange = updateConnectionState;
    socket.send(createMediaJoinFrame(activeCall.id, peer.localDescription));
    pendingCandidates.splice(0).forEach((candidate) => socket!.send({ version: 1, type: "candidate", candidate }));
    heartbeat.current = window.setInterval(() => socket?.send({ version: 1, type: "heartbeat" }), 1_000);
    connectionTimeout.current = window.setTimeout(() => {
      if (peer.connectionState !== "connected") setStatus(`Media connection timed out (${peer.iceConnectionState || peer.connectionState || "unknown"}).`);
    }, 15_000);
    setStatus("Connecting…");
    } catch (error) {
      provisionalCapture?.stop();
      cleanup();
      throw error;
    } finally {
      connectingRoom.current = null;
    }
  }

  useEffect(() => {
    let current = true;
    let latestPoll = 0;
    const poll = () => {
      const pollId = ++latestPoll;
      void onAction({ type: "current_call" }).then((result) => {
        if (!current || pollId !== latestPoll || result?.type !== "call") return;
        setCall(result.call);
        onCallChange(result.call);
        if (!result.call && !voiceRoomRef.current) {
          cleanup();
          setStatus("");
        } else if (result.call?.state === "accepted") {
          void connect(result.call).catch((error) => setStatus(error instanceof Error ? error.message : "Call failed."));
        }
      });
    };
    poll();
    const timer = window.setInterval(poll, 1_000);
    return () => { current = false; window.clearInterval(timer); cleanup(); };
  }, [instanceId]);

  async function start(): Promise<void> {
    if (!conversation || conversation.type !== "dm") return;
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then((stream) => stream.getTracks().forEach((track) => track.stop()));
      const result = await onAction({ type: "start_call", directMessageId: conversation.id });
      if (result?.type === "call") { setCall(result.call); onCallChange(result.call); setStatus("Calling…"); }
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not start Call."); }
  }

  async function act(action: "accept" | "decline" | "end"): Promise<void> {
    if (!call) return;
    const result = await onAction({ type: "call_action", callId: call.id, action });
    if (result?.type === "call") { setCall(result.call); onCallChange(result.call); }
    if (action === "decline" || action === "end") { cleanup(); setCall(null); onCallChange(null); setStatus(""); }
  }

  async function joinVoice(room: string): Promise<void> {
    if (voiceRoomRef.current === room) return;
    if (voiceRoomRef.current) cleanup();
    voiceRoomRef.current = room;
    setVoiceRoom(room);
    try {
      await connect({ id: room, direct_message_id: "", caller_id: currentMemberId, recipient_id: "", state: "accepted", created_at: new Date().toISOString() });
    } catch (error) {
      voiceRoomRef.current = null;
      setVoiceRoom(null);
      onVoiceRoomChange(null);
      cleanup();
      setStatus(error instanceof Error ? error.message : "Could not join Voice.");
    }
  }

  useEffect(() => {
    if (requestedVoiceRoom && voiceRoomRef.current !== requestedVoiceRoom) {
      void joinVoice(requestedVoiceRoom);
    } else if (!requestedVoiceRoom && voiceRoomRef.current) {
      leaveVoice();
    }
  }, [requestedVoiceRoom]);

  function leaveVoice(): void {
    cleanup();
    voiceRoomRef.current = null;
    setVoiceRoom(null);
    onVoiceRoomChange(null);
    setStatus("");
  }

  async function stopScreenShare(): Promise<void> {
    const active = media.current;
    if (!active?.screen) return;
    const screen = active.screen;
    active.screen = undefined;
    setLocalScreen(null);
    screen.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    await active.screenSender?.replaceTrack(null);
    active.screenAudioSenders.forEach((sender) => active.peer.removeTrack(sender));
    active.screenAudioSenders = [];
    active.socket.send({ version: 1, type: "video-stopped" });
    setSharing(false);
  }

  async function toggleScreenShare(): Promise<void> {
    const active = media.current;
    if (!active) return;
    if (active.screen) return stopScreenShare();
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen sharing is unavailable on this operating system.");
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const video = screen.getVideoTracks()[0];
    if (!video) { screen.getTracks().forEach((track) => track.stop()); throw new Error("No screen was selected."); }
    const transceiver = active.screenSender
      ? null
      : active.peer.addTransceiver(video, { direction: "sendonly", streams: [screen] });
    if (active.screenSender) await active.screenSender.replaceTrack(video);
    active.screen = screen;
    setLocalScreen(screen);
    active.screenSender = transceiver?.sender || active.screenSender;
    active.screenAudioSenders = screen.getAudioTracks().map((track) => active.peer.addTrack(track, screen));
    video.onended = () => { void stopScreenShare(); };
    const offer = await active.peer.createOffer();
    await active.peer.setLocalDescription(offer);
    await waitForIceGathering(active.peer);
    active.socket.send({ version: 1, type: "offer", sdp: serializeSessionDescription(active.peer.localDescription) });
    active.socket.send({ version: 1, type: "video-started" });
    setSharing(true);
  }

  async function openSoundboard(): Promise<void> {
    const result = await onAction({ type: "list_soundboard" });
    if (result?.type === "soundboard") {
      setSounds(result.sounds);
      setSoundboardOpen(true);
    }
  }

  function playSound(soundId: string): void {
    media.current?.socket.send({ version: 1, type: "soundboard-play", sound_id: soundId });
    setSoundboardOpen(false);
  }

  const incoming = call?.state === "ringing" && call.recipient_id === currentMemberId;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("allchat:direct-call-active", { detail: { active: Boolean(call) } }));
    return () => { window.dispatchEvent(new CustomEvent("allchat:direct-call-active", { detail: { active: false } })); };
  }, [Boolean(call)]);
  useEffect(() => {
    const updateVolumes = (event: Event) => {
      const preferences = (event as CustomEvent<DesktopVoicePreferences>).detail || loadDesktopVoicePreferences(currentMemberId);
      setOutputVolume(preferences.outputVolume);
      media.current?.audio.forEach((elements, memberId) => elements.forEach((element) => { element.volume = desktopMemberOutputVolume(preferences, memberId); }));
    };
    window.addEventListener("allchat:voice-settings", updateVolumes);
    return () => window.removeEventListener("allchat:voice-settings", updateVolumes);
  }, [currentMemberId]);
  useEffect(() => {
    if (!incoming) return;
    let disposed = false, context: AudioContext | undefined, timer: number | undefined, customAudio: HTMLAudioElement | undefined, customURL = "";
    const pulse = () => {
      if (typeof AudioContext === "undefined") return;
      context ||= new AudioContext();
      const currentContext = context;
      void currentContext.resume().then(() => {
        const now = currentContext.currentTime;
        [523.25, 659.25].forEach((frequency, index) => {
          const oscillator = currentContext.createOscillator(), gain = currentContext.createGain(), start = now + index * .12;
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(.0001, start);
          gain.gain.exponentialRampToValueAtTime(.075, start + .02);
          gain.gain.exponentialRampToValueAtTime(.0001, start + .24);
          oscillator.connect(gain).connect(currentContext.destination);
          oscillator.start(start);
          oscillator.stop(start + .25);
        });
      }).catch(() => undefined);
    };
    const generated = () => { if (disposed) return; pulse(); timer = window.setInterval(pulse, 2_200); };
    void onAction({ type: "load_asset", path: "/api/v1/ringtone" }).then((result) => {
      if (disposed) return;
      if (result?.type !== "asset" || result.data.byteLength === 0) return generated();
      customURL = URL.createObjectURL(new Blob([result.data as BlobPart], { type: result.contentType }));
      customAudio = new Audio(customURL); customAudio.loop = true;
      void customAudio.play().catch(generated);
    }).catch(generated);
    return () => { disposed = true; if (timer !== undefined) window.clearInterval(timer); customAudio?.pause(); if (customURL) URL.revokeObjectURL(customURL); if (context) void context.close().catch(() => undefined); };
  }, [incoming, call?.id]);
  const connected = call?.state === "accepted" || !!voiceRoom;
  const directCallName = call ? directCallNames[call.direct_message_id] || (conversation?.type === "dm" && conversation.id === call.direct_message_id ? conversation.name : "") || "Direct Call" : "Direct Call";
  const controlSlot = document.getElementById("desktop-call-controls");
  const connectedControls = connected && controlSlot ? createPortal(
    <section className="voice-connection-panel" aria-label={voiceRoom ? "Voice controls" : "Call controls"}>
      {voiceRoom ? <div>
        <strong>{status === "Call connected" ? "Connected" : status || "Connecting"}</strong>
        <span>{requestedVoiceRoomName}</span>
      </div> : <button className="voice-connection-identity" type="button" aria-label={`Return to Direct Message with ${directCallName}`} title={`Return to Direct Message with ${directCallName}`} onClick={() => call && onOpenDirectCall?.(call.direct_message_id)}>
        <strong>{status === "Call connected" ? "Connected" : status || "Connecting"}</strong>
        <span>{directCallName}</span>
      </button>}
      <div className="voice-connection-actions">
        <button type="button" aria-label="Open soundboard" title="Soundboard" onClick={() => void openSoundboard()}><Icon name="music" /></button>
        <button className={sharing ? "active" : ""} type="button" aria-label={sharing ? "Stop sharing screen" : "Share screen"} title={sharing ? "Stop Sharing" : "Share Screen"} onClick={() => void toggleScreenShare().catch((error) => transientStatus.current?.show(error instanceof Error ? error.message : "Screen sharing failed."))}><Icon name="monitor" /></button>
        <button className={muted ? "voice-mute muted" : "voice-mute"} type="button" aria-label={muted ? "Unmute microphone" : "Mute microphone"} title={muted ? "Unmute" : "Mute"} onClick={() => { const track = media.current?.stream.getAudioTracks()[0]; if (track) { track.enabled = !track.enabled; setMuted(!track.enabled); media.current?.socket.send({ version: 1, type: "mute-state", muted: !track.enabled }); } }}><Icon name="mic" /></button>
        <button className="voice-hangup" type="button" aria-label={voiceRoom ? "Disconnect voice" : "End call"} title={voiceRoom ? "Disconnect Voice" : "End Call"} onClick={() => voiceRoom ? leaveVoice() : void act("end")}><Icon name="phone" /></button>
      </div>
    </section>,
    controlSlot,
  ) : null;
  const incomingControls = incoming && controlSlot ? createPortal(<section className="voice-connection-panel incoming-call-panel" aria-label="Incoming Call controls"><div><strong>Incoming Direct Call</strong><span>{directCallName}</span></div><div className="voice-connection-actions"><button className="call-accept" type="button" onClick={() => void act("accept")}>Accept</button><button className="call-end" type="button" onClick={() => void act("decline")}>Decline</button></div></section>, controlSlot) : null;
  const screenPortals = Object.entries({ ...remoteScreens, ...(localScreen ? { [currentMemberId]: localScreen } : {}) }).map(([memberId, stream]) => {
    const tile = [...document.querySelectorAll<HTMLElement>("[data-media-member-id]")].find((element) => element.dataset.mediaMemberId === memberId);
    const target = tile?.querySelector(".media-stage-visual");
    return target ? createPortal(<MediaStreamVideo stream={stream} muted={memberId === currentMemberId} />, target, `screen-${memberId}`) : null;
  });
  return <>
    {!call && !voiceRoom && conversation?.type === "dm" && <button className="header-button icon-button" type="button" aria-label="Start Call" title="Start Call" onClick={() => void start()}><Icon name="phone" /></button>}
    {call && !incoming && call.state === "ringing" && <button className="call-end" type="button" onClick={() => void act("end")}>Cancel Call</button>}
    {!connected && status && <span className="call-status" role="status">{status}</span>}
    {connectedControls}
    {incomingControls}
    {screenPortals}
    {soundboardOpen && <div className="desktop-soundboard" role="dialog" aria-label="Community soundboard"><header><strong>Soundboard</strong><button type="button" aria-label="Close soundboard" onClick={() => setSoundboardOpen(false)}><Icon name="x" /></button></header><div>{sounds.length ? sounds.map((sound) => <button type="button" key={sound.id} onClick={() => playSound(sound.id)}><span>{sound.emoji || "▶"}</span><strong>{sound.name}</strong></button>) : <span>No Community sounds have been added yet.</span>}</div></div>}
  </>;
}

function MediaStreamVideo({ stream, muted }: { stream: MediaStream; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    void element.play().catch(() => undefined);
    return () => { if (element.srcObject === stream) element.srcObject = null; };
  }, [stream]);
  return <video ref={ref} className="desktop-shared-screen" autoPlay playsInline muted={muted} />;
}

export function waitForIceGathering(peer: RTCPeerConnection, timeoutMs = 2_000): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      peer.removeEventListener("icegatheringstatechange", changed);
      window.clearTimeout(timer);
      resolve();
    };
    const changed = () => { if (peer.iceGatheringState === "complete") finish(); };
    const timer = window.setTimeout(finish, timeoutMs);
    peer.addEventListener("icegatheringstatechange", changed);
  });
}

export function createTransientCallStatusController(
  setStatus: (value: string) => void,
  connectedStatus: () => string | null,
  delayMs = 3_000,
  schedule: (callback: () => void, delay: number) => number = window.setTimeout,
  cancel: (timer: number) => void = window.clearTimeout,
) {
  let timer: number | null = null;
  return {
    show(message: string) {
      if (timer !== null) cancel(timer);
      setStatus(message);
      timer = schedule(() => {
        timer = null;
        const restored = connectedStatus();
        if (restored) setStatus(restored);
      }, delayMs);
    },
    clear() {
      if (timer !== null) cancel(timer);
      timer = null;
    },
  };
}

function memberName(member: InstanceViewState["member"]): string {
  return member.displayName || member.username;
}

function typingSummary(names: string[]): string {
  const unique = [...new Set(names)];
  if (!unique.length) return "";
  if (unique.length > 3) return "Several people are typing…";
  return `${unique.join(", ")}${unique.length === 1 ? " is" : " are"} typing…`;
}

function byPosition<T extends { position: number }>(left: T, right: T): number {
  return left.position - right.position;
}

function formatMessageTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function draftKey(instanceId: string, conversationId: string): string {
  return `allchat:draft:${instanceId}:${conversationId}`;
}

function mergeMessage(
  messages: InstanceViewState["messages"][string],
  incoming: InstanceViewState["messages"][string][number],
) {
  return [...messages.filter(({ id }) => id !== incoming.id), incoming].sort(
    (left, right) => left.sequence - right.sequence,
  ).slice(-300);
}

function mergeMessages(
  current: InstanceViewState["messages"][string],
  incoming: InstanceViewState["messages"][string],
  direction: "older" | "newer" = "newer",
) {
  const messages = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => messages.set(message.id, message));
  const merged = [...messages.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
  return merged.length <= 300 ? merged : direction === "older" ? merged.slice(0, 300) : merged.slice(-300);
}

function updateReaction(
  reactions: NonNullable<InstanceViewState["messages"][string][number]["reactions"]>,
  emoji: string,
  active: boolean,
) {
  const existing = reactions.find((reaction) => reaction.emoji === emoji);
  if (!existing) return active ? [...reactions, { emoji, count: 1, me: true }] : reactions;
  const count = Math.max(0, existing.count + (active && !existing.me ? 1 : !active && existing.me ? -1 : 0));
  return reactions
    .filter((reaction) => reaction.emoji !== emoji)
    .concat(count ? [{ ...existing, count, me: active }] : []);
}

const reactionEmojis = [
  "👍", "👎", "❤️", "😂", "🎉", "😮", "😢", "😡",
  "🔥", "✨", "✅", "❌", "👀", "🙏", "💯", "🤔",
  "👏", "🙌", "💪", "🚀", "⭐", "💜", "🤣", "😭",
];

function EmojiPicker({
  reactions,
  onSelect,
}: {
  reactions: NonNullable<InstanceViewState["messages"][string][number]["reactions"]>;
  onSelect(emoji: string, active: boolean): void;
}) {
  const [customEmoji, setCustomEmoji] = useState("");
  const submitCustomEmoji = () => {
    const emoji = customEmoji.trim();
    if (!emoji || Array.from(emoji).length > 12) return;
    const selected = reactions.some((reaction) => reaction.emoji === emoji && reaction.me);
    onSelect(emoji, !selected);
  };
  return (
    <div className="emoji-picker" role="menu" aria-label="Choose a Reaction" data-reaction-picker>
      {reactionEmojis.map((emoji) => {
        const selected = reactions.some((reaction) => reaction.emoji === emoji && reaction.me);
        return <button key={emoji} type="button" role="menuitemcheckbox" aria-checked={selected} aria-label={`${selected ? "Remove" : "Add"} ${emoji} Reaction`} onClick={() => onSelect(emoji, !selected)}>{emoji}</button>;
      })}
      <label className="emoji-picker-custom">
        <span className="sr-only">Custom Reaction</span>
        <input aria-label="Custom Reaction" value={customEmoji} maxLength={32} placeholder="Paste emoji" onChange={(event) => setCustomEmoji(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitCustomEmoji(); } }} />
        <button type="button" aria-label="Add Custom Reaction" disabled={!customEmoji.trim()} onClick={submitCustomEmoji}>+</button>
      </label>
    </div>
  );
}

function appendUniqueFiles(current: File[], incoming: File[]): File[] {
  const files = [...current];
  for (const file of incoming) {
    if (!files.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) files.push(file);
  }
  return files.slice(0, 10);
}

function AttachmentPreviewList({ files, onRemove }: { files: File[]; onRemove(index: number): void }) {
  return (
    <section className="attachment-preview-list" aria-label="Files ready to send">
      {files.map((file, index) => <PendingAttachmentPreview key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onRemove={() => onRemove(index)} />)}
    </section>
  );
}

function PendingAttachmentPreview({ file, onRemove }: { file: File; onRemove(): void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <article className="attachment-preview">
      {previewUrl && file.type.startsWith("image/") ? <img src={previewUrl} alt="" /> : previewUrl && file.type.startsWith("video/") ? <video src={previewUrl} muted aria-label={`${file.name} preview`} /> : <span className="attachment-file-icon"><Icon name="file" /></span>}
      <span className="attachment-preview-details"><strong title={file.name}>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
      <button className="attachment-preview-remove" type="button" aria-label={`Remove ${file.name}`} onClick={onRemove}><Icon name="x" /></button>
    </article>
  );
}

function formatBytes(size: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Number(size || 0), index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function LinkifiedText({ body, mentions = [] }: { body: string; mentions?: Array<{ username: string }> }) {
  const mentionNames = new Set(mentions.map(({ username }) => username.toLocaleLowerCase()));
  const parts: Array<string | { url: string } | { mention: string }> = [];
  const pattern = /https?:\/\/[^\s<]+|(^|[^\p{L}\p{N}._-])@([\p{L}\p{N}._-]{3,32})/gu;
  let offset = 0;
  for (const match of body.matchAll(pattern)) {
    const index = match.index || 0;
    if (index > offset) parts.push(body.slice(offset, index));
    const raw = match[0];
    if (!raw.startsWith("http")) {
      const prefix = match[1] || "";
      if (prefix) parts.push(prefix);
      const username = match[2];
      if (mentionNames.has(username.toLocaleLowerCase())) parts.push({ mention: username });
      else parts.push(`@${username}`);
      offset = index + raw.length;
      continue;
    }
    const url = raw.replace(/[),.!?;:]+$/, "");
    parts.push({ url });
    if (url.length < raw.length) parts.push(raw.slice(url.length));
    offset = index + raw.length;
  }
  if (offset < body.length) parts.push(body.slice(offset));
  return <>{parts.map((part, index) => typeof part === "string" ? <Fragment key={index}>{part}</Fragment> : "mention" in part ? <mark className="mention" key={index}>@{part.mention}</mark> : <a className="message-link" key={index} href={part.url} target="_blank" rel="noreferrer">{part.url}</a>)}</>;
}

function MessageBody({ body, mentions }: { body: string; mentions: Array<{ username: string }> }) {
  const parts: Array<{ code?: string; language?: string; text?: string }> = [];
  const pattern = /```(?:([A-Za-z0-9_+-]+)(?:[ \t]+|\r?\n))?([\s\S]*?)```/g;
  let offset = 0;
  for (const match of body.matchAll(pattern)) {
    const index = match.index || 0;
    if (index > offset) parts.push({ text: body.slice(offset, index) });
    parts.push({ language: match[1] || "", code: match[2].trim() });
    offset = index + match[0].length;
  }
  if (offset < body.length) parts.push({ text: body.slice(offset) });
  if (!parts.length) return <LinkifiedText body={body} mentions={mentions} />;
  return <>{parts.map((part, index) => part.code !== undefined
    ? <pre key={index}><code className={part.language ? `language-${part.language}` : undefined}><SyntaxHighlightedCode language={part.language || ""} code={part.code} /></code></pre>
    : <LinkifiedText key={index} body={part.text || ""} mentions={mentions} />)}</>;
}

function SyntaxHighlightedCode({ language, code }: { language: string; code: string }) {
  if (language === "json") {
    try {
      return <JsonSyntax value={JSON.parse(code)} />;
    } catch {
      return <>{code}</>;
    }
  }
  if (["bash", "sh", "shell"].includes(language)) {
    return <>{code.split(/(\s+|"[^"]*"|'[^']*')/).filter(Boolean).map((token, index) => /^['"]/.test(token)
      ? <span className="syntax-string" key={index}>{token}</span>
      : /^(echo|cd|curl|go|npm|npx|git|sudo)$/.test(token)
        ? <span className="syntax-keyword" key={index}>{token}</span>
        : <Fragment key={index}>{token}</Fragment>)}</>;
  }
  return <>{code}</>;
}

function JsonSyntax({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null) return <span className="syntax-literal">null</span>;
  if (typeof value === "string") return <span className="syntax-string">{JSON.stringify(value)}</span>;
  if (typeof value === "number" || typeof value === "boolean") return <span className="syntax-literal">{String(value)}</span>;
  const array = Array.isArray(value);
  const entries: Array<[string, unknown]> = array
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  return <>{array ? "[" : "{"}{entries.length ? "\n" : ""}{entries.map(([key, item], index) => <Fragment key={key}>
    {"  ".repeat(depth + 1)}
    {!array && <><span className="syntax-key">{JSON.stringify(key)}</span>{": "}</>}
    <JsonSyntax value={item} depth={depth + 1} />
    {index < entries.length - 1 ? ",\n" : "\n"}
  </Fragment>)}{"  ".repeat(depth)}{array ? "]" : "}"}</>;
}

function firstMessageURL(body: string): string | undefined {
  const raw = body.match(/https?:\/\/[^\s<]+/)?.[0];
  return raw?.replace(/[),.!?;:]+$/, "");
}

function LinkPreview({
  body,
  onAction,
}: {
  body: string;
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
}) {
  const [preview, setPreview] = useState<{
    url: string;
    site_name?: string;
    title?: string;
    description?: string;
    image_url?: string;
  } | null>(null);
  const url = firstMessageURL(body);
  useEffect(() => {
    if (!url) return;
    let current = true;
    void onAction({ type: "link_preview", url })
      .then((result) => {
        if (current && result?.type === "link_preview")
          setPreview(result.preview);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [url]);
  return preview ? (
    <a
      className="link-preview"
      href={preview.url}
      target="_blank"
      rel="noreferrer"
    >
      <small>{preview.site_name || new URL(preview.url).hostname}</small>
      <strong>{preview.title || preview.url}</strong>
      {preview.description && <span>{preview.description}</span>}
      {preview.image_url && (
        <AuthenticatedImage
          path={`/api/v1/link-preview/image?url=${encodeURIComponent(preview.image_url)}`}
          alt=""
          className="link-preview-image"
          onAction={onAction}
        />
      )}
    </a>
  ) : null;
}

function AttachmentView({
  attachment,
  onAction,
}: {
  attachment: Attachment;
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const path = desktopAttachmentDisplayPath(attachment);

  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );
  useEffect(() => () => { if (viewerUrl) URL.revokeObjectURL(viewerUrl); }, [viewerUrl]);

  useEffect(() => {
    let current = true;
    void onAction({ type: "load_asset", path }).then((result) => {
      if (!current || result?.type !== "asset") return;
      const nextUrl = URL.createObjectURL(new Blob([result.data as BlobPart], { type: result.contentType }));
      setObjectUrl(nextUrl);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [path]);

  async function openOriginalImage(): Promise<void> {
    setLoadingOriginal(true);
    try {
      const originalPath = attachment.url || `/api/v1/attachments/${attachment.id}`;
      const result = await onAction({ type: "load_asset", path: originalPath });
      if (result?.type !== "asset") return;
      if (viewerUrl) URL.revokeObjectURL(viewerUrl);
      setViewerUrl(URL.createObjectURL(new Blob([result.data as BlobPart], { type: result.contentType })));
    } finally {
      setLoadingOriginal(false);
    }
  }

  const type = attachment.content_type;
  return (
    <figure className="attachment">
      {objectUrl && type.startsWith("image/") && (
        <button className="attachment-image-button" type="button" aria-label={`View ${attachment.name} at full size`} onClick={() => void openOriginalImage()}><img src={objectUrl} alt={attachment.name} /></button>
      )}
      {objectUrl && type.startsWith("audio/") && (
        <audio src={objectUrl} controls />
      )}
      {objectUrl && type.startsWith("video/") && (
        <video src={objectUrl} controls />
      )}
      <figcaption>
        <strong>{attachment.name}</strong>
        <small>{formatBytes(attachment.size)}</small>
      </figcaption>
      {!objectUrl && <span className="attachment-loading">Loading…</span>}
      {loadingOriginal && <span className="attachment-loading">Opening original…</span>}
      {objectUrl && (
        <a href={objectUrl} download={attachment.name}>
          Download
        </a>
      )}
      {viewerUrl && <ImageLightbox src={viewerUrl} alt={attachment.name} onClose={() => setViewerUrl(null)} />}
    </figure>
  );
}

export function desktopAttachmentDisplayPath(attachment: Attachment): string {
  const original = attachment.url || `/api/v1/attachments/${attachment.id}`;
  return attachment.content_type.toLowerCase() === "image/gif" ? original : attachment.preview_url || original;
}

function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose(): void }) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const closeWithEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeWithEscape);
    return () => document.removeEventListener("keydown", closeWithEscape);
  }, [onClose]);
  return createPortal(
    <section className={`image-lightbox${dragging ? " dragging" : ""}`} role="dialog" aria-modal="true" aria-label={`Image viewer: ${alt}`} onWheel={(event) => { event.preventDefault(); setScale((current) => Math.min(8, Math.max(.25, current * (event.deltaY < 0 ? 1.15 : .87)))); }} onPointerMove={(event) => { if (dragging) setPosition((current) => ({ x: current.x + event.movementX, y: current.y + event.movementY })); }} onPointerUp={(event) => { if (dragging && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); }}>
      <img src={src} alt={alt} draggable={false} style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); setDragging(true); event.currentTarget.closest<HTMLElement>(".image-lightbox")?.setPointerCapture(event.pointerId); }} />
      <output aria-live="polite">{Math.round(scale * 100)}%</output>
      <button className="image-lightbox-close" type="button" aria-label="Close image viewer" onClick={onClose}><Icon name="x" /></button>
    </section>,
    document.body,
  );
}

type IconName =
  | "bell"
  | "chevron-down"
  | "file"
  | "hash"
  | "home"
  | "messages"
  | "mic"
  | "monitor"
  | "music"
  | "paperclip"
  | "phone"
  | "plus"
  | "pin"
  | "search"
  | "send"
  | "settings"
  | "user"
  | "users"
  | "volume"
  | "x";

function Icon({ name }: { name: IconName }) {
  const paths = {
    bell: (
      <>
        <path d="M10.3 21a2 2 0 0 0 3.4 0" />
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      </>
    ),
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    file: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
      </>
    ),
    hash: (
      <>
        <line x1="4" x2="20" y1="9" y2="9" />
        <line x1="4" x2="20" y1="15" y2="15" />
        <line x1="10" x2="8" y1="3" y2="21" />
        <line x1="16" x2="14" y1="3" y2="21" />
      </>
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10" />
        <path d="M9 20v-6h6v6" />
      </>
    ),
    messages: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
    mic: (
      <>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
      </>
    ),
    monitor: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
    music: (
      <>
        <path d="M9 18V5l11-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="17" cy="16" r="3" />
      </>
    ),
    paperclip: (
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    ),
    pin: (
      <>
        <path d="M12 17v5" />
        <path d="M5 17h14" />
        <path d="m7 10 1-7h8l1 7" />
        <path d="M5 17c0-3 2-5 2-7h10c0 2 2 4 2 7Z" />
      </>
    ),
    phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </>
    ),
    send: (
      <>
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
      </>
    ),
    settings: (
      <>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    user: (
      <>
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    volume: (
      <>
        <path d="M11 5 6 9H2v6h4l5 4Z" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
      </>
    ),
    x: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
  };
  return (
    <svg className="lucide-icon" data-lucide={name} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function AuthenticatedImage({
  path,
  alt,
  className,
  fallback,
  onAction,
}: {
  path?: string;
  alt: string;
  className: string;
  fallback?: string;
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
}) {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    if (!path) {
      setSource(null);
      return;
    }
    let current = true;
    let url: string | null = null;
    void onAction({ type: "load_asset", path }).then((result) => {
      if (!current || result?.type !== "asset") return;
      url = URL.createObjectURL(
        new Blob([result.data as BlobPart], { type: result.contentType }),
      );
      setSource(url);
    });
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  return source ? (
    <img src={source} alt={alt} className={className} />
  ) : (
    <span className={className} aria-hidden="true">
      {fallback}
    </span>
  );
}

function CommunityAdministration({
  state,
  onAction,
  onSectionChange,
}: {
  state: InstanceViewState;
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
  onSectionChange(section: string): void;
}) {
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const communitySettingsRequested = useRef(false);
  const [section, setSection] = useState<"general" | "dashboard" | "channels" | "roles" | "invitations" | "soundboard">("general");
  const [dashboard, setDashboard] = useState<import("../shared/instance-actions").AdminDashboard | null>(null);
  const [dashboardHistory, setDashboardHistory] = useState<import("../shared/instance-actions").AdminDashboard[]>([]);
  const [roles, setRoles] = useState<import("../shared/instance-actions").CommunityRole[] | null>(null);
  const [invitations, setInvitations] = useState<import("../shared/instance-actions").CommunityInvitation[] | null>(null);
  const [adminCategories, setAdminCategories] = useState(state.categories);
  const [adminChannels, setAdminChannels] = useState(state.channels);
  const [sounds, setSounds] = useState<import("../shared/instance-actions").SoundboardSound[] | null>(null);
  const [soundLimit, setSoundLimit] = useState(10_000);
  const [communitySettings, setCommunitySettings] = useState<import("../shared/instance-actions").CommunitySettings | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (communitySettingsRequested.current) return;
    communitySettingsRequested.current = true;
    void onAction({ type: "get_community_settings" }).then((result) => {
      if (result?.type === "community_settings") setCommunitySettings(result.settings);
      if (result?.type === "community_settings_unavailable") setError(result.reason);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load Community settings."));
  }, []);

  useEffect(() => {
    if (section !== "dashboard") return;
    let current = true;
    const refresh = () => void onActionRef.current({ type: "admin_dashboard" }).then((result) => {
      if (!current || result?.type !== "admin_dashboard") return;
      setDashboard(result.dashboard);
      setDashboardHistory((history) => [...history, result.dashboard].slice(-60));
      setError("");
    }).catch((cause) => {
      if (current) setError(cause instanceof Error ? cause.message : "Could not load the Admin Dashboard.");
    });
    setDashboard(null);
    setDashboardHistory([]);
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => { current = false; window.clearInterval(timer); };
  }, [section]);

  function select(next: typeof section): void {
    setSection(next);
    onSectionChange(next);
    setError("");
    if (next === "general" && !communitySettings) {
      void onAction({ type: "get_community_settings" }).then((result) => {
        if (result?.type === "community_settings") setCommunitySettings(result.settings);
        if (result?.type === "community_settings_unavailable") setError(result.reason);
      }).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load Community settings."));
    }
    if (next === "roles") {
      setRoles(null);
      void onAction({ type: "list_roles" }).then((result) => {
        if (result?.type === "roles") setRoles(result.roles);
      }).catch(() => setError("Could not load Roles."));
    }
    if (next === "channels" && !roles) {
      void onAction({ type: "list_roles" }).then((result) => {
        if (result?.type === "roles") setRoles(result.roles);
      }).catch(() => setError("Could not load Channel permission Roles."));
    }
    if (next === "invitations") {
      setInvitations(null);
      void onAction({ type: "list_invitations" }).then((result) => {
        if (result?.type === "invitations") setInvitations(result.invitations);
      }).catch(() => setError("Could not load Invitations."));
    }
    if (next === "soundboard") {
      setSounds(null);
      void onAction({ type: "list_soundboard" }).then((result) => {
        if (result?.type === "soundboard") { setSounds(result.sounds); setSoundLimit(result.maxDurationMs); }
      }).catch(() => setError("Could not load the Soundboard."));
    }
  }

  return (
    <section className="community-administration" data-community-administration>
      <nav aria-label="Community settings">
        {(["dashboard", "general", "channels", "roles", "invitations", "soundboard"] as const).map((item) => <button type="button" key={item} aria-current={section === item ? "page" : undefined} onClick={() => select(item)}>{item === "general" ? "General" : item[0].toUpperCase() + item.slice(1)}</button>)}
      </nav>
	  {section === "general" && communitySettings && <CommunityAvatarSetting settings={communitySettings} onAction={onAction} onChange={setCommunitySettings} />}
	  {section === "general" && communitySettings && <RingtoneSetting scope="community" active={communitySettings.community_ringtone_set === true} fallbackLabel="Generated tone" onAction={onAction} onActiveChange={(active) => setCommunitySettings({ ...communitySettings, community_ringtone_set: active })} />}
      {section === "general" && <section className="settings-panel administration-list"><h2>General</h2><p>Manage {state.community.name} from the desktop client.</p>{!communitySettings && !error && <p>Loading Community settings…</p>}{error && <p role="alert" className="notice-error">{error}</p>}{communitySettings && <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onAction({ type: "update_community_settings", name: String(data.get("name") || ""), maxAttachmentMiB: Number(data.get("maxAttachmentMiB")), homeMarkdown: String(data.get("homeMarkdown") || ""), pushRelayURL: String(data.get("pushRelayURL") || "") }).then((result) => { if (result?.type === "community_settings") setCommunitySettings(result.settings); }).catch(() => setError("Could not save Community settings.")); }}><label>Community name<input name="name" maxLength={100} defaultValue={communitySettings.name} required /></label><label>Maximum attachment size (MiB)<input name="maxAttachmentMiB" type="number" min="1" max="256" defaultValue={communitySettings.max_attachment_mib} required /></label><p>Applies immediately. Your reverse proxy must allow at least the same request size.</p><label>Community Guide<textarea name="homeMarkdown" rows={8} defaultValue={communitySettings.home_markdown} /></label><label>Mobile push relay<input name="pushRelayURL" type="url" defaultValue={communitySettings.push_relay_url} placeholder="https://push.example.com" /></label><p>Used only for Android and iOS background notifications. Leave empty to disable mobile push.</p><details><summary>Relay authorization identity</summary><p>Key ID: <code>{communitySettings.push_key_id}</code></p><textarea readOnly rows={3} value={communitySettings.push_public_key} aria-label="Relay public key" /></details><button type="submit">Save settings</button></form>}</section>}
      {section === "dashboard" && <AdminDashboardView dashboard={dashboard} history={dashboardHistory} error={error} />}
      {section === "channels" && <section className="settings-panel administration-list"><h2>Channels</h2><p>Create and archive Community Categories and Channels.</p><form className="administration-inline-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onAction({ type: "create_category", name: String(data.get("name") || ""), position: adminCategories.length }).then((result) => { if (result?.type === "category") setAdminCategories((current) => [...current, result.category]); }); event.currentTarget.reset(); }}><label>Category name<input name="name" required /></label><button type="submit">Create Category</button></form><form className="administration-inline-form channel-create-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onAction({ type: "create_channel", categoryId: String(data.get("category")), name: String(data.get("name") || ""), channelType: String(data.get("type")) as "text" | "voice", position: adminChannels.length }).then((result) => { if (result?.type === "channel") setAdminChannels((current) => [...current, result.channel]); }); event.currentTarget.reset(); }}><label>Category<select name="category" required>{adminCategories.filter(({ archived }) => !archived).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Channel name<input name="name" required /></label><label>Type<select name="type"><option value="text">Text</option><option value="voice">Voice</option></select></label><button type="submit">Create Channel</button></form>{adminCategories.map((category) => <section className="admin-category" key={category.id}><h3>{category.name}</h3>{adminChannels.filter(({ category_id }) => category_id === category.id).map((channel) => <AdminChannelRow key={channel.id} channel={channel} roles={roles || []} onAction={onAction} onUpdate={(updated) => setAdminChannels((current) => updated ? current.map((item) => item.id === channel.id ? updated : item) : current.filter(({ id }) => id !== channel.id))} />)}</section>)}</section>}
      {section === "roles" && <section className="settings-panel administration-list"><h2>Roles</h2><p>Create Roles and manage their permissions and ordering.</p><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onAction({ type: "create_role", name: String(data.get("name") || ""), position: roles?.length || 0, permissions: data.getAll("permissions").map(String) }).then((result) => { if (result?.type === "role") setRoles((current) => [...(current || []), result.role]); }); event.currentTarget.reset(); }}><label>Role name<input name="name" required /></label><fieldset><legend>Permissions</legend>{["manage_channels", "manage_roles", "manage_invitations", "manage_soundboard", "moderate_members"].map((permission) => <label className="notification-check" key={permission}><input type="checkbox" name="permissions" value={permission} />{permission.replaceAll("_", " ")}</label>)}</fieldset><button type="submit">Create Role</button></form>{!roles && !error && <p>Loading Roles…</p>}{roles?.map((role) => <article key={role.id}><span><strong>{role.name}</strong><small>{role.permissions.join(", ") || "No permissions"}</small></span>{!role.default && !role.owner && <div className="administration-actions"><button type="button" onClick={() => { const name = window.prompt("Role name", role.name); if (!name) return; void onAction({ type: "update_role", roleId: role.id, name, position: role.position, permissions: role.permissions }).then((result) => { if (result?.type === "role") setRoles((current) => current?.map((item) => item.id === role.id ? result.role : item) || null); }); }}>Edit</button><button className="danger-button" type="button" onClick={() => { if (!window.confirm(`Retire ${role.name}?`)) return; void onAction({ type: "retire_role", roleId: role.id }).then(() => setRoles((current) => current?.filter(({ id }) => id !== role.id) || null)); }}>Retire</button></div>}</article>)}</section>}
      {section === "invitations" && <section className="settings-panel administration-list"><h2>Invitations</h2><p>Create and revoke Community Invitations.</p><form className="administration-inline-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onAction({ type: "create_invitation", expiresInMinutes: Number(data.get("expires")), maxUses: Number(data.get("uses")) }).then((result) => { if (result?.type === "invitation") setInvitations((current) => [result.invitation, ...(current || [])]); }); }}><label>Expires in minutes<input name="expires" type="number" min="1" defaultValue="1440" required /></label><label>Maximum uses<input name="uses" type="number" min="1" defaultValue="1" required /></label><button type="submit">Create Invitation</button></form>{!invitations && !error && <p>Loading Invitations…</p>}{invitations?.length === 0 && <p>No active Invitations.</p>}{invitations?.map((invitation) => <article key={invitation.id}><span><strong>{invitation.token || invitation.id}</strong><small>{invitation.use_count} / {invitation.max_uses} uses · expires {new Date(invitation.expires_at).toLocaleString()}</small></span><button className="danger-button" type="button" onClick={() => { if (!window.confirm("Revoke this Invitation?")) return; void onAction({ type: "revoke_invitation", invitationId: invitation.id }).then(() => setInvitations((current) => current?.filter(({ id }) => id !== invitation.id) || null)); }}>Revoke</button></article>)}</section>}
      {section === "soundboard" && <section className="settings-panel administration-list"><h2>Soundboard</h2><p>Upload and manage sounds available in Voice Rooms.</p><form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const file = data.get("file"); if (!(file instanceof File)) return; void file.arrayBuffer().then((bytes) => onAction({ type: "upload_sound", name: String(data.get("name") || ""), emoji: String(data.get("emoji") || ""), position: sounds?.length || 0, contentType: file.type || "application/octet-stream", data: new Uint8Array(bytes) })).then((result) => { if (result?.type === "sound") setSounds((current) => [...(current || []), result.sound]); }); form.reset(); }}><label>Name<input name="name" required /></label><label>Emoji<input name="emoji" maxLength={8} /></label><label>Audio (MP3, WAV, Ogg; up to 1 MiB)<input name="file" type="file" accept="audio/mpeg,audio/wav,audio/ogg" required /></label><button type="submit">Upload sound</button></form><form className="administration-inline-form" onSubmit={(event) => { event.preventDefault(); const seconds = Number(new FormData(event.currentTarget).get("seconds")); void onAction({ type: "set_soundboard_limit", maxDurationMs: seconds * 1000 }).then(() => setSoundLimit(seconds * 1000)); }}><label>Maximum clip length (seconds)<input name="seconds" type="number" min="1" max="30" defaultValue={Math.round(soundLimit / 1000)} required /></label><button type="submit">Save limit</button></form>{!sounds && !error && <p>Loading sounds…</p>}{sounds?.length === 0 && <p>No sounds uploaded.</p>}{sounds?.map((sound) => <article key={sound.id}><span><strong>{sound.emoji} {sound.name}</strong><small>{(sound.duration_ms / 1000).toFixed(1)}s · {formatBytes(sound.size)}</small></span><div className="administration-actions"><button type="button" onClick={() => { const name = window.prompt("Sound name", sound.name); if (!name) return; const emoji = window.prompt("Sound emoji", sound.emoji || "") ?? sound.emoji ?? ""; void onAction({ type: "update_sound", soundId: sound.id, name, emoji, position: sound.position }).then((result) => { if (result?.type === "sound") setSounds((current) => current?.map((item) => item.id === sound.id ? result.sound : item) || null); }); }}>Edit</button><button className="danger-button" type="button" onClick={() => { if (!window.confirm(`Delete ${sound.name}?`)) return; void onAction({ type: "delete_sound", soundId: sound.id }).then(() => setSounds((current) => current?.filter(({ id }) => id !== sound.id) || null)); }}>Delete</button></div></article>)}</section>}
    </section>
  );
}

function CommunityAvatarSetting({ settings, onAction, onChange }: { settings: import("../shared/instance-actions").CommunitySettings; onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>; onChange(settings: import("../shared/instance-actions").CommunitySettings): void }) {
  return <div className="community-avatar-setting">
	{settings.avatar_url ? <AuthenticatedImage path={settings.avatar_url} alt="Community avatar" className="community-settings-avatar" fallback={settings.name.slice(0, 1).toUpperCase()} onAction={onAction} /> : <span className="community-settings-avatar">{settings.name.slice(0, 1).toUpperCase()}</span>}
	<label>Choose Community avatar<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.arrayBuffer().then((bytes) => onAction({ type: "update_community_avatar", contentType: file.type, data: new Uint8Array(bytes) })).then(() => onChange({ ...settings, avatar_url: `/api/v1/community-avatar?v=${Date.now()}` })); }} /></label>
	{settings.avatar_url && <button type="button" onClick={() => void onAction({ type: "remove_community_avatar" }).then(() => onChange({ ...settings, avatar_url: undefined }))}>Remove avatar</button>}
  </div>;
}

function ringtoneFileType(file: File): string { return file.type || (/\.ogg$/i.test(file.name) ? "audio/ogg" : /\.wav$/i.test(file.name) ? "audio/wav" : "audio/mpeg"); }

function RingtoneSetting({ scope, active, fallbackLabel, onAction, onActiveChange }: { scope: "community" | "member"; active: boolean; fallbackLabel: string; onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>; onActiveChange(active: boolean): void }) {
  const [notice, setNotice] = useState("");
  const label = scope === "community" ? "Community ringtone" : "Incoming call ringtone";
  return <section className="settings-card ringtone-setting"><h3>{label}</h3><p>{active ? "Custom audio is active." : fallbackLabel}</p><label>Choose audio file<input type="file" accept="audio/mpeg,audio/wav,audio/ogg" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.arrayBuffer().then((bytes) => onAction({ type: "update_ringtone", scope, contentType: ringtoneFileType(file), data: new Uint8Array(bytes) })).then(() => { onActiveChange(true); setNotice("Ringtone saved."); }).catch(() => setNotice("Could not save ringtone.")); }} /></label>{active && <button type="button" onClick={() => void onAction({ type: "remove_ringtone", scope }).then(() => { onActiveChange(false); setNotice(scope === "member" ? "Using the Community ringtone." : "Using the generated tone."); })}>{scope === "member" ? "Use Community default" : "Remove custom ringtone"}</button>}<p role="status">{notice}</p></section>;
}

function AdminChannelRow({ channel, roles, onAction, onUpdate }: {
  channel: InstanceViewState["channels"][number];
  roles: import("../shared/instance-actions").CommunityRole[];
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
  onUpdate(channel: InstanceViewState["channels"][number] | null): void;
}) {
  return <article><span><strong><Icon name={channel.type === "voice" ? "volume" : "hash"} />{channel.name}</strong><small>{channel.type} Channel{channel.archived ? " · archived" : ""}</small></span><div className="administration-actions"><button type="button" onClick={() => { const name = window.prompt("Channel name", channel.name); if (!name) return; void onAction({ type: "update_channel", channelId: channel.id, categoryId: channel.category_id, name, channelType: channel.type, position: channel.position }).then((result) => { if (result?.type === "channel") onUpdate(result.channel); }); }}>Edit</button><button type="button" onClick={() => void onAction({ type: "set_channel_archived", channelId: channel.id, archived: !channel.archived }).then(() => onUpdate({ ...channel, archived: !channel.archived }))}>{channel.archived ? "Restore" : "Archive"}</button><button className="danger-button" type="button" onClick={() => { if (!window.confirm(`Permanently delete #${channel.name}?`)) return; void onAction({ type: "delete_channel", channelId: channel.id }).then(() => onUpdate(null)); }}>Delete</button></div><details className="channel-permissions"><summary>Permission override</summary><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onAction({ type: "set_channel_override", channelId: channel.id, roleId: String(data.get("roleId")), permission: String(data.get("permission")), effect: String(data.get("effect")) as "allow" | "deny" | "inherit" }); }}><label>Role<select name="roleId" required>{roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label><label>Permission<select name="permission"><option value="view_channel">View Channel</option><option value="send_messages">Send Messages</option><option value="connect_voice">Connect Voice</option></select></label><label>Effect<select name="effect"><option value="inherit">Inherit</option><option value="allow">Allow</option><option value="deny">Deny</option></select></label><button type="submit">Save override</button></form></details></article>;
}

function DashboardStat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <article className="dashboard-stat"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

function AdminDashboardView({ dashboard, history, error }: { dashboard: import("../shared/instance-actions").AdminDashboard | null; history: import("../shared/instance-actions").AdminDashboard[]; error: string }) {
  if (!dashboard) return <section className="admin-dashboard" data-admin-dashboard><header className="dashboard-heading"><div><h2>Instance overview</h2><p>Live health, capacity, storage, and Community activity.</p></div><span>Loading…</span></header>{error && <p className="notice-error" role="alert">{error}</p>}</section>;
  const resources = dashboard.resources;
  const cpuHistory = history.map((sample, index) => {
    const previous = history[index - 1];
    if (!previous) return 0;
    const elapsed = (new Date(sample.checked_at).getTime() - new Date(previous.checked_at).getTime()) / 1_000;
    return elapsed > 0 ? Math.min(100, Math.max(0, (sample.resources.cpu_seconds - previous.resources.cpu_seconds) / elapsed / Math.max(1, sample.resources.cpu_cores) * 100)) : 0;
  });
  const cpu = cpuHistory.at(-1) || 0;
  const maximumSource = Math.max(1, ...dashboard.storage_sources.map(({ bytes }) => bytes));
  const healthy = (status: string) => status === "ready" || status === "embedded" || status === "external";
  return <section className="admin-dashboard" data-admin-dashboard>
    <header className="dashboard-heading"><div><h2>Instance overview</h2><p>Live health, capacity, storage, and Community activity.</p></div><span>Updated {new Date(dashboard.checked_at).toLocaleTimeString()}</span></header>
    {error && <p className="notice-error" role="alert">{error}</p>}
    <div className="dashboard-stat-grid">
      <DashboardStat label="Members" value={dashboard.counts.members.toLocaleString()} detail={`${dashboard.counts.online_members} online`} />
      <DashboardStat label="Messages" value={dashboard.counts.messages.toLocaleString()} detail={`${dashboard.message_rate.messages_per_minute} in the last minute`} />
      <DashboardStat label="Attachments" value={dashboard.counts.attachments.toLocaleString()} />
      <DashboardStat label="Process memory" value={formatBytes(resources.memory_bytes)} detail={`${formatBytes(resources.heap_bytes)} active heap`} />
      <DashboardStat label="CPU" value={`${cpu.toFixed(1)}%`} detail={`${resources.cpu_cores} logical cores`} />
      <DashboardStat label="App storage" value={formatBytes(resources.app_storage_bytes)} detail={`${formatBytes(resources.disk_available_bytes)} disk available`} />
      <DashboardStat label="Uptime" value={formatDuration(dashboard.uptime_seconds)} />
      <DashboardStat label="Relay" value={dashboard.health.relay} detail={`SFU ${dashboard.health.sfu}`} />
    </div>
    <div className="dashboard-chart-grid">
      <section className="settings-card dashboard-chart"><h3>Resource usage</h3><p className="muted">Process CPU and memory sampled while this dashboard is open.</p><div className="dashboard-resource-chart"><DashboardLineChart series={[{ label: "CPU", values: cpuHistory }]} formatter={(value) => value.toFixed(1)} suffix="%" /></div><div className="dashboard-resource-chart"><DashboardLineChart series={[{ label: "Memory", values: history.map(({ resources: value }) => value.memory_bytes / 1_048_576) }, { label: "App storage", values: history.map(({ resources: value }) => value.app_storage_bytes / 1_048_576) }]} formatter={(value) => value.toFixed(1)} suffix=" MiB" /></div></section>
      <section className="settings-card dashboard-chart"><h3>Messages sent</h3><p className="muted">Messages per minute over the last 30 minutes.</p><DashboardLineChart series={[{ label: "Messages/min", values: dashboard.message_rate.buckets.map(({ count }) => count) }]} formatter={Math.round} /></section>
    </div>
    <section className="settings-card"><h3>Storage by source</h3><p className="muted">Message and profile values are logical payload sizes inside SQLite; database and index overhead is shown separately.</p><div className="dashboard-storage">{dashboard.storage_sources.map((source) => <div className="dashboard-storage-row" key={source.name}><span>{source.name}</span><div><i style={{ width: `${source.bytes / maximumSource * 100}%` }} /></div><strong>{formatBytes(source.bytes)}</strong></div>)}</div></section>
    <section className="settings-card dashboard-health"><h3>Subsystem health</h3><div>{Object.entries(dashboard.health).map(([name, status]) => <div key={name}><span className={`dashboard-health-dot ${healthy(status) ? "ready" : status}`} /><strong>{name.replaceAll("_", " ")}</strong><span>{status}</span></div>)}</div></section>
  </section>;
}

function DashboardLineChart({ series, formatter, suffix = "" }: { series: Array<{ label: string; values: number[] }>; formatter(value: number): string | number; suffix?: string }) {
  const width = 620, height = 190, pad = 28;
  const values = series.flatMap((item) => item.values).filter(Number.isFinite);
  const maximum = Math.max(1, ...values);
  const count = Math.max(1, series[0]?.values.length || 0);
  const x = (index: number) => pad + index * (width - pad * 2) / Math.max(1, count - 1);
  const y = (value: number) => height - pad - value / maximum * (height - pad * 2);
  const colors = ["#6d75e8", "#35b978", "#d9a441"];
  return <><div className="dashboard-chart-legend">{series.map((item, index) => <span key={item.label} style={{ "--chart-color": colors[index] } as CSSProperties}>{item.label}: <strong>{formatter(item.values.at(-1) || 0)}{suffix}</strong></span>)}</div><svg className="dashboard-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.map(({ label }) => label).join(" and ")} history`}><line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} /><line x1={pad} y1={pad} x2={pad} y2={height - pad} /><text x={pad + 4} y={pad + 4}>{formatter(maximum)}{suffix}</text><text x={pad + 4} y={height - pad - 5}>0</text>{series.map((item, index) => <polyline key={item.label} fill="none" stroke={colors[index]} strokeWidth="2.5" vectorEffect="non-scaling-stroke" points={item.values.map((value, point) => `${x(point)},${y(value)}`).join(" ")} />)}</svg></>;
}

function formatDuration(seconds: number): string {
  const value = Math.max(0, seconds);
  const days = Math.floor(value / 86400), hours = Math.floor(value % 86400 / 3600), minutes = Math.floor(value % 3600 / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function MarkdownContent({ value }: { value: string }) {
  return <>{value.split(/\n{2,}/).map((block, index) => {
    const text = block.trim();
    if (!text) return null;
    const heading = /^(#{1,3})\s+(.+)$/.exec(text);
    if (heading) {
      const content = heading[2];
      if (heading[1].length === 1) return <h2 key={index}>{content}</h2>;
      if (heading[1].length === 2) return <h3 key={index}>{content}</h3>;
      return <h4 key={index}>{content}</h4>;
    }
    const lines = text.split("\n");
    if (lines.every((line) => /^[-*]\s+/.test(line))) return <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{line.replace(/^[-*]\s+/, "")}</li>)}</ul>;
    return <p key={index}>{lines.join(" ")}</p>;
  })}</>;
}

function NotificationSettings({
  state,
  onAction,
}: {
  state: InstanceViewState;
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
}) {
  type CommunityLevel = "all_messages" | "mentions_only" | "nothing";
  type ChannelLevel = "default" | CommunityLevel;
  const initialCommunityLevel: CommunityLevel = state.notifications.community.level === "default"
    ? "mentions_only"
    : state.notifications.community.level;
  const [community, setCommunity] = useState({
    level: initialCommunityLevel,
    muted: state.notifications.community.muted,
    soundEnabled: state.notifications.community.sound_enabled ?? true,
  });
  const [channels, setChannels] = useState(state.notifications.channels);
  const [notice, setNotice] = useState("");
  const [memberRingtone, setMemberRingtone] = useState(state.notifications.member_ringtone_set === true);

  async function saveCommunity(next: typeof community): Promise<void> {
    setCommunity(next);
    try {
      await onAction({ type: "set_community_notifications", ...next });
      setNotice("Community notification settings saved.");
    } catch {
      setNotice("Could not save notification settings.");
    }
  }

  async function saveChannel(channelId: string, next: { level: ChannelLevel; muted: boolean }): Promise<void> {
    setChannels((current) => ({ ...current, [channelId]: next }));
    try {
      await onAction({ type: "set_channel_notifications", channelId, ...next });
      setNotice("Channel notification settings saved.");
    } catch {
      setNotice("Could not save channel notification settings.");
    }
  }

  return (
    <section className="settings-panel notification-settings-page" data-notification-settings>
      <p className="eyebrow">Member settings</p>
      <h2>Notifications</h2>
      <p>Choose when this Community may notify you. Electron delivers native operating-system notifications.</p>
      <section className="settings-card">
        <h3>Desktop notifications</h3>
        <p className="notification-permission-state"><span className="presence-dot online" /> Native notifications enabled</p>
      </section>
      <RingtoneSetting scope="member" active={memberRingtone} fallbackLabel={state.notifications.community_ringtone_set ? "Using the Community ringtone." : "Using the generated tone."} onAction={onAction} onActiveChange={setMemberRingtone} />
      <section className="settings-card">
        <h3>Community defaults</h3>
        <label>Notification level<select aria-label="Community notification level" value={community.level} onChange={(event) => void saveCommunity({ ...community, level: event.target.value as CommunityLevel })}><option value="all_messages">All Messages</option><option value="mentions_only">Only @mentions</option><option value="nothing">Nothing</option></select></label>
        <label className="notification-check"><input type="checkbox" checked={community.muted} onChange={(event) => void saveCommunity({ ...community, muted: event.target.checked })} />Mute Community</label>
        <label className="notification-check"><input type="checkbox" checked={community.soundEnabled} onChange={(event) => void saveCommunity({ ...community, soundEnabled: event.target.checked })} />Notification sound</label>
      </section>
      <section className="settings-card channel-overrides">
        <h3>Channel overrides</h3>
        {state.channels.filter(({ type, archived }) => type === "text" && !archived).map((channel) => {
          const setting = channels[channel.id] || { level: "default" as const, muted: false };
          return <div className="channel-override" key={channel.id}>
            <strong><Icon name="hash" />{channel.name}</strong>
            <select aria-label={`${channel.name} notification level`} value={setting.level} onChange={(event) => void saveChannel(channel.id, { ...setting, level: event.target.value as ChannelLevel })}><option value="default">Community default</option><option value="all_messages">All Messages</option><option value="mentions_only">Only @mentions</option><option value="nothing">Nothing</option></select>
            <label className="notification-check"><input type="checkbox" checked={setting.muted} onChange={(event) => void saveChannel(channel.id, { ...setting, muted: event.target.checked })} />Mute</label>
          </div>;
        })}
      </section>
      <p role="status" aria-live="polite">{notice}</p>
    </section>
  );
}

function VoiceVideoSettings({ memberId }: { memberId: string }) {
  const [preferences, setPreferences] = useState<DesktopVoicePreferences>(() => loadDesktopVoicePreferences(memberId));
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [notice, setNotice] = useState("");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const cameraPreview = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => {
      setNotice("Media devices are unavailable.");
    });
  }, []);

  useEffect(() => {
    if (cameraPreview.current) cameraPreview.current.srcObject = cameraStream;
    return () => cameraStream?.getTracks().forEach((track) => track.stop());
  }, [cameraStream]);

  function save(next: DesktopVoicePreferences): void {
    setPreferences(saveDesktopVoicePreferences(memberId, next));
  }

  function patch(next: Partial<DesktopVoicePreferences>): void {
    save({ ...preferences, ...next });
  }

  async function testMicrophone(): Promise<void> {
    try {
      const capture = await captureDesktopMicrophone(memberId);
      setNotice(capture.compatibilityNotice || (capture.enhanced ? "Microphone is working with RNNoise." : "Microphone is working."));
      window.setTimeout(() => capture.stop(), 1_000);
    } catch {
      setNotice("Microphone permission was denied or the selected device is unavailable.");
    }
  }

  async function toggleCamera(): Promise<void> {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
      setNotice("Camera preview stopped.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: preferences.cameraID ? { deviceId: { ideal: preferences.cameraID } } : true,
      });
      setCameraStream(stream);
      setNotice("Camera preview started.");
    } catch {
      setNotice("Camera permission was denied or the selected device is unavailable.");
    }
  }

  function playSpeakerTest(): void {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    gain.gain.value = Math.min(1, preferences.outputVolume) * 0.12;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.25);
    oscillator.onended = () => void context.close();
    setNotice("Speaker test played.");
  }

  const microphones = devices.filter(({ kind }) => kind === "audioinput");
  const speakers = devices.filter(({ kind }) => kind === "audiooutput");
  const cameras = devices.filter(({ kind }) => kind === "videoinput");
  return (
    <section className="settings-panel voice-video-settings" data-voice-settings>
      <header className="voice-settings-intro">
        <p className="eyebrow">Local media preferences</p>
        <h2>Voice &amp; Video</h2>
        <p>Choose how you sound and look in Voice Rooms and Direct Calls. Your microphone audio is processed locally.</p>
      </header>
      <section className="voice-settings-section">
        <h3>Voice</h3>
        <div className="voice-device-grid">
          <label>Microphone<select aria-label="Microphone" value={preferences.microphoneID} onChange={(event) => patch({ microphoneID: event.target.value })}><option value="">System default</option>{microphones.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label>
          <label>Speaker<select aria-label="Speaker" value={preferences.speakerID} onChange={(event) => patch({ speakerID: event.target.value })}><option value="">System default</option>{speakers.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Speaker ${index + 1}`}</option>)}</select></label>
        </div>
        <label className="setting-row"><span><strong>Microphone volume</strong><small>Adjust the level sent to other Members.</small></span><output>{Math.round(preferences.inputGain * 100)}%</output><input aria-label="Microphone volume" type="range" min="0" max="2" step="0.05" value={preferences.inputGain} onChange={(event) => patch({ inputGain: Number(event.target.value) })} /></label>
        <label className="setting-row"><span><strong>Speaker volume</strong><small>Adjust all incoming voice audio.</small></span><output>{Math.round(preferences.outputVolume * 100)}%</output><input aria-label="Speaker volume" type="range" min="0" max="1" step="0.05" value={preferences.outputVolume} onChange={(event) => patch({ outputVolume: Number(event.target.value) })} /></label>
        <button type="button" onClick={() => void testMicrophone()}>Mic Test</button>
      </section>
      <section className="voice-settings-section">
        <h3>Input processing</h3>
        <label className="setting-row"><span><strong>Noise suppression</strong><small>Enhanced uses local RNNoise; Standard uses WebRTC.</small></span><select aria-label="Noise suppression" value={preferences.noiseSuppressionMode} onChange={(event) => patch({ noiseSuppressionMode: event.target.value as DesktopVoicePreferences["noiseSuppressionMode"] })}><option value="standard">Standard</option><option value="enhanced">Enhanced (RNNoise)</option><option value="off">Off</option></select></label>
        <label className="setting-row setting-toggle"><span><strong>Echo cancellation</strong><small>Reduces sound from your speakers returning through the microphone.</small></span><input type="checkbox" checked={preferences.echoCancellation} onChange={(event) => patch({ echoCancellation: event.target.checked })} /></label>
        <label className="setting-row setting-toggle"><span><strong>Automatic gain control</strong><small>Compensates for microphones that are unusually quiet.</small></span><input type="checkbox" checked={preferences.autoGainControl} onChange={(event) => patch({ autoGainControl: event.target.checked })} /></label>
        <label className="setting-row setting-toggle"><span><strong>Noise gate</strong><small>Closes the microphone below the sensitivity threshold.</small></span><input type="checkbox" checked={preferences.noiseGate} onChange={(event) => patch({ noiseGate: event.target.checked })} /></label>
        <label className="setting-row"><span><strong>Input sensitivity</strong></span><output>{preferences.noiseGateThresholdDB} dB</output><input aria-label="Input sensitivity" type="range" min="-80" max="-20" step="1" value={preferences.noiseGateThresholdDB} onChange={(event) => patch({ noiseGateThresholdDB: Number(event.target.value) })} /></label>
      </section>
      <section className="voice-settings-section">
        <h3>Camera</h3>
        <div className="camera-test"><video ref={cameraPreview} autoPlay muted playsInline hidden={!cameraStream} /><div className="camera-placeholder" hidden={Boolean(cameraStream)}>Camera preview is off</div></div>
        <label>Camera<select aria-label="Camera" value={preferences.cameraID} onChange={(event) => patch({ cameraID: event.target.value })}><option value="">System default</option>{cameras.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>
        <button type="button" onClick={() => void toggleCamera()}>{cameraStream ? "Stop Video" : "Test Video"}</button>
      </section>
      <section className="voice-settings-section">
        <h3>Advanced</h3>
        <div className="setting-row"><span><strong>Speaker test</strong><small>Play a short tone through the selected output device.</small></span><button type="button" onClick={playSpeakerTest}>Play sound</button></div>
        <div className="setting-row"><span><strong>Reset Voice &amp; Video settings</strong><small>Restore safe defaults.</small></span><button className="danger-button" type="button" onClick={() => { save(defaultDesktopVoicePreferences); setNotice("Voice & Video settings were reset."); }}>Reset</button></div>
      </section>
      <p className="voice-settings-notice" role="status" aria-live="polite">{notice}</p>
    </section>
  );
}

function ProfileImages({
  member,
  onAction,
}: {
  member: InstanceViewState["member"];
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
}) {
  const [editor, setEditor] = useState<{ kind: "avatar" | "banner"; file: File; url: string; zoom: number } | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => () => { if (editor) URL.revokeObjectURL(editor.url); }, [editor?.url]);

  function choose(kind: "avatar" | "banner", file?: File): void {
    if (!file) return;
    if (editor) URL.revokeObjectURL(editor.url);
    setEditor({ kind, file, url: URL.createObjectURL(file), zoom: 1 });
    setStatus(`${kind === "avatar" ? "Avatar" : "Profile banner"} crop ready to upload.`);
  }

  async function uploadCrop(): Promise<void> {
    if (!editor) return;
    const image = new Image();
    image.src = editor.url;
    await image.decode();
    const [width, height] = editor.kind === "avatar" ? [512, 512] : [1200, 344];
    const targetAspect = width / height;
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;
    if (sourceWidth / sourceHeight > targetAspect) sourceWidth = sourceHeight * targetAspect;
    else sourceHeight = sourceWidth / targetAspect;
    sourceWidth /= editor.zoom;
    sourceHeight /= editor.zoom;
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d")?.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not crop image.")), "image/png"));
    await onAction({ type: "update_profile_image", kind: editor.kind, contentType: blob.type, data: new Uint8Array(await blob.arrayBuffer()) });
    setStatus(`${editor.kind === "avatar" ? "Avatar" : "Profile banner"} updated.`);
    setEditor(null);
  }
  return (
    <div className="profile-images">
      <fieldset className="profile-image-field profile-avatar-field">
        <legend>Avatar</legend>
        <AuthenticatedImage path={member.avatarUrl} alt="Profile avatar" className="profile-avatar" onAction={onAction} />
        <div className="profile-image-actions">
          <label>Choose image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => choose("avatar", event.target.files?.[0])} /></label>
          <button type="button" onClick={() => void onAction({ type: "remove_profile_image", kind: "avatar" })}>Remove avatar</button>
        </div>
      </fieldset>
      <fieldset className="profile-image-field profile-banner-field">
        <legend>Profile banner</legend>
        <AuthenticatedImage path={member.bannerUrl} alt="Profile banner" className="profile-banner" onAction={onAction} />
        <div className="profile-image-actions">
          <label>Choose image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => choose("banner", event.target.files?.[0])} /></label>
          <button type="button" onClick={() => void onAction({ type: "remove_profile_image", kind: "banner" })}>Remove banner</button>
        </div>
      </fieldset>
      <p className="profile-image-status" role="status">{status}</p>
      {editor && createPortal(<section className="image-crop-dialog" role="dialog" aria-modal="true" aria-label={`Crop ${editor.kind}`}><h2>Crop {editor.kind === "avatar" ? "Avatar" : "Profile Banner"}</h2><div className={`image-crop-preview image-crop-${editor.kind}`}><img src={editor.url} alt="Crop preview" style={{ transform: `scale(${editor.zoom})` }} /></div><label>Zoom<input aria-label="Crop zoom" type="range" min="1" max="3" step="0.05" value={editor.zoom} onChange={(event) => setEditor({ ...editor, zoom: Number(event.target.value) })} /></label><div className="dialog-actions"><button type="button" onClick={() => void uploadCrop()}>Upload {editor.kind}</button><button type="button" onClick={() => setEditor(null)}>Cancel</button></div></section>, document.body)}
    </div>
  );
}

function SafetyPanel({
  reports,
  records,
  members,
  onAction,
  onReports,
}: {
  reports: import("../shared/instance-actions").Report[];
  records: import("../shared/instance-actions").ModerationRecord[] | null;
  members: InstanceViewState["members"];
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
  onReports(value: import("../shared/instance-actions").Report[]): void;
}) {
  async function exportAccount(): Promise<void> {
    const result = await onAction({ type: "export_account" });
    if (result?.type !== "asset") return;
    const url = URL.createObjectURL(
      new Blob([result.data as BlobPart], { type: result.contentType }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "allchat-account-export.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="safety-panel">
      <h3>Safety</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void onAction({
            type: "create_report",
            targetMemberId: String(data.get("memberId") || ""),
            reason: String(data.get("reason") || ""),
          }).then((result) => {
            if (result?.type === "report")
              onReports([result.report, ...reports]);
          });
        }}
      >
        <label>
          Report a Member
          <select name="memberId" required>
            <option value="">Choose a Member</option>
            {members.map((member) => (
              <option value={member.id} key={member.id}>
                {memberName(member)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reason
          <textarea name="reason" minLength={3} maxLength={1000} required />
        </label>
        <button type="submit">Submit Report</button>
      </form>
      <div className="report-list">
        {reports.map((report) => (
          <article key={report.id}>
            <strong>
              {report.status === "open" ? "Open Report" : "Resolved Report"}
            </strong>
            <p>{report.reason}</p>
            {report.status === "open" && records && (
              <button
                type="button"
                onClick={() => {
                  const outcome = window.prompt("Resolution outcome");
                  if (!outcome) return;
                  void onAction({
                    type: "resolve_report",
                    reportId: report.id,
                    outcome,
                  }).then((result) => {
                    if (result?.type === "report")
                      onReports(
                        reports.map((item) =>
                          item.id === report.id ? result.report : item,
                        ),
                      );
                  });
                }}
              >
                Resolve
              </button>
            )}
          </article>
        ))}
      </div>
      {records && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void onAction({
                type: "moderate",
                action: String(data.get("action") || ""),
                targetMemberId: String(data.get("memberId") || ""),
                reason: String(data.get("reason") || ""),
                durationMinutes: Number(data.get("duration") || 0),
              });
            }}
          >
            <h4>Moderation Action</h4>
            <label>
              Action
              <select name="action">
                <option value="warn">Warn</option>
                <option value="timeout">Timeout</option>
                <option value="suspend">Suspend</option>
                <option value="kick">Kick</option>
              </select>
            </label>
            <label>
              Member
              <select name="memberId" required>
                {members.map((member) => (
                  <option value={member.id} key={member.id}>
                    {memberName(member)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reason
              <textarea name="reason" minLength={3} required />
            </label>
            <label>
              Duration in minutes
              <input name="duration" type="number" min="0" />
            </label>
            <button type="submit">Apply Action</button>
          </form>
          <details>
            <summary>Moderation Records</summary>
            {records.map((record) => (
              <article key={record.id}>
                <strong>{record.action}</strong>
                <p>
                  {record.reason} — {record.outcome}
                </p>
              </article>
            ))}
          </details>
          <button
            type="button"
            onClick={() => {
              const before = window.prompt(
                "Purge records created before this RFC 3339 timestamp",
              );
              if (before && window.confirm("Permanently purge these records?"))
                void onAction({ type: "purge_moderation_records", before });
            }}
          >
            Purge Old Records
          </button>
        </>
      )}
      <button type="button" onClick={() => void exportAccount()}>
        Export Account Data
      </button>
      <form
        className="danger-zone"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          if (!window.confirm("Permanently anonymize this Account?")) return;
          void onAction({
            type: "delete_account",
            password: String(data.get("password") || ""),
            confirmation: String(data.get("confirmation") || ""),
          });
        }}
      >
        <h4>Delete Account</h4>
        <label>
          Password
          <input name="password" type="password" required />
        </label>
        <label>
          Type DELETE
          <input name="confirmation" pattern="DELETE" required />
        </label>
        <button type="submit">Delete Account</button>
      </form>
    </section>
  );
}
