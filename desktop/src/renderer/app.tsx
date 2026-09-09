import { MemberAudioControls, PanelIcon, ConnectionSignal, connectionPing } from "./member-audio-controls";
import { ReplyComposerPreview, ReplyExcerpt } from "./message-reply";
import { CallHistoryEvent } from "./call-history-event";
import { ChannelManagement, RoleManagement, InvitationManagement, SoundboardManagement } from "./community-management";
import { ImageContextMenu, copyImage } from "./image-context-menu";
import { InlineMessageEditor } from "./inline-message-editor";
import { SettingsHeading } from "./settings-heading";
import { CallParticipantCell } from "./call-participant-cell";
import { VoiceParticipantGrid } from "./voice-grid";
import { FormEvent, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createMediaConnectionWatchdog, createMediaFrameQueue, createMediaJoinFrame, desktopMediaOwnerID, mediaDisconnectMessage, serializeSessionDescription, type DesktopMediaFrame } from "./media-signaling";
import { applyDesktopOutputPreferences, captureDesktopMicrophone, defaultDesktopVoicePreferences, desktopMemberOutputVolume, loadDesktopVoicePreferences, saveDesktopVoicePreferences, type DesktopMicrophoneCapture, type DesktopVoicePreferences } from "./voice-capture";
import { insertMention, matchMention } from "./mentions";
import { createScreenShareAutoController, lowestScreenShareTier, prepareScreenShareTrack, screenSharePreset, screenShareStats, setScreenShareTier, type ScreenShareTier } from "./screen-share-quality";

import type { DesktopBridge, DesktopUpdateState, ShellState } from "../shared/desktop-bridge";
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
  const [updateState, setUpdateState] = useState<DesktopUpdateState>({ status: "idle" });

  useEffect(() => {
    void bridge.getShellState().then(setState);
  }, [bridge]);
  useEffect(() => {
    void bridge.getUpdateState?.().then(setUpdateState);
    return bridge.watchUpdateState?.(setUpdateState);
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
              direct_messages: current.direct_messages.map((dm) => dm.id === result.conversationId ? { ...dm, unread: 0 } : dm),
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
    <DesktopTitleBar updateState={updateState} onInstallUpdate={() => void bridge.installUpdate?.()} onAction={(action) => void bridge.controlWindow?.(action)} />
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
            onIncomingCallNotification={bridge.setIncomingCallNotification}
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
    .find((message) => message.author_id === currentMemberId && !message.deleted && !message.call_event);
}

function DesktopTitleBar({ updateState, onInstallUpdate, onAction }: { updateState: DesktopUpdateState; onInstallUpdate(): void; onAction(action: import("../shared/desktop-bridge").WindowControlAction): void }) {
  const progress = updateState.status === "downloading" && updateState.totalBytes
    ? Math.min(100, Math.round(updateState.receivedBytes / updateState.totalBytes * 100))
    : null;
  return <header className="desktop-titlebar" aria-label="Window controls">
    <span className="desktop-titlebar-title">AllChat</span>
    <div className="desktop-update-status" aria-live="polite">
      {updateState.status === "downloading" && <span>Downloading {updateState.version}{progress === null ? "…" : ` · ${progress}%`}</span>}
      {updateState.status === "ready" && <button className="desktop-upgrade-button" type="button" onClick={onInstallUpdate}>Upgrade to {updateState.version}</button>}
      {updateState.status === "failed" && <span className="desktop-update-failed" title={updateState.message}>Update failed</span>}
    </div>
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
  onIncomingCallNotification,
  onConversationChange,
}: {
  instanceId: string;
  state: InstanceViewState;
  homeRequestRevision: number;
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
  connectMedia?: DesktopBridge["connectMedia"];
  onIncomingCallNotification?: DesktopBridge["setIncomingCallNotification"];
  onConversationChange?(conversationId: string | null): void;
}) {
  const [conversation, setConversation] = useState<{
    id: string;
    name: string;
    type: "text" | "voice" | "dm";
    topic?: string;
  } | null>(null);
  const [homeView, setHomeView] = useState<"community" | "direct-messages">("community");
  const [activityInstallations, setActivityInstallations] = useState<import("../shared/instance-actions").ActivityInstallation[] | null>(null);
  const [activityLaunch, setActivityLaunch] = useState<{activityId:string;token:string;runtimeUrl:string}|null>(null);
	const [activityTrayOpen, setActivityTrayOpen] = useState(false);
	const [activityError, setActivityError] = useState("");
  const [directMessageMemberId, setDirectMessageMemberId] = useState("");
  const [communityGuide, setCommunityGuide] = useState<string | null>(null);
  const [voiceParticipantsByChannel, setVoiceParticipantsByChannel] = useState<Record<string, import("../shared/instance-actions").VoiceParticipant[]>>({});
  const [requestedVoiceRoom, setRequestedVoiceRoom] = useState<string | null>(null);
  const [activeInputStream, setActiveInputStream] = useState<MediaStream | null>(null);
  const [directCall, setDirectCall] = useState<import("../shared/instance-actions").DirectCall | null>(null);
  const [focusedMediaMemberId, setFocusedMediaMemberId] = useState<string | null>(null);
  const [settingsView, setSettingsView] = useState<
    "profile" | "voice" | "ringtone" | "notifications" | "sessions" | "safety" | "community" | null
  >(null);
  const [communitySettingsSection, setCommunitySettingsSection] = useState("general");
  const [draft, setDraft] = useState("");
  const [mentionCaret, setMentionCaret] = useState(-1);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<import("../shared/instance-state").Message | null>(null);
  const replyTo = replyTarget?.channel_id === conversation?.id ? replyTarget?.id : null;
  const replyMessage = replyTo ? state.messages[conversation!.id]?.find(message => message.id === replyTo) || replyTarget : null;
  const [attachments, setAttachments] = useState<File[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<
    import("../shared/instance-state").SearchResult[] | null
  >(null);
  const [searchNextCursor, setSearchNextCursor] = useState<string | null>(null);
  const [searchActiveQuery, setSearchActiveQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
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
  const memberCardRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const card = memberCardRef.current;
    if (!card || !memberPopover) return;
    const position = () => {
      const bounds = card.getBoundingClientRect();
      card.style.left = `${Math.max(8, Math.min(memberPopover.left, window.innerWidth - bounds.width - 8))}px`;
      card.style.top = `${Math.max(8, Math.min(memberPopover.top, window.innerHeight - bounds.height - 8))}px`;
    };
    position();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(position) : null;
    observer?.observe(card);
    window.addEventListener("resize", position);
    return () => { observer?.disconnect(); window.removeEventListener("resize", position); };
  }, [memberPopover, memberActionsOpen]);
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
    setActivityInstallations(null);
    setActivityLaunch(null);
    setSettingsView(null);
    setCommunityMenuOpen(false);
    setMemberMenuOpen(false);
    setSearchResults(null);
    setShowPins(false);
  }, [homeRequestRevision]);
  useEffect(() => {
    if (!focusedMediaMemberId) return;
    const exit = (event: KeyboardEvent) => { if (event.key === "Escape") setFocusedMediaMemberId(null); };
    document.addEventListener("keydown", exit);
    return () => document.removeEventListener("keydown", exit);
  }, [focusedMediaMemberId]);

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
  const pendingMessageJump = useRef<{ conversationId: string; messageId: string; windowStart: number } | null>(null);
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
  const directCallActive = !!(directCall?.state === "accepted" && conversation?.type === "dm" && directCall.direct_message_id === conversation.id);
  const [collapsedCallChat, setCollapsedCallChat] = useState<{callId: string; sequence: number} | null>(null);
  const callChatScroll = useRef<{conversationId: string; top: number} | null>(null);
  const callChatHidden = directCallActive && collapsedCallChat?.callId === directCall?.id;
  const hiddenChatUnread = callChatHidden ? Math.max(activeDirectMessage?.unread || 0,
    (state.messages[conversation!.id] || []).filter(message => message.sequence > collapsedCallChat!.sequence && message.author_id !== state.member.id && !message.deleted).length) : 0;
  const toggleCallChat = () => {
    if (!directCall || !conversation) return;
    if (callChatHidden) {
      setCollapsedCallChat(null);
      const last = state.messages[conversation.id]?.at(-1);
      if (last) void onAction({type: "update_read_position", conversationId: conversation.id, direct: true, sequence: last.sequence});
    } else {
      callChatScroll.current = {conversationId: conversation.id, top: messageListRef.current?.scrollTop || 0};
      setCollapsedCallChat({callId: directCall.id, sequence: state.messages[conversation.id]?.at(-1)?.sequence || 0});
    }
  };
  useLayoutEffect(() => {
    if (!callChatHidden && callChatScroll.current?.conversationId === conversation?.id && messageListRef.current && callChatScroll.current) {
      messageListRef.current.scrollTop = callChatScroll.current.top;
      callChatScroll.current = null;
    }
  }, [callChatHidden, conversation?.id]);
  const directMessageBlocked = !!(activeDirectMessage?.blocked_by_me || activeDirectMessage?.blocked_me);
  useEffect(() => {
    onConversationChange?.(conversation && conversation.type !== "voice" && !callChatHidden ? conversation.id : null);
    return () => onConversationChange?.(null);
  }, [conversation?.id, conversation?.type, callChatHidden, onConversationChange]);
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

  const openVoiceRoom = () => {
    const room = channels.find(channel => channel.id === requestedVoiceRoom);
    if (!room) return;
    setSettingsView(null);
    setConversation({ id: room.id, name: room.name, type: "voice" });
  };
  const openDirectCall = (directMessageId: string) => {
    const directMessage = state.direct_messages.find(({ id }) => id === directMessageId);
    if (!directMessage) return;
    setSettingsView(null);
    setHomeView("direct-messages");
    setConversation({ id: directMessage.id, name: memberName(directMessage.other), type: "dm" });
  };
	const openActivityTray = () => {
    if (!activityTrayOpen) {
      if (requestedVoiceRoom) openVoiceRoom();
      else if (directCall?.state === "accepted") openDirectCall(directCall.direct_message_id);
    }
		setActivityTrayOpen((current) => !current);
		setActivityError("");
		if (activityInstallations !== null) return;
		void onAction({ type: "list_activities" }).then((result) => {
			if (result?.type === "activities") setActivityInstallations(result.activities);
		}).catch(() => setActivityError("Activities are unavailable on this Instance."));
	};
	const activityDock = () => <>

		<div className="call-activity-dock">
			{activityTrayOpen && <section className="call-activity-picker" aria-label="Call Activities">
				<header><strong>Activities</strong>{activityLaunch && <button type="button" onClick={() => setActivityLaunch(null)}>Close Activity</button>}</header>
				{activityError && <p role="status">{activityError}</p>}
				{activityInstallations === null && !activityError && <p>Loading Activities…</p>}
				{activityInstallations?.filter((item) => item.enabled).map((item) => <button type="button" key={item.manifest.id} onClick={() => {
					setActivityError("");
					void onAction({ type: "launch_activity", activityId: item.manifest.id }).then((result) => {
						if (result?.type === "activity_launch") { setActivityLaunch(result); setActivityTrayOpen(false); }
					}).catch(() => setActivityError("Could not launch this Activity."));
				}}><span className="activity-mark">✎</span><span><strong>{item.manifest.name}</strong><small>{item.manifest.description}</small></span></button>)}
				{activityInstallations?.filter((item) => item.enabled).length === 0 && <p>No Activities are enabled.</p>}
			</section>}

		</div>
	</>;
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
    const pendingJump = conversation && pendingMessageJump.current?.conversationId === conversation.id ? pendingMessageJump.current : null;
    stickToBottom.current = !pendingJump;
    setAwayFromPresent(false);
    setDraft(
      conversation
        ? localStorage.getItem(draftKey(instanceId, conversation.id)) || ""
        : "",
    );
    setEditingMessageId(null);
    setReplyTarget(null);
	setShowPins(false);
	setPinnedMessages(null);
    if (conversation && conversation.type !== "voice") {
      const messages = state.messages[conversation.id] || [];
      historyExhausted.current[conversation.id] = (messages[0]?.sequence || 1) <= 1;
      newerHistoryTruncated.current[conversation.id] = false;
      setMessageWindowStarts((current) => ({ ...current, [conversation.id]: pendingJump ? pendingJump.windowStart : null }));
      const last = pendingJump ? undefined : messages.at(-1);
      if (last)
        void onAction({
          type: "update_read_position",
          conversationId: conversation.id,
          direct: conversation.type === "dm",
          sequence: last.sequence,
        });
      if (pendingJump) requestAnimationFrame(() => requestAnimationFrame(() => {
        document.getElementById(`message-${pendingJump.messageId}`)?.scrollIntoView({ block: "center" });
        if (pendingMessageJump.current === pendingJump) pendingMessageJump.current = null;
      }));
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
    if (!list || callChatHidden) return;
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

  async function runMessageSearch(query: string, cursor?: string): Promise<void> {
    setSearchLoading(true);
    if (!cursor) setSearchActiveQuery(query);
    try {
      const result = await onAction({ type: "search_messages", query, ...(cursor ? { cursor } : {}) });
      if (result?.type !== "search_results") return;
      setSearchResults((current) => cursor && current ? [...current, ...result.results.filter((incoming) => !current.some(({ message }) => message.id === incoming.message.id))] : result.results);
      setSearchNextCursor(result.nextCursor || null);
    } finally {
      setSearchLoading(false);
    }
  }

  async function jumpToSearchResult(result: import("../shared/instance-state").SearchResult): Promise<void> {
    const directMessage = state.direct_messages.find(({ id }) => id === result.message.channel_id);
    const channel = state.channels.find(({ id }) => id === result.message.channel_id);
    if (!directMessage && !channel) return;
    const nextConversation = directMessage
      ? { id: directMessage.id, name: memberName(directMessage.other), type: "dm" as const }
      : { id: channel!.id, name: channel!.name, type: channel!.type, topic: channel!.topic };
    if (nextConversation.type === "voice") return;
    stickToBottom.current = false;
    const page = await onAction({ type: "load_messages", conversationId: nextConversation.id, direct: nextConversation.type === "dm", before: result.message.sequence + 1, limit: 50 });
    const loaded = page?.type === "messages" ? page.page.messages : [result.message];
    const merged = mergeMessages(state.messages[nextConversation.id] || [], loaded, "older");
    const targetIndex = Math.max(0, merged.findIndex(({ id }) => id === result.message.id));
    setSettingsView(null);
    setHomeView(directMessage ? "direct-messages" : "community");
    setConversation(nextConversation);
    pendingMessageJump.current = { conversationId: nextConversation.id, messageId: result.message.id, windowStart: Math.max(0, targetIndex - 20) };
    setSearchResults(null);
    setSearchNextCursor(null);
  }

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
      {
            type: "send_message",
            conversationId: conversation.id,
            direct: conversation.type === "dm",
            body,
            attachmentIds,
            ...(replyTo ? { replyTo } : {}),
          },
    );
    setDraft("");
    setReplyTarget(null);
    setAttachments([]);
    localStorage.removeItem(draftKey(instanceId, conversation.id));
  }
  function beginEditingMessage(message: InstanceViewState["messages"][string][number]): void {
    setEditingMessageId(message.id);
  }
  function closeMessageEditor(): void {
    setEditingMessageId(null);
    textareaRef.current?.focus();
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
  const showMemberPopover = (memberId: string, bounds: DOMRect, fromDirectory = false) => {
    setMemberActionsOpen(false);
    setMemberPopover({
      memberId,
      left: Math.max(8, Math.min(window.innerWidth - 328, fromDirectory ? bounds.left - 328 : bounds.left)),
      top: Math.max(8, fromDirectory ? bounds.top : bounds.bottom + 8),
    });
  };
  const jumpToPresentControl = awayFromPresent && (
    <div className="jump-to-present">
      <span>You're Viewing Older Messages</span>
      <button type="button" onClick={() => { void loadPresentMessages(); }}>
        Jump to Present
      </button>
    </div>
  );

  return (
    <div className={`community-shell${settingsView === "community" ? " community-settings-open" : settingsView ? " member-settings-open" : ""}`}>
      <aside className="conversation-sidebar">
        {settingsView && settingsView !== "community" && (
          <>
            <button className="settings-back" type="button" onClick={() => setSettingsView(null)}>‹  Back to Community</button>
            <div className="member-settings-heading">Settings</div>
            <p className="settings-nav-label">Your account</p>
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
                aria-current={settingsView === "ringtone" ? "page" : undefined}
                onClick={() => setSettingsView("ringtone")}
              >Ringtone</button>
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
              {state.member.owner && <>
                <p className="settings-nav-label">Community</p>
                <button type="button" onClick={() => setSettingsView("community")}>General</button>
              </>}
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
                              left: event.clientX,
                              top: event.clientY,
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
        <div className="floating-member-panel">
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
          <MemberAudioControls memberId={state.member.id} inputStream={activeInputStream} onVoiceSettings={() => setSettingsView("voice")} />
          <button
            type="button"
            aria-label="User Settings"
            onClick={() => setSettingsView("profile")}
          >
            <Icon name="settings" />
          </button>
        </footer>
        {activityDock()}
        </div>
      </aside>
      <section className="conversation-content">
        <header hidden={Boolean(settingsView)}>
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
                  : settingsView === "ringtone"
                    ? "Ringtone"
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
                className="header-button header-text-button"
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
              onIncomingCallNotification={onIncomingCallNotification}
              requestedVoiceRoom={requestedVoiceRoom}
              requestedVoiceRoomName={channels.find(({ id }) => id === requestedVoiceRoom)?.name || "Voice Channel"}
              focusedMediaMemberId={focusedMediaMemberId}
              onOpenDirectCall={openDirectCall}
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
              onInputStream={setActiveInputStream}
              onOpenActivities={openActivityTray}
              onOpenVoiceRoom={openVoiceRoom}
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
                void runMessageSearch(query);
              }}
            >
              <Icon name="search" />
              <input
                name="query"
                type="search"
                aria-label="Search Messages"
                placeholder={`Search ${state.community.name}`}
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
        {settingsView ? settingsView === "community" ? (
          <div className="community-settings-layout">
            <CommunityAdministration state={state} onAction={onAction} onSectionChange={setCommunitySettingsSection} onBack={() => setSettingsView(null)} />
          </div>
        ) : (
          <div className="settings-layout">
            <section className="settings-content">
              {settingsView === "profile" && <>
              <SettingsHeading title="My Account" description="Make yourself at home. Choose how other Members see you." />
              <div className="account-profile-grid">
              <form
                className="profile-form settings-card"
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
                <h3>Profile details</h3>
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
                <p>Your display name appears in conversations.</p>
                <button className="settings-primary" type="submit">Save Profile</button>
              </form>
              <ProfileImages member={state.member} onAction={onAction} />
              </div>
              <div className="presence-controls settings-card">
                <div><h3>Presence</h3><p>Choose when you’re available to chat.</p></div>
                <button
                  type="button"
                  onClick={() =>
                    { setPresenceOverride("online"); void onAction({ type: "set_presence", mode: "available" }); }
                  }
                  aria-pressed={(presenceOverride || state.presence[state.member.id]) === "online"}
                >
                  Online
                </button>
                <button
                  type="button"
                  onClick={() =>
                    { setPresenceOverride("dnd"); void onAction({ type: "set_presence", mode: "dnd" }); }
                  }
                  aria-pressed={(presenceOverride || state.presence[state.member.id]) === "dnd"}
                >
                  Do Not Disturb
                </button>
              </div>
              </>}
              {settingsView === "voice" && (
                <VoiceVideoSettings memberId={state.member.id} />
              )}
              {settingsView === "ringtone" && (
                <RingtoneSettings state={state} onAction={onAction} />
              )}
              {settingsView === "notifications" && (
                <NotificationSettings
                  state={state}
                  onAction={onAction}
                />
              )}
              {settingsView === "sessions" && (
                <section className="session-list">
                  <SettingsHeading title="Sessions" description="See where you’re signed in and manage access to your account." />
                  {!sessions && <p role="status">Loading Sessions…</p>}
                  {sessions && [true, false].map((currentDevice) => <section className="settings-card session-group" key={String(currentDevice)}>
                    <h3>{currentDevice ? "This device" : "Other sessions"}</h3>
                    {!currentDevice && <p>Revoke a session to sign out that device.</p>}
                    {!currentDevice && !sessions.some((session) => !session.current) && <p>No other active sessions.</p>}
                  {sessions.filter((session) => session.current === currentDevice).map((session) => (
                    <article key={session.id}>
                      {session.current && <span className="session-device-icon"><Icon name="monitor" /></span>}
                      <span className="session-device-details">
                        <strong>{session.device}</strong>
                        <small>
                          {session.current
                            ? "You’re using AllChat here."
                            : `Last active ${new Date(session.last_activity).toLocaleString()}`}
                        </small>
                      </span>
                      {session.current && <span className="current-session-badge">●  Current Session</span>}
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
                          Revoke session
                        </button>
                      )}
                    </article>
                  ))}
                  </section>)}
                </section>
              )}
              {settingsView === "safety" && (
                <section className="settings-panel">
                  {!reports && <><SettingsHeading title="Safety" description="Manage reports and take control of your account data." /><p role="status">Loading Safety information…</p></>}
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
        ) : conversation ? (
          conversation.type === "voice" ? (
            <section className="media-stage voice-room-stage">
              <VoiceParticipantGrid count={visibleVoiceParticipants.length}>
                {visibleVoiceParticipants.length === 0 ? (
                  <p className="media-stage-empty">No one is connected to this Voice Room.</p>
                ) : visibleVoiceParticipants.map((participant) => {
                  const member = state.members.find(({ id }) => id === participant.member_id);
                  const name = member ? memberName(member) : "Member";
                  return <CallParticipantCell avatarPath={member?.avatarUrl} name={name} onAction={onAction} className={`${participant.speaking ? "speaking" : ""} ${focusedMediaMemberId === participant.member_id ? "expanded" : ""}`} role="button" tabIndex={0} aria-label={`Focus ${name}`} data-media-member-id={participant.member_id} key={participant.member_id} onClick={() => setFocusedMediaMemberId((current) => current === participant.member_id ? null : participant.member_id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setFocusedMediaMemberId((current) => current === participant.member_id ? null : participant.member_id); } }} onContextMenu={(event) => {
                    event.preventDefault();
                    setVoiceMemberMenu({ participant, left: event.clientX, top: event.clientY });
                  }}>
                    <strong>{name}</strong>
                    {participant.screen_sharing && <span>Sharing video</span>}
                    {focusedMediaMemberId === participant.member_id && <button className="media-focus-close" type="button" aria-label={`Exit focus for ${name}`} onClick={(event) => { event.stopPropagation(); setFocusedMediaMemberId(null); }}><Icon name="x" /></button>}
                  </CallParticipantCell>;
                })}
              </VoiceParticipantGrid>
              {requestedVoiceRoom === conversation.id && activityLaunch && <iframe className="call-activity-frame" title="Call Activity" sandbox="allow-scripts" src={`${activityLaunch.runtimeUrl}#${activityLaunch.token}`} />}
            </section>
          ) : (
            <section className={directCallActive ? `conversation-workspace direct-call-workspace${callChatHidden ? " chat-collapsed" : ""}` : "conversation-workspace"}>
              {directCallActive && (
                <section className="media-stage direct-call-stage" aria-label="Direct Call grid">
                  <button type="button" className="call-chat-toggle" aria-label={callChatHidden ? "Show chat" : "Hide chat"} title={callChatHidden ? "Show chat" : "Hide chat"} aria-expanded={!callChatHidden} aria-controls="conversation-chat-pane" onClick={toggleCallChat}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={callChatHidden ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"}/></svg>
                    {hiddenChatUnread > 0 && <span className="call-chat-unread" aria-label={`${hiddenChatUnread} unread messages`}>{hiddenChatUnread > 99 ? "99+" : hiddenChatUnread}</span>}
                  </button>
                  <div className="media-stage-grid" data-tile-count={2}>
                    {[state.member, activeDirectMessage?.other].filter((member): member is import("../shared/desktop-bridge").MemberSummary => Boolean(member)).map((participant) => {
                      const name = memberName(participant);
                      return <CallParticipantCell avatarPath={participant.avatarUrl} name={name} onAction={onAction} className={`${focusedMediaMemberId === participant.id ? "expanded" : ""}`} role="button" tabIndex={0} aria-label={`Focus ${participant.id === state.member.id ? "You" : name}`} data-media-member-id={participant.id} key={participant.id} onClick={() => setFocusedMediaMemberId((current) => current === participant.id ? null : participant.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setFocusedMediaMemberId((current) => current === participant.id ? null : participant.id); } }} onContextMenu={(event) => {
                        if (participant.id === state.member.id || !directCall) return;
                        event.preventDefault();
                        setVoiceMemberMenu({
                          directCall: true,
                          participant: { member_id: participant.id, room_id: directCall.id, connected: true, joined_at: directCall.created_at, server_muted: false, muted: false, speaking: false, screen_sharing: false },
                          left: event.clientX,
                          top: event.clientY,
                        });
                      }}>
                            <strong>{participant.id === state.member.id ? "You" : name}</strong>
                        {focusedMediaMemberId === participant.id && <button className="media-focus-close" type="button" aria-label={`Exit focus for ${participant.id === state.member.id ? "You" : name}`} onClick={(event) => { event.stopPropagation(); setFocusedMediaMemberId(null); }}><Icon name="x" /></button>}
                      </CallParticipantCell>;
                    })}
                  </div>
					{activityLaunch && <iframe className="call-activity-frame" title="Call Activity" sandbox="allow-scripts" src={`${activityLaunch.runtimeUrl}#${activityLaunch.token}`} />}
                </section>
              )}
            <div id="conversation-chat-pane" className="conversation-chat-pane" hidden={callChatHidden}>
            {directCallActive && <header className="call-chat-heading">Chat</header>}
            <div
              className={directCallActive ? "message-list direct-call-chat" : "message-list"}
              aria-label={`${conversation.name} Messages`}
              ref={messageListRef}
              onLoadCapture={() => {
                const list = messageListRef.current;
                if (!list || callChatHidden || !stickToBottom.current) return;
                list.scrollTop = list.scrollHeight;
                requestAnimationFrame(() => { if (stickToBottom.current) list.scrollTop = list.scrollHeight; });
              }}
              onLoadedMetadataCapture={() => {
                const list = messageListRef.current;
                if (list && !callChatHidden && stickToBottom.current) list.scrollTop = list.scrollHeight;
              }}
              onScroll={(event) => {
                if (callChatHidden) return;
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
                .map((message) => message.call_event ? (
                  <CallHistoryEvent key={message.id} message={message} currentMemberId={state.member.id} otherName={activeDirectMessage ? memberName(activeDirectMessage.other) : "Member"} />
                ) : (
                  <article className={`message${editingMessageId === message.id ? " message-editing" : ""}${replyTo === message.id ? " message-reply-target" : ""}${message.reply ? " has-reply" : ""}`} id={`message-${message.id}`} key={message.id}>
                    <AuthenticatedImage
                      path={message.author_avatar_url}
                      alt=""
                      className="avatar"
                      fallback={message.author_name.slice(0, 1).toUpperCase()}
                      onAction={onAction}
                    />
                    <div>
                      {message.reply && <ReplyExcerpt reply={message.reply} />}
                      <button type="button" className="message-author-trigger" data-member-trigger disabled={!state.members.some(member => member.id === message.author_id)} onClick={event => showMemberPopover(message.author_id, event.currentTarget.getBoundingClientRect())}>{message.author_name}</button>
                      <time dateTime={message.created_at}>
                        {formatMessageTime(message.created_at)}
                      </time>
                      {editingMessageId === message.id && !message.deleted ? <InlineMessageEditor key={message.id} body={message.body || ""}
                        onSave={async body => (await onAction({ type: "edit_message", messageId: message.id, body }))?.type === "message"}
                        onClose={closeMessageEditor} /> : <div className="message-body">{message.deleted ? "Message deleted" : <MessageBody body={message.body || ""} mentions={message.mentions || []} />}</div>}
                      {message.body && (
                        <LinkPreview body={message.body} onAction={onAction} />
                      )}
                      <MessageAttachments attachments={message.attachments || []} onAction={onAction} />
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
                      {!message.deleted && editingMessageId !== message.id && (
                        <span className="message-actions">
                          <button
                            type="button"
                            onClick={() => { setReplyTarget(message); textareaRef.current?.focus(); }}
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
                                onClick={() => beginEditingMessage(message)}
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
              {directMessageBlocked && jumpToPresentControl}
              {directMessageBlocked && (
                <div className="blocked-conversation">
                  {activeDirectMessage?.blocked_by_me
                    ? "You blocked this Member. Unblock them to send Messages."
                    : "This Member is not accepting Messages."}
                </div>
              )}
              {!directMessageBlocked && <div className="message-composer-wrap">
                {jumpToPresentControl}
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
                {replyMessage && <ReplyComposerPreview message={replyMessage} onCancel={() => { setReplyTarget(null); textareaRef.current?.focus(); }} />}
                <textarea
                  ref={textareaRef}
                  aria-label={`Message ${conversation.name}`}
                  placeholder={`Message #${conversation.name}`}
                  value={draft}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && replyTo && !mentionMatch) { event.preventDefault(); setReplyTarget(null); return; }
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
                        beginEditingMessage(message);
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
      {searchResults && !settingsView ? (
        <aside className="member-directory search-results-pane" aria-label="Search Results">
          <header><h2>Search Results — {searchResults.length}</h2><button type="button" aria-label="Close Search" onClick={() => { setSearchResults(null); setSearchNextCursor(null); }}><Icon name="x" /></button></header>
          <div className="search-results-list">
            {searchResults.length ? searchResults.map((result) => (
              <article className="search-result-message" key={result.message.id}>
                <small>#{result.channel_name} · {result.category_name}</small>
                <button type="button" className="message-author-trigger" data-member-trigger disabled={!state.members.some(member => member.id === result.message.author_id)} onClick={event => showMemberPopover(result.message.author_id, event.currentTarget.getBoundingClientRect())}>{result.message.author_name}</button>
                <time>{formatMessageTime(result.message.created_at)}</time>
                <div className="message-body"><MessageBody body={result.message.body || ""} mentions={result.message.mentions || []} /></div>
                <button type="button" onClick={() => void jumpToSearchResult(result)}>Jump to message</button>
              </article>
            )) : <p>No results found.</p>}
          </div>
          {searchNextCursor && <button className="search-load-more" type="button" disabled={searchLoading} onClick={() => void runMessageSearch(searchActiveQuery, searchNextCursor)}>{searchLoading ? "Loading…" : "Load more"}</button>}
        </aside>
      ) : membersOpen && !settingsView && homeView === "community" && (!conversation || conversation.type === "text") && (
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
                    showMemberPopover(member.id, event.currentTarget.getBoundingClientRect(), true);
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
              ref={memberCardRef}
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
                {member.id !== state.member.id && <button className="member-card-more" type="button" aria-label="Member actions" aria-expanded={memberActionsOpen} onClick={() => setMemberActionsOpen((open) => !open)}>⋯</button>}
                <button className="member-card-close" type="button" aria-label="Close member profile" onClick={() => setMemberPopover(null)}>×</button>
              </div>
              <div className="member-card-body">
                <AuthenticatedImage
                  path={member.avatarUrl}
                  alt=""
                  className="member-card-avatar"
                  fallback={memberName(member).slice(0, 1).toUpperCase()}
                  onAction={onAction}
                />
                <span className={`member-card-presence presence-dot ${state.presence[member.id] || "offline"}`} aria-hidden="true" />
                <h3>{memberName(member)}</h3>
			    <p>@{member.username}{member.disabled ? " · Disabled" : ""}</p>
                <div className="member-card-meta"><span>{member.owner ? "Owner" : "Member"}</span><span>{({ online: "Online", offline: "Offline", idle: "Idle", dnd: "Do Not Disturb", mobile: "Mobile" } as Record<string, string>)[state.presence[member.id] || "offline"]}</span></div>
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
				  {state.member.owner && !member.owner && <div className="member-card-moderation">
					<button type="button" onClick={() => void onAction({ type: "set_member_disabled", memberId: member.id, disabled: !member.disabled }).then(() => setMemberPopover(null))}>{member.disabled ? "Restore" : "Disable"}</button>
					<button className="danger-button" type="button" onClick={() => { const confirmation = window.prompt(`Permanently delete ${memberName(member)} and everything tied to this Member? Type understood to continue.`); if (confirmation !== "understood") return; void onAction({ type: "delete_member", memberId: member.id, confirmation }).then(() => setMemberPopover(null)); }}>Delete Member</button>
				  </div>}
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
        const self = member.id === state.member.id;
        const roomName = voiceMemberMenu.directCall ? "Direct Call" : state.channels.find(channel => channel.id === participant.room_id)?.name || "Voice Room";
        return <VoiceMemberMenu
          name={memberName(member)} context={self ? `You · ${roomName}` : `In ${roomName}`}
          avatar={<AuthenticatedImage path={member.avatarUrl} alt="" className="voice-menu-avatar" fallback={memberName(member).slice(0, 1).toUpperCase()} onAction={onAction} />}
          presence={state.presence[member.id] || "offline"}
          self={self} canModerate={!voiceMemberMenu.directCall && state.member.owner && !self}
          serverMuted={participant.server_muted} volume={memberVolume}
          left={voiceMemberMenu.left} top={voiceMemberMenu.top}
          onClose={() => setVoiceMemberMenu(null)}
          onVolume={(next) => {
            saveDesktopVoicePreferences(state.member.id, { ...preferences, memberVolumes: { ...preferences.memberVolumes, [member.id]: next } });
            setVoiceMemberMenu((current) => current ? { ...current } : null);
          }}
          onProfile={() => {
            showMemberPopover(member.id, new DOMRect(voiceMemberMenu.left, voiceMemberMenu.top, 0, 0));
            setVoiceMemberMenu(null);
          }}
          onMessage={() => void onAction({ type: "open_dm", memberId: member.id }).then((result) => {
            if (result?.type === "direct_message") setConversation({ id: result.directMessage.id, name: memberName(result.directMessage.other), type: "dm" });
            setVoiceMemberMenu(null);
          })}
          onMute={() => {
            void onAction({ type: "moderate_voice_participant", roomId: participant.room_id, memberId: member.id, action: participant.server_muted ? "unmute" : "mute" });
            setVoiceMemberMenu(null);
          }}
          onDisconnect={() => {
            void onAction({ type: "moderate_voice_participant", roomId: participant.room_id, memberId: member.id, action: "disconnect" });
            setVoiceMemberMenu(null);
          }}
          onCopy={() => { void navigator.clipboard.writeText(member.id); setVoiceMemberMenu(null); }}
        />;
      })(), document.body)}
    </div>
  );
}

export function VoiceMemberMenu(props: {
  name: string; context: string; avatar: ReactNode; presence: string;
  self: boolean; canModerate: boolean; serverMuted: boolean; volume: number;
  left: number; top: number;
  onVolume(value: number): void; onProfile(): void; onMessage(): void;
  onMute(): void; onDisconnect(): void; onCopy(): void; onClose(): void;
}) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const position = () => {
      const bounds = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(props.left, window.innerWidth - bounds.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(props.top, window.innerHeight - bounds.height - 8))}px`;
    };
    position();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(menu);
    window.addEventListener("resize", position);
    menu.focus();
    return () => { observer?.disconnect(); window.removeEventListener("resize", position); };
  }, [props.left, props.top, props.self, props.canModerate]);
  const moderate = props.canModerate && !props.self;
  return <nav ref={ref} className="voice-member-context" role="menu" aria-label="Voice Member actions" data-voice-member-menu tabIndex={-1}
    style={{ position: "fixed", left: props.left, top: props.top }}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); props.onClose(); } }}>
    <header className="voice-menu-identity">
      <div className="voice-menu-avatar-wrap">{props.avatar}<span className={`presence-dot ${props.presence}`} aria-hidden="true" /></div>
      <div><strong>{props.name}</strong><span>{props.context}</span></div>
    </header>
    {!props.self && <label className="voice-member-volume">
      <span>Member volume</span><output>{Math.round(props.volume * 100)}%</output>
      <input aria-label={`${props.name} volume`} type="range" min="0" max="1" step="0.05" value={props.volume} onChange={event => props.onVolume(Number(event.target.value))} />
      <small>Only changes what you hear</small>
    </label>}
    <div className="voice-menu-actions">
      <button type="button" role="menuitem" onClick={props.onProfile}><Icon name="user" />View profile</button>
      {!props.self && <button type="button" role="menuitem" onClick={props.onMessage}><Icon name="messages" />Message</button>}
    </div>
    {moderate && <div className="voice-menu-moderation" role="group" aria-label="Community actions">
      <span>Community actions</span>
      <button type="button" role="menuitemcheckbox" aria-checked={props.serverMuted} onClick={props.onMute}><Icon name="mic-off" />Server mute<span className="voice-menu-toggle" aria-hidden="true" /></button>
      <button className="danger-text" type="button" role="menuitem" onClick={props.onDisconnect}><Icon name="log-out" />Disconnect</button>
    </div>}
    <div className={`voice-menu-utility${props.self ? " self" : ""}`}><button type="button" role="menuitem" onClick={props.onCopy}><Icon name="copy" />Copy user ID</button></div>
  </nav>;
}

export function SoundboardMenu({ sounds, onPlay, onClose, anchor }: {
  sounds: { id: string; name: string; emoji?: string }[];
  onPlay(id: string): void; onClose(): void; anchor?: HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);
  const [position, setPosition] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const box = anchor.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 16);
      setPosition({
        left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)),
        bottom: window.innerHeight - box.top + 8,
        width,
        maxHeight: Math.max(0, Math.min(430, box.top - 16)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [anchor]);
  return createPortal(<div ref={ref} style={position} className="desktop-soundboard" role="dialog" aria-label="Community soundboard"
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header><strong>Soundboard</strong><button type="button" aria-label="Close soundboard" onClick={onClose}><Icon name="x" /></button></header>
    {sounds.length ? <div className="soundboard-sounds">{sounds.map(sound => <button type="button" key={sound.id} title={sound.name} onClick={() => onPlay(sound.id)}>
      <span aria-hidden="true">{sound.emoji || <Icon name="waveform" />}</span><strong>{sound.name}</strong>
    </button>)}</div> : <div className="soundboard-empty"><span><Icon name="music" /></span><strong>No sounds yet</strong><p>Community sounds will appear here.</p></div>}
  </div>, document.body);
}

export function DirectCallControls({
  conversation,
  directCallNames = {},
  currentMemberId,
  instanceId,
  onAction,
  connectMedia,
  onIncomingCallNotification,
  requestedVoiceRoom,
  requestedVoiceRoomName,
  focusedMediaMemberId,
  onOpenDirectCall,
  onInputStream,
  onOpenActivities,
  onOpenVoiceRoom,
  onVoiceRoomChange,
  onCallChange,
}: {
  conversation: { id: string; name?: string; type: "text" | "voice" | "dm" } | null;
  directCallNames?: Record<string, string>;
  currentMemberId: string;
  instanceId: string;
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
  connectMedia?: DesktopBridge["connectMedia"];
  onIncomingCallNotification?: DesktopBridge["setIncomingCallNotification"];
  requestedVoiceRoom: string | null;
  requestedVoiceRoomName: string;
  focusedMediaMemberId: string | null;
  onInputStream?(stream: MediaStream | null): void;
  onOpenActivities?(): void;
  onOpenVoiceRoom?(): void;
  onOpenDirectCall?(directMessageId: string): void;
  onVoiceRoomChange(roomId: string | null): void;
  onCallChange(call: import("../shared/instance-actions").DirectCall | null): void;
}) {
  const [call, setCall] = useState<import("../shared/instance-actions").DirectCall | null>(null);
  const [status, setStatus] = useState("");
  const transientStatus = useRef<ReturnType<typeof createTransientCallStatusController> | null>(null);
  const [muted, setMuted] = useState(() => { const p = loadDesktopVoicePreferences(currentMemberId); return Boolean(p.muted || p.deafened); });
  const [ping, setPing] = useState<number | null>(null);
  const [videoSource, setVideoSource] = useState<"camera" | "screen" | null>(null);
  const [sharing, setSharing] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const [sounds, setSounds] = useState<import("../shared/instance-actions").SoundboardSound[]>([]);
  const [outputVolume, setOutputVolume] = useState(() => loadDesktopVoicePreferences(currentMemberId).outputVolume);
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [remoteScreens, setRemoteScreens] = useState<Record<string, MediaStream>>({});
  const [voiceRoom, setVoiceRoom] = useState<string | null>(null);
  const voiceRoomRef = useRef<string | null>(null);
  const media = useRef<{ stream: MediaStream; capture: DesktopMicrophoneCapture; peer: RTCPeerConnection; socket: import("../shared/desktop-bridge").DesktopMediaConnection; audio: Map<string, HTMLAudioElement[]>; screen?: MediaStream; videoSource?: "camera" | "screen"; screenSender?: RTCRtpSender; screenAudioSenders: RTCRtpSender[]; displayAudioSender: RTCRtpSender; signaling: ReturnType<typeof createMediaFrameQueue>; screenBusy?: boolean; screenQualityTimer?: number; requestedScreenTier: ScreenShareTier; automaticScreenTier: ScreenShareTier } | null>(null);
  const connectingRoom = useRef<string | null>(null);
  const mediaGeneration = useRef(0);
  const disposeProvisional = useRef<((explicit?: boolean) => void) | null>(null);
  const pendingVoiceLeave = useRef<Promise<void> | null>(null);
  const voiceJoinGeneration = useRef(0);
  const activeMediaCall = useRef<import('../shared/instance-actions').DirectCall | null>(null);
  const resumeToken = useRef('');
  const recovery = useRef<{deadline: number; attempts: number; timer?: ReturnType<typeof setTimeout>; capture?: DesktopMicrophoneCapture; muted: boolean}>({deadline: 0, attempts: 0, muted: false});
  const mediaTerminated = useRef(false);
  const lastMediaAck = useRef(0);
  const attemptDeadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heartbeat = useRef<number | null>(null);
  const connectionWatchdog = useRef<ReturnType<typeof createMediaConnectionWatchdog> | null>(null);
  const mediaFailure = useRef("");
  const stoppedRemoteScreenOwners = useRef(new Set<string>());
  const remoteScreenStreams = useRef(new Map<string, MediaStream>());
  transientStatus.current ||= createTransientCallStatusController(setStatus, () => media.current?.peer.connectionState === "connected" ? "Call connected" : null);
  connectionWatchdog.current ||= createMediaConnectionWatchdog(setStatus, () => ({
    connection: media.current?.peer.connectionState || "closed",
    ice: media.current?.peer.iceConnectionState || "closed",
  }), 10_000, window.setTimeout, window.clearTimeout, (message) => recoverMedia(new Error(message)));

  const cleanup = (recovering = false) => {
    mediaGeneration.current++;
    disposeProvisional.current?.(!recovering); disposeProvisional.current = null;
    if (attemptDeadline.current) clearTimeout(attemptDeadline.current);
    if (recovery.current.timer) clearTimeout(recovery.current.timer);
    recovery.current.timer = undefined;
    if (!recovering) { recovery.current.capture?.stop(); recovery.current.capture = undefined; recovery.current.deadline = 0; activeMediaCall.current = null; resumeToken.current = ''; recovery.current.muted = false; recovery.current.attempts = 0; }
    transientStatus.current?.clear();
    const active = media.current;
    media.current = null;
    if (!recovering) active?.socket.send({ version: 1, type: "leave" });
    active?.signaling.close();
    active?.socket.close();
    active?.peer.close();
    if (recovering && active) { recovery.current.capture = active.capture; recovery.current.muted = active.stream.getAudioTracks()[0]?.enabled === false; } else active?.capture.stop();
    active?.screen?.getTracks().forEach((track) => track.stop());
    if (active?.screenQualityTimer !== undefined) window.clearInterval(active.screenQualityTimer);
    active?.audio.forEach((elements) => elements.forEach((element) => element.remove()));
    if (heartbeat.current !== null) window.clearInterval(heartbeat.current);
    heartbeat.current = null;
    connectionWatchdog.current?.stop();
    connectingRoom.current = null;
    setPing(null);
    onInputStream?.(null);
    setVideoSource(null);
    setSharing(false);
    setLocalScreen(null);
    setRemoteScreens({});
    stoppedRemoteScreenOwners.current.clear();
    remoteScreenStreams.current.clear();
    setSoundboardOpen(false);
  };

  function recoverMedia(error: Error & {code?: string}): void {
    if (mediaTerminated.current) return;
    const activeCall = activeMediaCall.current;
    if (!activeCall) return;
    if (['moderated', 'superseded', 'already_active', 'unauthorized', 'join_failed'].includes(error.code || '')) {
      cleanup(); mediaTerminated.current = true; setStatus(error.message); return;
    }
    if (error.code === 'invalid_resume') resumeToken.current = '';
    if (recovery.current.timer) return;
    recovery.current.deadline ||= Date.now() + 30_000;
    if (Date.now() >= recovery.current.deadline) { cleanup(); mediaTerminated.current = true; setStatus('Media recovery timed out. Rejoin to try again.'); return; }
    cleanup(true);
    setStatus('Reconnecting media…');
    const delay = Math.min(4000, 500 * 2 ** Math.min(recovery.current.attempts++, 3), recovery.current.deadline - Date.now());
    recovery.current.timer = setTimeout(() => {
      recovery.current.timer = undefined;
      if (Date.now() >= recovery.current.deadline) { recoverMedia(new Error('Media recovery timed out')); return; }
      void connect(activeCall, false).catch(recoverMedia);
    }, Math.max(0, delay));
  }

  async function connect(activeCall: import("../shared/instance-actions").DirectCall, explicit = false): Promise<void> {
    if (media.current || connectingRoom.current || !connectMedia || (!explicit && (mediaTerminated.current || recovery.current.timer))) return;
    mediaTerminated.current = false;
    activeMediaCall.current = activeCall;
    const generation = ++mediaGeneration.current;
    const current = () => generation === mediaGeneration.current;
    const ensureCurrent = () => { if (!current()) throw new Error('Media connection cancelled'); };
    attemptDeadline.current = setTimeout(() => { if (current()) recoverMedia(new Error('Media connection timed out')); }, Math.min(10_000, recovery.current.deadline ? Math.max(0, recovery.current.deadline - Date.now()) : 10_000));
    connectingRoom.current = activeCall.id;
    mediaFailure.current = "";
    let provisionalCapture: DesktopMicrophoneCapture | null = null;
    let provisionalPeer: RTCPeerConnection | null = null;
    let provisionalSocket: import("../shared/desktop-bridge").DesktopMediaConnection | null = null;
    let explicitlyDisposed = false;
    const dispose = (explicit = false) => { explicitlyDisposed ||= explicit; if (explicitlyDisposed) provisionalSocket?.send({version: 1, type: "leave"}); provisionalCapture?.stop(); provisionalPeer?.close(); provisionalSocket?.close(); };
    disposeProvisional.current = dispose;
    try {
    setStatus("Requesting microphone permission…");
    const savedCapture = recovery.current.capture;
    recovery.current.capture = undefined;
    const capture = savedCapture || await captureDesktopMicrophone(currentMemberId);
    const stream = capture.stream;
    provisionalCapture = capture;
    ensureCurrent();
    const initialAudioPreferences = loadDesktopVoicePreferences(currentMemberId);
    stream.getAudioTracks().forEach(track => { track.enabled = !(initialAudioPreferences.muted || initialAudioPreferences.deafened || recovery.current.muted); });
    if (capture.compatibilityNotice) setStatus(capture.compatibilityNotice);
    const credentials = await onAction({ type: "turn_credentials" });
    ensureCurrent();
    if (credentials?.type !== "turn_credentials") throw new Error("TURN credentials unavailable.");
    const peer = provisionalPeer = new RTCPeerConnection({ iceServers: credentials.iceServers });
    const audio = new Map<string, HTMLAudioElement[]>();
    const pendingCandidates: RTCIceCandidateInit[] = [];
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    const displayAudioSender = peer.addTransceiver("audio", { direction: "sendrecv" }).sender;
    const videoTransceiver = peer.addTransceiver("video", {direction: "sendrecv", sendEncodings: screenSharePreset(loadDesktopVoicePreferences(currentMemberId).screenShareMode).encodings});
    const codecs = RTCRtpSender.getCapabilities('video')?.codecs;
    if (codecs) videoTransceiver.setCodecPreferences([...codecs.filter(codec=>codec.mimeType.toLowerCase()==='video/vp8'), ...codecs.filter(codec=>codec.mimeType.toLowerCase()!=='video/vp8')]);
    let socket: import("../shared/desktop-bridge").DesktopMediaConnection | null = null;
    peer.onicecandidate = ({ candidate }) => {
      if (!current() || !candidate) return;
      const encoded = candidate.toJSON();
      if (socket) socket.send({ version: 1, type: "candidate", candidate: encoded });
      else pendingCandidates.push(encoded);
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer);
    ensureCurrent();
    const signaling = createMediaFrameQueue(peer, (frame) => socket?.send(frame), {
      onAnswer: (frame) => { if (!current()) return; if(frame.resume_token) resumeToken.current = frame.resume_token; socket?.send({version: 1, type: 'mute-state', muted: stream.getAudioTracks()[0]?.enabled === false}); setStatus(peer.connectionState === "connected" ? "Call connected" : "Finishing media connection…"); },
      onFailure: (error) => { if(current()) recoverMedia(error); },
      onCommandError: (frame) => { if(current()) setStatus(frame.error || 'Media command rejected'); },
      onVideoStopped: (memberID) => {
        stoppedRemoteScreenOwners.current.add(memberID);
        setRemoteScreens((current) => {
          if (!current[memberID]) return current;
          const next = { ...current };
          delete next[memberID];
          return next;
        });
      },
      onVideoStarted: (memberID) => {
        stoppedRemoteScreenOwners.current.delete(memberID);
        const stream = remoteScreenStreams.current.get(memberID);
        if (stream) setRemoteScreens((current) => ({ ...current, [memberID]: stream }));
      },
      onScreenQuality: (quality) => {
        const sender = media.current?.screenSender;
        if (!sender) return;
        if (!media.current) return;
        media.current.requestedScreenTier = quality;
        media.current.socket.send({version: 1, type: "publisher-quality", quality: lowestScreenShareTier(quality, media.current.automaticScreenTier)});
        void setScreenShareTier(sender, lowestScreenShareTier(quality, media.current.automaticScreenTier)).catch(() => undefined);
      },
    });
    socket = provisionalSocket = await connectMedia(instanceId, (value) => {
      if (!current()) return;
      if ((value as DesktopMediaFrame).type === "heartbeat-ack") lastMediaAck.current = Date.now();
      const frame = value as DesktopMediaFrame & { sound?: { audio_url?: string } };
      if (frame.type === "soundboard-played" && frame.sound?.audio_url) {
        void onAction({ type: "load_asset", path: frame.sound?.audio_url }).then((result) => {
          if (result?.type !== "asset") return;
          const url = URL.createObjectURL(new Blob([result.data as BlobPart], { type: result.contentType }));
          const element = new Audio(url);
          applyDesktopOutputPreferences(element, currentMemberId);
          element.onended = () => URL.revokeObjectURL(url);
          void element.play().catch(() => URL.revokeObjectURL(url));
        });
      }
      void signaling.push(value as DesktopMediaFrame).catch((error) => {
        if (!current()) return;
        mediaFailure.current = error instanceof Error ? error.message : "Media signaling failed.";
        recoverMedia(Object.assign(error instanceof Error ? error : new Error(mediaFailure.current), {code: (error as {code?: string}).code}));
      });
    }, (reason) => {
      if (!current()) return;
      const message = mediaDisconnectMessage(mediaFailure.current, reason);
      recoverMedia(new Error(message));
    });
    ensureCurrent();
    media.current = { stream, capture, peer, socket, audio, signaling, displayAudioSender, screenSender: videoTransceiver.sender, screenAudioSenders: [], requestedScreenTier: "high", automaticScreenTier: "high" };
    onInputStream?.(stream);
    provisionalCapture = null; provisionalPeer = null; provisionalSocket = null;
    if (disposeProvisional.current === dispose) disposeProvisional.current = null;
    peer.ontrack = ({ streams, track }) => {
      if (!current()) return;
      const remoteStream = streams[0] || new MediaStream([track]);
      if (track.kind === "video") {
        const fallbackOwner = activeCall.caller_id === currentMemberId ? activeCall.recipient_id : activeCall.caller_id;
        const owner = desktopMediaOwnerID(track.id, streams[0]?.id) || fallbackOwner;
        remoteScreenStreams.current.set(owner, remoteStream);
        bindRemoteScreenTrack(track, remoteStream, owner, setRemoteScreens, () => current() && !stoppedRemoteScreenOwners.current.has(owner));
        return;
      }
      if (track.kind !== "audio") return;
      const fallbackOwner = activeCall.caller_id === currentMemberId ? activeCall.recipient_id : activeCall.caller_id;
      const owner = desktopMediaOwnerID(track.id, streams[0]?.id) || fallbackOwner;
      const element = document.createElement("audio");
      element.autoplay = true;
      element.srcObject = new MediaStream([track]);
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
      if (!current()) return;
      if (peer.connectionState === 'connected') { clearTimeout(attemptDeadline.current); recovery.current.deadline = 0; recovery.current.attempts = 0; setMuted(stream.getAudioTracks()[0]?.enabled === false); }
      connectionWatchdog.current?.stateChanged();
    };
    peer.onconnectionstatechange = updateConnectionState;
    peer.oniceconnectionstatechange = updateConnectionState;
    socket.send(createMediaJoinFrame(activeCall.id, peer.localDescription, resumeToken.current, explicit));
    pendingCandidates.splice(0).forEach((candidate) => socket!.send({ version: 1, type: "candidate", candidate }));
    lastMediaAck.current = Date.now();
    heartbeat.current = window.setInterval(() => { if (!current()) return; if (Date.now() - lastMediaAck.current > 25_000) recoverMedia(new Error('Media heartbeat timed out')); else socket?.send({ version: 1, type: "heartbeat" }); }, 5_000);
    connectionWatchdog.current?.start();
    setStatus("Connecting…");
    } catch (error) {
      provisionalCapture?.stop(); provisionalPeer?.close(); provisionalSocket?.close();
      if (!current()) return;
      recoverMedia(error instanceof Error ? error : new Error('Media connection failed'));
    } finally {
      if(current()) connectingRoom.current = null;
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
      if (pendingVoiceLeave.current) await pendingVoiceLeave.current;
      await navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then((stream) => stream.getTracks().forEach((track) => track.stop()));
      const result = await onAction({ type: "start_call", directMessageId: conversation.id });
      if (result?.type === "call") { setCall(result.call); onCallChange(result.call); setStatus("Calling…"); }
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not start Call."); }
  }

  async function act(action: "accept" | "decline" | "end"): Promise<void> {
    if (!call) return;
    if (action === "accept") mediaTerminated.current = false;
    if (action === "accept") onOpenDirectCall?.(call.direct_message_id);
    const result = await onAction({ type: "call_action", callId: call.id, action });
    if (result?.type === "call") { setCall(result.call); onCallChange(result.call); }
    if (action === "decline" || action === "end") { cleanup(); setCall(null); onCallChange(null); setStatus(""); }
  }

  async function joinVoice(room: string): Promise<void> {
    if (voiceRoomRef.current === room && !pendingVoiceLeave.current) return;
    const joinGeneration = ++voiceJoinGeneration.current;
    try {
      if (pendingVoiceLeave.current) await pendingVoiceLeave.current;
      else if (voiceRoomRef.current) await leaveVoice(false);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not leave Voice."); return; }
    if (joinGeneration !== voiceJoinGeneration.current) return;
    mediaTerminated.current = false;
    voiceRoomRef.current = room;
    setVoiceRoom(room);
    try {
      await connect({ id: room, direct_message_id: "", caller_id: currentMemberId, recipient_id: "", state: "accepted", created_at: new Date().toISOString() }, true);
    } catch (error) {
      if (joinGeneration !== voiceJoinGeneration.current) return;
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
      void leaveVoice().catch(error => setStatus(error instanceof Error ? error.message : "Could not leave Voice."));
    }
  }, [requestedVoiceRoom]);

  function leaveVoice(notify = true): Promise<void> {
    if (pendingVoiceLeave.current) return pendingVoiceLeave.current;
    const room = voiceRoomRef.current;
    if (!room) return Promise.resolve();
    if (notify) voiceJoinGeneration.current++;
    mediaTerminated.current = true;
    cleanup();
    setStatus("Disconnecting Voice…");
    const pending = onAction({type: "end_media_session", roomId: room}).then(result => {
      if (result?.type !== "accepted") throw new Error("Could not disconnect Voice. Try again.");
      if (voiceRoomRef.current !== room) return;
      voiceRoomRef.current = null;
      setVoiceRoom(null);
      if (notify) onVoiceRoomChange(null);
      setStatus("");
    }).finally(() => { if (pendingVoiceLeave.current === pending) pendingVoiceLeave.current = null; });
    pendingVoiceLeave.current = pending;
    return pending;
  }

  async function stopScreenShare(): Promise<void> {
    const active = media.current;
    if (!active?.screen) return;
    const screen = active.screen;
    active.screen = undefined;
    setLocalScreen(null);
    screen.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    await active.screenSender?.replaceTrack(null);
    await active.displayAudioSender.replaceTrack(null);
    if (media.current !== active) return;
    active.screenAudioSenders = [];
    if (active.screenQualityTimer !== undefined) window.clearInterval(active.screenQualityTimer);
    active.screenQualityTimer = undefined;
    active.socket.send({ version: 1, type: "video-stopped" });
    setSharing(false);
    setVideoSource(null);
    active.videoSource = undefined;
  }

  async function toggleScreenShare(): Promise<void> {
    const active = media.current;
    if (!active) return;
    if (active.screenBusy) return;
    if (active.screen && active.videoSource === "screen") return stopScreenShare();
    if (active.screen) await stopScreenShare();
    active.screenBusy = true;
    let acquired: MediaStream | undefined;
    try {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen sharing is unavailable on this operating system.");
    const screen = acquired = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if(media.current !== active) { screen.getTracks().forEach(track=>track.stop()); return; }
    const video = screen.getVideoTracks()[0];
    if (!video) { screen.getTracks().forEach((track) => track.stop()); throw new Error("No screen was selected."); }
    active.screen = screen;
    active.videoSource = "screen";
    const preferences = loadDesktopVoicePreferences(currentMemberId);
    const preset = screenSharePreset(preferences.screenShareMode);
    await prepareScreenShareTrack(video, preset);
    if(media.current !== active) { screen.getTracks().forEach(track=>track.stop()); return; }
    const transceiver = active.screenSender
      ? null
      : active.peer.addTransceiver(video, { direction: "sendonly", streams: [screen], sendEncodings: preset.encodings });
    if (active.screenSender) await active.screenSender.replaceTrack(video);
    if(media.current !== active) { screen.getTracks().forEach(track=>track.stop()); return; }
    setLocalScreen(screen);
    active.screenSender = transceiver?.sender || active.screenSender;
    active.requestedScreenTier = "high";
    active.automaticScreenTier = "high";
    if (preferences.screenShareMode === "auto" && active.screenSender) {
      const controller = createScreenShareAutoController();
      active.screenQualityTimer = window.setInterval(() => {
        const sender = media.current?.screenSender;
        if (!sender || media.current?.screen !== screen) return;
        void sender.getStats().then((report) => {
          let reason = "none";
          report.forEach((entry) => { if (entry.type === "outbound-rtp" && (entry.kind === "video" || entry.mediaType === "video")) reason = entry.qualityLimitationReason || reason; });
          if (!media.current || media.current.screen !== screen) return;
          media.current.automaticScreenTier = controller.sample({ qualityLimitationReason: reason });
          media.current.socket.send({version: 1, type: "publisher-quality", quality: lowestScreenShareTier(media.current.requestedScreenTier, media.current.automaticScreenTier)});
          void setScreenShareTier(sender, lowestScreenShareTier(media.current.requestedScreenTier, media.current.automaticScreenTier)).catch(() => undefined);
        }).catch(() => undefined);
      }, 2_000);
    }
    await active.displayAudioSender.replaceTrack(screen.getAudioTracks()[0] || null);
    active.screenAudioSenders = screen.getAudioTracks().length ? [active.displayAudioSender] : [];
    video.onended = () => { if (media.current === active && active.screen === screen) void stopScreenShare().catch(() => {}); };
    if (transceiver) await active.signaling.renegotiate();
    if(media.current !== active) { screen.getTracks().forEach(track=>track.stop()); return; }
    active.socket.send({ version: 1, type: "video-started" });
    setSharing(true);
    setVideoSource("screen");
    } catch(error) { acquired?.getTracks().forEach(track=>track.stop()); if(media.current===active) await stopScreenShare(); throw error; } finally { active.screenBusy=false; }
  }

  async function toggleCameraShare(): Promise<void> {
    const active = media.current;
    if (!active || active.screenBusy) return;
    if (active.screen && active.videoSource === "camera") return stopScreenShare();
    if (active.screen) await stopScreenShare();
    active.screenBusy = true;
    let camera: MediaStream | undefined;
    try {
      const preferences = loadDesktopVoicePreferences(currentMemberId);
      camera = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...(preferences.cameraID ? { deviceId: { ideal: preferences.cameraID } } : {}), width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
      if (media.current !== active) { camera.getTracks().forEach(track => track.stop()); return; }
      const video = camera.getVideoTracks()[0];
      if (!video || !active.screenSender) throw new Error("Camera sharing is unavailable.");
      active.screen = camera;
      active.videoSource = "camera";
      await active.screenSender.replaceTrack(video);
      if (media.current !== active) { camera.getTracks().forEach(track => track.stop()); return; }
      video.onended = () => { if (media.current === active && active.screen === camera) void stopScreenShare(); };
      active.socket.send({ version: 1, type: "video-started" });
      setLocalScreen(camera); setVideoSource("camera"); setSharing(false);
    } catch (error) {
      camera?.getTracks().forEach(track => track.stop());
      if (media.current === active) await stopScreenShare();
      throw error;
    } finally { active.screenBusy = false; }
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
  }

  const incoming = call?.state === "ringing" && call.recipient_id === currentMemberId;
  const directCallName = call ? directCallNames[call.direct_message_id] || (conversation?.type === "dm" && conversation.id === call.direct_message_id ? conversation.name : "") || "Direct Call" : "Direct Call";
  useEffect(() => {
    if (!incoming || !call) return;
    onIncomingCallNotification?.({ callId: call.id, callerName: directCallName });
    return () => onIncomingCallNotification?.(null);
  }, [incoming, call?.id, directCallName, onIncomingCallNotification]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("allchat:direct-call-active", { detail: { active: Boolean(call) } }));
    return () => { window.dispatchEvent(new CustomEvent("allchat:direct-call-active", { detail: { active: false } })); };
  }, [Boolean(call)]);
  useEffect(() => {
    let inputGeneration = 0;
    let inputSwitch = Promise.resolve();
    const inputKey = (p: DesktopVoicePreferences) => JSON.stringify([p.microphoneID, p.noiseSuppressionMode, p.echoCancellation, p.autoGainControl]);
    let previousInput = inputKey(loadDesktopVoicePreferences(currentMemberId));
    const updateVolumes = () => {
      const preferences = loadDesktopVoicePreferences(currentMemberId);
      setOutputVolume(preferences.outputVolume);
      setMuted(Boolean(preferences.muted || preferences.deafened));
      const active = media.current;
      active?.stream.getAudioTracks().forEach(track => { track.enabled = !(preferences.muted || preferences.deafened); });
      active?.socket.send({ version: 1, type: "mute-state", muted: Boolean(preferences.muted || preferences.deafened) });
      active?.capture.update?.(preferences);
      active?.audio.forEach((elements, memberId) => elements.forEach(element => applyDesktopOutputPreferences(element, currentMemberId, memberId)));
      const nextInput = inputKey(preferences);
      if (nextInput === previousInput) return;
      previousInput = nextInput;
      const generation = ++inputGeneration;
      if (!active) return;
      inputSwitch = inputSwitch.then(async () => {
        if (media.current !== active || generation !== inputGeneration) return;
        const capture = await captureDesktopMicrophone(currentMemberId);
        if (media.current !== active || generation !== inputGeneration) { capture.stop(); return; }
        const oldTrack = active.stream.getAudioTracks()[0];
        const sender = active.peer.getSenders().find(item => item.track === oldTrack);
        const track = capture.stream.getAudioTracks()[0];
        if (!sender || !track) { capture.stop(); return; }
        const latest = loadDesktopVoicePreferences(currentMemberId);
        track.enabled = !(latest.muted || latest.deafened);
        try { await sender.replaceTrack(track); } catch (error) { capture.stop(); throw error; }
        if (media.current !== active) { capture.stop(); return; }
        active.capture.stop(); active.capture = capture; active.stream = capture.stream;
        onInputStream?.(capture.stream);
      }).catch(() => transientStatus.current?.show("Could not switch microphone. Check Voice Settings."));
    };
    window.addEventListener("allchat:voice-settings", updateVolumes);
    return () => { inputGeneration++; window.removeEventListener("allchat:voice-settings", updateVolumes); };
  }, [currentMemberId]);
  useEffect(() => {
    let disposed = false;
    const measure = () => { const active = media.current; if (!active) { setPing(null); return; }
      if (typeof active.peer.getStats !== "function") return;
      void active.peer.getStats().then(report => { if (!disposed && media.current === active) setPing(connectionPing(report)); }).catch(() => { if (!disposed) setPing(null); });
    };
    const timer = window.setInterval(measure, 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  useEffect(() => {
    const publish = () => {
      for (const ownerID of Object.keys(remoteScreens)) {
        media.current?.socket.send({ version: 1, type: "screen-quality", owner_id: ownerID, quality: document.hidden ? "low" : focusedMediaMemberId === ownerID ? "high" : "medium" });
      }
    };
    publish();
    document.addEventListener("visibilitychange", publish);
    return () => document.removeEventListener("visibilitychange", publish);
  }, [focusedMediaMemberId, remoteScreens]);
  useEffect(() => {
    if (!Object.keys(remoteScreens).length) return;
    const timer = window.setInterval(() => {
      const peer = media.current?.peer;
      if (!peer) return;
      void peer.getStats().then((report) => window.allchatDesktop?.reportDiagnostic?.("screen_share_quality", JSON.stringify(screenShareStats(report)))).catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [remoteScreens]);
  useEffect(() => {
    if (!incoming) return;
    let disposed = false, context: AudioContext | undefined, timer: number | undefined, customAudio: HTMLAudioElement | undefined, customURL = "";
    const ringtoneVolume = loadDesktopVoicePreferences(currentMemberId).ringtoneVolume;
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
          gain.gain.exponentialRampToValueAtTime(Math.max(.0001, .075 * ringtoneVolume), start + .02);
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
      customAudio.volume = ringtoneVolume;
      void customAudio.play().catch(generated);
    }).catch(generated);
    return () => { disposed = true; if (timer !== undefined) window.clearInterval(timer); customAudio?.pause(); if (customURL) URL.revokeObjectURL(customURL); if (context) void context.close().catch(() => undefined); };
  }, [incoming, call?.id]);
  const connected = call?.state === "accepted" || !!voiceRoom;
  const controlSlot = document.getElementById("desktop-call-controls");
  const connectedControls = connected && controlSlot ? createPortal(
    <section className="voice-connection-panel" aria-label={voiceRoom ? "Voice controls" : "Call controls"}>
      <div className="member-connection-heading">
        <ConnectionSignal ping={ping} connected={media.current?.peer.connectionState === "connected"} />
        <button className="voice-connection-identity" type="button" aria-label={voiceRoom ? `Return to Voice Room ${requestedVoiceRoomName}` : `Return to Direct Message with ${directCallName}`} title={voiceRoom ? requestedVoiceRoomName : directCallName} onClick={() => { if (voiceRoom) onOpenVoiceRoom?.(); else if (call) onOpenDirectCall?.(call.direct_message_id); }}>
          <strong>{status === "Call connected" ? "Voice Connected" : status || "Connecting…"}</strong>
          <span>{voiceRoom ? requestedVoiceRoomName : directCallName}</span>
        </button>
        <button className="voice-hangup" type="button" aria-label={voiceRoom ? "Disconnect voice" : "End call"} title={voiceRoom ? "Disconnect voice" : "End call"} onClick={() => { if (voiceRoom) void leaveVoice().catch(error => setStatus(error instanceof Error ? error.message : "Could not leave Voice.")); else void act("end"); }}><PanelIcon name="phone" /></button>
      </div>
      <div className="member-call-actions">
        <button className={videoSource === "camera" ? "active" : ""} type="button" aria-label={videoSource === "camera" ? "Stop camera share" : "Start camera share"} title={videoSource === "camera" ? "Stop camera share" : "Start camera share"} onClick={() => void toggleCameraShare().catch(error => transientStatus.current?.show(error instanceof Error ? error.message : "Camera sharing failed."))}><PanelIcon name="camera" /></button>
        <button className={sharing ? "active" : ""} type="button" aria-label={sharing ? "Stop sharing screen" : "Share screen"} title={sharing ? "Stop sharing screen" : "Share screen"} onClick={() => void toggleScreenShare().catch(error => transientStatus.current?.show(error instanceof Error ? error.message : "Screen sharing failed."))}><PanelIcon name="screen" /></button>
        <button type="button" aria-label="Open Activities" title="Activities" onClick={onOpenActivities}><PanelIcon name="activity" /></button>
        <button type="button" aria-label="Open soundboard" title="Soundboard" onClick={() => void openSoundboard()}><PanelIcon name="soundboard" /></button>
      </div>
    </section>, controlSlot,
  ) : null;
  const incomingControls = incoming && controlSlot ? createPortal(<section className="voice-connection-panel incoming-call-panel" aria-label="Incoming Call controls"><div><strong>Incoming Direct Call</strong><span>{directCallName}</span></div><div className="voice-connection-actions"><button className="call-accept" type="button" onClick={() => void act("accept")}>Accept</button><button className="call-end" type="button" onClick={() => void act("decline")}>Decline</button></div></section>, controlSlot) : null;
  const screenPortals = Object.entries({ ...remoteScreens, ...(localScreen ? { [currentMemberId]: localScreen } : {}) }).map(([memberId, stream]) => {
    const tile = [...document.querySelectorAll<HTMLElement>("[data-media-member-id]")].find((element) => element.dataset.mediaMemberId === memberId);
    const target = tile?.querySelector(".media-stage-visual");
    return target ? createPortal(<MediaStreamVideo stream={stream} muted={memberId === currentMemberId} />, target, `screen-${memberId}`) : null;
  });
  return <>
    {!call && !voiceRoom && conversation?.type === "dm" && <button className="header-button icon-button" type="button" aria-label="Start Call" title="Start Call" onClick={() => void start()}><Icon name="phone" /></button>}
    {call && !incoming && call.state === "ringing" && <button className="call-end direct-call-cancel" type="button" onClick={() => void act("end")}>Cancel Call</button>}
    {!connected && status && <span className="call-status" role="status">{status}</span>}
    {connectedControls}
    {incomingControls}
    {screenPortals}
    {soundboardOpen && <SoundboardMenu anchor={controlSlot?.closest<HTMLElement>(".floating-member-panel")} sounds={sounds} onPlay={playSound} onClose={() => setSoundboardOpen(false)} />}
  </>;
}

export function bindRemoteScreenTrack(
  track: MediaStreamTrack,
  stream: MediaStream,
  owner: string,
  update: (updater: (current: Record<string, MediaStream>) => Record<string, MediaStream>) => void,
  canPublish: () => boolean = () => true,
): void {
  const add = () => {
    if (track.readyState !== "live" || track.muted || !canPublish()) return;
    update((current) => ({ ...current, [owner]: stream }));
  };
  const remove = () => update((current) => {
    if (current[owner] !== stream) return current;
    const next = { ...current };
    delete next[owner];
    return next;
  });
  track.addEventListener("ended", remove);
  track.addEventListener("mute", remove);
  track.addEventListener("unmute", add);
  add();
}

function MediaStreamVideo({ stream, muted }: { stream: MediaStream; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    void element.play().catch(() => undefined);
    return () => {
      element.pause();
      if (element.srcObject === stream) element.srcObject = null;
      element.removeAttribute("src");
      element.load();
    };
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

export function MessageAttachments({ attachments, onAction }: {
  attachments: Attachment[];
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
}) {
  if (!attachments.length) return null;
  const imageCount = attachments.filter(a => a.content_type.toLowerCase().startsWith("image/")).length;
  return <div className={`message-attachments${imageCount > 1 ? " image-gallery" : ""}`}>
    {attachments.map(attachment => <AttachmentView key={attachment.id} attachment={attachment} onAction={onAction} />)}
  </div>;
}

function AttachmentView({
  attachment,
  onAction,
}: {
  attachment: Attachment;
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
}) {
  const [imageMenu, setImageMenu] = useState<{x:number;y:number;target:HTMLElement} | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const [imageError, setImageError] = useState("");
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
      if (!current) return;
      if (result?.type !== "asset") { setImageError("Image unavailable"); return; }
      const nextUrl = URL.createObjectURL(new Blob([result.data as BlobPart], { type: result.contentType }));
      setObjectUrl(nextUrl);
    }).catch(() => { if (current) setImageError("Image unavailable"); });
    return () => { current = false; };
  }, [path]);

  async function openOriginalImage(): Promise<void> {
    setLoadingOriginal(true);
    setImageError("");
    try {
      const originalPath = attachment.url || `/api/v1/attachments/${attachment.id}`;
      const result = await onAction({ type: "load_asset", path: originalPath });
      if (result?.type !== "asset") { setImageError("Couldn’t open image"); return; }
      if (viewerUrl) URL.revokeObjectURL(viewerUrl);
      setViewerUrl(URL.createObjectURL(new Blob([result.data as BlobPart], { type: result.contentType })));
    } catch {
      setImageError("Couldn’t open image");
    } finally {
      setLoadingOriginal(false);
    }
  }

  function openImageMenu(event: React.MouseEvent<HTMLElement>) {
    event.preventDefault(); event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    setImageMenu({ x: event.clientX || bounds.left + 16, y: event.clientY || bounds.top + 16, target: event.currentTarget });
  }
  function imageMenuKey(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    setImageMenu({x:bounds.left+16,y:bounds.top+16,target:event.currentTarget});
  }
  async function originalBlob(): Promise<Blob> {
    const result = await onAction({type:'load_asset',path:attachment.url || `/api/v1/attachments/${attachment.id}`});
    if (result?.type !== 'asset') throw new Error('Image unavailable');
    return new Blob([result.data as BlobPart], {type:result.contentType});
  }
  async function downloadImage() {
    const url = URL.createObjectURL(await originalBlob());
    const link = document.createElement('a');
    link.href = url; link.download = attachment.name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  const type = attachment.content_type.toLowerCase();
  if (type.startsWith("image/")) return <div className="message-image">
    {objectUrl ? <button onContextMenu={openImageMenu} onKeyDown={imageMenuKey} className="attachment-image-button" type="button" aria-label={`View ${attachment.name} at full size`} aria-busy={loadingOriginal} onClick={() => void openOriginalImage()}>
      <img src={objectUrl} alt={attachment.name} onError={() => { setObjectUrl(null); setImageError("Image unavailable"); }} />
    </button> : <span className="image-placeholder" role="status">{imageError || "Loading image…"}</span>}
    {objectUrl && (loadingOriginal || imageError) && <span className="image-status" role="status">{imageError || "Opening image…"}</span>}
    {viewerUrl && <ImageLightbox src={viewerUrl} alt={attachment.name} onContextMenu={openImageMenu} onImageKeyDown={imageMenuKey} onClose={() => { setImageMenu(null); setViewerUrl(null); }} />}
    {imageMenu && <ImageContextMenu name={attachment.name} size={formatBytes(attachment.size)} x={imageMenu.x} y={imageMenu.y}
      onCopy={async () => copyImage(await originalBlob())} onDownload={downloadImage}
      onClose={() => { imageMenu.target.focus(); setImageMenu(null); }} />}
  </div>;
  return (
    <figure className="attachment">
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
      {objectUrl && (
        <a href={objectUrl} download={attachment.name}>
          Download
        </a>
      )}
    </figure>
  );
}

export function desktopAttachmentDisplayPath(attachment: Attachment): string {
  const original = attachment.url || `/api/v1/attachments/${attachment.id}`;
  return attachment.content_type.toLowerCase() === "image/gif" ? original : attachment.preview_url || original;
}

function ImageLightbox({ src, alt, onClose, onContextMenu, onImageKeyDown }: { src: string; alt: string; onClose(): void; onContextMenu: React.MouseEventHandler<HTMLElement>; onImageKeyDown: React.KeyboardEventHandler<HTMLElement> }) {
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
      <img src={src} alt={alt} tabIndex={0} onContextMenu={onContextMenu} onKeyDown={onImageKeyDown} draggable={false} style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); setDragging(true); event.currentTarget.closest<HTMLElement>(".image-lightbox")?.setPointerCapture(event.pointerId); }} />
      <output aria-live="polite">{Math.round(scale * 100)}%</output>
      <button className="image-lightbox-close" type="button" aria-label="Close image viewer" onClick={onClose}><Icon name="x" /></button>
    </section>,
    document.body,
  );
}

type IconName =
  | "copy"
  | "log-out"
  | "mic-off"
  | "waveform"
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
	| "rocket"
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
    copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H3V3h12v2" /></>,
    "log-out": <path d="m10 17 5-5-5-5M15 12H3M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" />,
    "mic-off": <path d="m2 2 20 20M9 9v3a3 3 0 0 0 5 2M9 5V4a3 3 0 0 1 6 0v7M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3M8 22h8" />,
    waveform: <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />,
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
	rocket: (
		<>
			<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2" />
			<path d="M9 15 4 14l7.5-7.5C14.5 3.5 18 3 21.5 3c0 3.5-.5 7-3.5 10L10.5 20 9 15Z" />
			<path d="M14 6.5a3 3 0 1 0 3.5 3.5" />
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
  onBack,
}: {
  state: InstanceViewState;
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
  onSectionChange(section: string): void;
  onBack(): void;
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
        <button className="settings-back" type="button" onClick={onBack}>‹  Back to Community</button>
        <div className="member-settings-heading">Settings</div>
        <p className="settings-nav-label">Community</p>
        {(["dashboard", "general", "channels", "roles", "invitations", "soundboard"] as const).map((item) => <button type="button" key={item} aria-current={section === item ? "page" : undefined} onClick={() => select(item)}>{item === "general" ? "General" : item[0].toUpperCase() + item.slice(1)}</button>)}
      </nav>
      {section === "general" && <>
        {!communitySettings && <><SettingsHeading community title="General" description={`Make ${state.community.name} feel like your own.`} />{!error && <p role="status">Loading Community settings…</p>}</>}
        {error && <p role="alert" className="notice-error">{error}</p>}
        {communitySettings && <CommunityGeneralSettings settings={communitySettings} onChange={setCommunitySettings} onAction={onAction} onError={setError} />}
      </>}
      {section === "dashboard" && <AdminDashboardView dashboard={dashboard} history={dashboardHistory} error={error} />}
      {section === "channels" && <ChannelManagement categories={adminCategories} channels={adminChannels} roles={roles || []} onCategories={setAdminCategories} onChannels={setAdminChannels} onAction={onAction} loadError={error} />}
      {section === "roles" && <RoleManagement roles={roles} onRoles={setRoles} onAction={onAction} loadError={error} />}
      {section === "invitations" && <InvitationManagement invitations={invitations} onInvitations={setInvitations} onAction={onAction} loadError={error} />}
      {section === "soundboard" && <SoundboardManagement sounds={sounds} limit={soundLimit} onSounds={setSounds} onLimit={setSoundLimit} onAction={onAction} loadError={error} />}
    </section>
  );
}

function CommunityGeneralSettings({ settings, onChange, onAction, onError }: {
  settings: import("../shared/instance-actions").CommunitySettings;
  onChange(settings: import("../shared/instance-actions").CommunitySettings): void;
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
  onError(error: string): void;
}) {
  const [infrastructure, setInfrastructure] = useState(false);
  const [notice, setNotice] = useState("");
  return <section className="community-general-settings">
    <SettingsHeading community title={infrastructure ? "Infrastructure" : "General"} description={infrastructure ? "Configure attachment limits and mobile push for your Community." : `Make ${settings.name} feel like your own.`} />
    <form className="community-general-form" onInvalidCapture={(event) => {
      const field = event.target as HTMLInputElement;
      if (!field.closest("[hidden]")) return;
      event.preventDefault();
      setInfrastructure(Boolean(field.closest(".infrastructure-settings")));
      requestAnimationFrame(() => { field.focus(); field.reportValidity(); });
    }} onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      onError(""); setNotice("");
      void onAction({ type: "update_community_settings", name: String(data.get("name") || ""), maxAttachmentMiB: Number(data.get("maxAttachmentMiB")), homeMarkdown: String(data.get("homeMarkdown") || ""), pushRelayURL: String(data.get("pushRelayURL") || "") }).then((result) => {
        if (result?.type === "community_settings") { onChange(result.settings); setNotice("Community settings saved."); }
      }).catch(() => onError("Could not save Community settings."));
    }}>
      <div className="community-general-grid" hidden={infrastructure}>
        <section className="settings-card community-profile-card">
          <h3>Community profile</h3>
          <CommunityAvatarSetting settings={settings} onAction={onAction} onChange={onChange} />
          <label>Community name<input name="name" maxLength={100} defaultValue={settings.name} required /></label>
          <label>Community Guide<textarea name="homeMarkdown" rows={3} defaultValue={settings.home_markdown} /></label>
          <button className="settings-primary" type="submit">Save settings</button>
        </section>
        <RingtoneSetting scope="community" active={settings.community_ringtone_set === true} fallbackLabel="Generated tone" onAction={onAction} onActiveChange={(active) => onChange({ ...settings, community_ringtone_set: active })} />
        <section className="settings-card infrastructure-link"><h3>Infrastructure</h3><p>Attachments and mobile notifications.</p><p>Maximum attachment size: {settings.max_attachment_mib} MiB</p><button type="button" onClick={() => setInfrastructure(true)}>Manage infrastructure</button></section>
      </div>
      <div className="infrastructure-settings" hidden={!infrastructure}>
        <section className="settings-card"><h3>Attachments</h3><div className="attachment-limit-row"><label>Maximum attachment size (MiB)<input name="maxAttachmentMiB" type="number" min="1" max="256" defaultValue={settings.max_attachment_mib} required /></label><p>Applies immediately. Your reverse proxy must allow at least the same request size.</p></div></section>
        <section className="settings-card"><h3>Mobile push relay</h3><label>Relay URL<input aria-label="Mobile push relay" name="pushRelayURL" type="url" defaultValue={settings.push_relay_url} placeholder="https://push.example.com" /></label><p>Used for Android and iOS background notifications. Leave empty to disable.</p><details><summary>Relay authorization identity</summary><p>Key ID: <code>{settings.push_key_id}</code></p><textarea readOnly rows={3} value={settings.push_public_key} aria-label="Relay public key" /></details></section>
        <div className="settings-actions"><button className="settings-primary" type="submit">Save settings</button><button type="button" onClick={() => setInfrastructure(false)}>Back to General</button></div>
      </div>
    </form>
    <p role="status">{notice}</p>
  </section>;
}

function CommunityAvatarSetting({ settings, onAction, onChange }: { settings: import("../shared/instance-actions").CommunitySettings; onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>; onChange(settings: import("../shared/instance-actions").CommunitySettings): void }) {
  return <div className="community-avatar-setting">
	{settings.avatar_url ? <AuthenticatedImage path={settings.avatar_url} alt="Community avatar" className="community-settings-avatar" fallback={settings.name.slice(0, 1).toUpperCase()} onAction={onAction} /> : <span className="community-settings-avatar">{settings.name.slice(0, 1).toUpperCase()}</span>}
	<label className="settings-upload">Change avatar<input aria-label="Choose Community avatar" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.arrayBuffer().then((bytes) => onAction({ type: "update_community_avatar", contentType: file.type, data: new Uint8Array(bytes) })).then(() => onChange({ ...settings, avatar_url: `/api/v1/community-avatar?v=${Date.now()}` })); }} /></label>
	{settings.avatar_url && <button type="button" onClick={() => void onAction({ type: "remove_community_avatar" }).then(() => onChange({ ...settings, avatar_url: undefined }))}>Remove avatar</button>}
  </div>;
}

function ringtoneFileType(file: File): string { return file.type || (/\.ogg$/i.test(file.name) ? "audio/ogg" : /\.wav$/i.test(file.name) ? "audio/wav" : "audio/mpeg"); }

function RingtoneSetting({ scope, active, fallbackLabel, onAction, onActiveChange }: { scope: "community" | "member"; active: boolean; fallbackLabel: string; onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>; onActiveChange(active: boolean): void }) {
  const [notice, setNotice] = useState("");
  const label = scope === "community" ? "Community ringtone" : "Incoming call ringtone";
  return <section className="settings-card ringtone-setting"><h3>{label}</h3><p>A familiar sound when someone calls.</p><div className="ringtone-tone"><span aria-hidden="true">♪</span><div><strong>{active ? "Custom ringtone" : fallbackLabel.includes("Community") ? "Community ringtone" : "Generated tone"}</strong><p>{active ? "Custom audio is active." : fallbackLabel}</p></div></div><label className="settings-upload">Choose audio file<input type="file" accept="audio/mpeg,audio/wav,audio/ogg" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.arrayBuffer().then((bytes) => onAction({ type: "update_ringtone", scope, contentType: ringtoneFileType(file), data: new Uint8Array(bytes) })).then(() => { onActiveChange(true); setNotice("Ringtone saved."); }).catch(() => setNotice("Could not save ringtone.")); }} /></label>{active && <button type="button" onClick={() => void onAction({ type: "remove_ringtone", scope }).then(() => { onActiveChange(false); setNotice(scope === "member" ? "Using the Community ringtone." : "Using the generated tone."); })}>{scope === "member" ? "Use Community default" : "Remove custom ringtone"}</button>}<p role="status">{notice}</p></section>;
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
      <SettingsHeading title="Notifications" description={`Choose what gets your attention in ${state.community.name}.`} />
      <section className="settings-card">
        <h3>Desktop notifications</h3>
        <p className="notification-permission-state"><span className="presence-dot online" /> Native notifications enabled</p>
      </section>
      <section className="settings-card">
        <h3>Community defaults</h3>
        <div className="notification-defaults-grid">
        <label>Notification level<select aria-label="Community notification level" value={community.level} onChange={(event) => void saveCommunity({ ...community, level: event.target.value as CommunityLevel })}><option value="all_messages">All Messages</option><option value="mentions_only">Only @mentions</option><option value="nothing">Nothing</option></select></label>
        <label className="notification-check"><input type="checkbox" checked={community.muted} onChange={(event) => void saveCommunity({ ...community, muted: event.target.checked })} /><span>Mute Community<small>Pause notifications from this Community.</small></span></label>
        <label className="notification-check"><input type="checkbox" checked={community.soundEnabled} onChange={(event) => void saveCommunity({ ...community, soundEnabled: event.target.checked })} /><span>Notification sound<small>Play a sound with desktop notifications.</small></span></label>
        </div>
      </section>
      <section className="settings-card channel-overrides">
        <h3>Channel overrides</h3>
        <p>Fine-tune individual channels.</p>
        {!state.channels.some(({ type, archived }) => type === "text" && !archived) && <p>No Text Channels to customize yet.</p>}
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

function RingtoneSettings({ state, onAction }: { state: InstanceViewState; onAction(action: InstanceAction): Promise<InstanceActionResult | undefined> }) {
  const [memberRingtone, setMemberRingtone] = useState(state.notifications.member_ringtone_set === true);
  const [volume, setVolume] = useState(() => loadDesktopVoicePreferences(state.member.id).ringtoneVolume);
  const saveVolume = (value: number) => {
    const preferences = loadDesktopVoicePreferences(state.member.id);
    const saved = saveDesktopVoicePreferences(state.member.id, { ...preferences, ringtoneVolume: value });
    setVolume(saved.ringtoneVolume);
  };
  return <section className="settings-panel ringtone-settings-page" data-ringtone-settings>
    <SettingsHeading title="Ringtone" description="Set the sound for incoming Direct Calls on this device." />
    <RingtoneSetting scope="member" active={memberRingtone} fallbackLabel={state.notifications.community_ringtone_set ? "Using the Community ringtone." : "Using the generated tone."} onAction={onAction} onActiveChange={setMemberRingtone} />
    <section className="settings-card">
      <h3>Ringtone volume</h3><p>Adjust how loudly incoming calls ring.</p>
      <label className="setting-slider"><span>Volume</span><output>{Math.round(volume * 100)}%</output><input aria-label="Ringtone volume" type="range" min="0" max="1" step="0.05" value={volume} style={{ "--range-progress": `${volume * 100}%` } as CSSProperties} onChange={(event) => saveVolume(Number(event.target.value))} /></label>
    </section>
  </section>;
}

function VoiceVideoSettings({ memberId }: { memberId: string }) {
  const [preferences, setPreferences] = useState<DesktopVoicePreferences>(() => loadDesktopVoicePreferences(memberId));
  const [tab, setTab] = useState<"audio" | "camera">("audio");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [notice, setNotice] = useState("");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const cameraPreview = useRef<HTMLVideoElement>(null);
  const cameraRequest = useRef(0);

  useEffect(() => () => { cameraRequest.current += 1; }, []);
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
    const request = ++cameraRequest.current;
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
      if (request !== cameraRequest.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setCameraStream(stream);
      setNotice("Camera preview started.");
    } catch {
      if (request === cameraRequest.current) setNotice("Camera permission was denied or the selected device is unavailable.");
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
      <div className="voice-settings-intro">
        <SettingsHeading title={tab === "audio" ? "Voice & Video" : "Camera & sharing"} description={tab === "audio" ? "Feel ready before you join a Voice Room or Direct Call." : "Preview your video and tune screen sharing for your conversation."} />
      </div>
      <nav className="settings-tabs" aria-label="Voice & Video sections">
        <button type="button" aria-current={tab === "audio" ? "page" : undefined} onClick={() => { cameraRequest.current += 1; setTab("audio"); setCameraStream(null); }}>Audio</button>
        <button type="button" aria-current={tab === "camera" ? "page" : undefined} onClick={() => setTab("camera")}>Camera &amp; sharing</button>
      </nav>
      <div className="voice-audio-grid" hidden={tab !== "audio"}>
      <section className="voice-settings-section audio-devices">
        <h3>Audio devices</h3><p>Choose your input and output.</p>
          <label>Microphone<select aria-label="Microphone" value={preferences.microphoneID} onChange={(event) => patch({ microphoneID: event.target.value })}><option value="">System default</option>{microphones.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label>
        <label className="setting-row"><span><strong>Microphone volume</strong><small>Adjust the level sent to other Members.</small></span><output>{Math.round(preferences.inputGain * 100)}%</output><input aria-label="Microphone volume" type="range" min="0" max="2" step="0.05" value={preferences.inputGain} style={{ "--range-progress": `${preferences.inputGain * 50}%` } as CSSProperties} onChange={(event) => patch({ inputGain: Number(event.target.value) })} /></label>
          <label>Speaker<select aria-label="Speaker" value={preferences.speakerID} onChange={(event) => patch({ speakerID: event.target.value })}><option value="">System default</option>{speakers.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Speaker ${index + 1}`}</option>)}</select></label>
        <label className="setting-row"><span><strong>Speaker volume</strong><small>Adjust all incoming voice audio.</small></span><output>{Math.round(preferences.outputVolume * 100)}%</output><input aria-label="Speaker volume" type="range" min="0" max="1" step="0.05" value={preferences.outputVolume} style={{ "--range-progress": `${preferences.outputVolume * 100}%` } as CSSProperties} onChange={(event) => patch({ outputVolume: Number(event.target.value) })} /></label>
      </section>
      <section className="voice-settings-section">
        <h3>Input processing</h3><p>Your microphone audio is processed on this device.</p>
        <label className="setting-row"><span><strong>Noise suppression</strong><small>Reduce background noise before it reaches others.</small></span><select aria-label="Noise suppression" value={preferences.noiseSuppressionMode} onChange={(event) => patch({ noiseSuppressionMode: event.target.value as DesktopVoicePreferences["noiseSuppressionMode"] })}><option value="standard">Standard</option><option value="enhanced">Enhanced (RNNoise)</option><option value="off">Off</option></select></label>
        <label className="setting-row setting-toggle"><span><strong>Echo cancellation</strong><small>Keep speaker audio out of your microphone.</small></span><input type="checkbox" checked={preferences.echoCancellation} onChange={(event) => patch({ echoCancellation: event.target.checked })} /></label>
        <label className="setting-row setting-toggle"><span><strong>Automatic gain control</strong><small>Balance quiet and loud microphones.</small></span><input type="checkbox" checked={preferences.autoGainControl} onChange={(event) => patch({ autoGainControl: event.target.checked })} /></label>
        <label className="setting-row setting-toggle"><span><strong>Noise gate</strong><small>Mute input below your sensitivity threshold.</small></span><input type="checkbox" checked={preferences.noiseGate} onChange={(event) => patch({ noiseGate: event.target.checked })} /></label>

      </section>
      </div>
      <div className="voice-audio-footer" hidden={tab !== "audio"}>
        <div className="settings-actions"><button type="button" onClick={() => void testMicrophone()}>Test microphone</button><button type="button" onClick={playSpeakerTest}>Play test sound</button></div>
        <label className="setting-row"><span><strong>Input sensitivity</strong></span><output>{preferences.noiseGateThresholdDB} dB</output><input aria-label="Input sensitivity" type="range" min="-80" max="-20" step="1" value={preferences.noiseGateThresholdDB} style={{ "--range-progress": `${(preferences.noiseGateThresholdDB + 80) / 60 * 100}%` } as CSSProperties} onChange={(event) => patch({ noiseGateThresholdDB: Number(event.target.value) })} /></label>
      </div>
      <div className="voice-camera-grid" hidden={tab !== "camera"}>
      <section className="voice-settings-section camera-settings">
        <h3>Camera</h3>
        <div className="camera-test"><video ref={cameraPreview} autoPlay muted playsInline hidden={!cameraStream} /><div className="camera-placeholder" hidden={Boolean(cameraStream)}>Camera preview is off</div></div>
        <label>Camera<select aria-label="Camera" value={preferences.cameraID} onChange={(event) => patch({ cameraID: event.target.value })}><option value="">System default</option>{cameras.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>
        <button type="button" onClick={() => void toggleCamera()}>{cameraStream ? "Stop Video" : "Test Video"}</button>
      </section>
      <section className="voice-settings-section sharing-settings">
        <h3>Screen sharing</h3><p>Match the quality to what you share.</p>
        <label className="setting-row"><span><strong>Quality mode</strong><small>Auto protects frame delivery; Text preserves readability; Motion prioritizes smoothness.</small></span><select aria-label="Screen share quality" value={preferences.screenShareMode} onChange={(event) => patch({ screenShareMode: event.target.value as DesktopVoicePreferences["screenShareMode"] })}><option value="auto">Auto</option><option value="text">Text</option><option value="balanced">Balanced</option><option value="motion">Motion</option><option value="data-saver">Data saver</option></select></label>
      </section>
      <section className="voice-settings-section reset-settings">
        <h3>Restore defaults</h3><p>Reset all Voice &amp; Video preferences.</p>
        <div className="settings-actions"><button type="button" onClick={() => { save({ ...defaultDesktopVoicePreferences, ringtoneVolume: preferences.ringtoneVolume }); setNotice("Voice & Video settings were reset."); }}>Reset settings</button></div>
      </section>
      </div>
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
      <div className="profile-preview-banner"><AuthenticatedImage path={member.bannerUrl} alt="Profile banner" className="profile-banner" onAction={onAction} /></div>
      <AuthenticatedImage path={member.avatarUrl} alt="Profile avatar" className="profile-avatar" fallback={(member.displayName || member.username).slice(0, 1).toUpperCase()} onAction={onAction} />
      <div className="profile-preview-identity"><strong>{member.displayName || member.username}</strong><span>@{member.username}</span></div>
      <div className="profile-image-actions">
        <label className="settings-upload">Change avatar<input aria-label="Change avatar" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { choose("avatar", event.target.files?.[0]); event.target.value = ""; }} /></label>
        <label className="settings-upload">Change banner<input aria-label="Change banner" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { choose("banner", event.target.files?.[0]); event.target.value = ""; }} /></label>
        <button className="settings-text-button" type="button" onClick={() => void onAction({ type: "remove_profile_image", kind: "avatar" })}>Remove avatar</button>
        <button className="settings-text-button" type="button" onClick={() => void onAction({ type: "remove_profile_image", kind: "banner" })}>Remove banner</button>
      </div>
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
  const [view, setView] = useState<"overview" | "moderation" | "delete">("overview");
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
      <SettingsHeading title={view === "moderation" ? "Moderation" : view === "delete" ? "Delete Account" : "Safety"} description={view === "moderation" ? "Review Community reports and manage moderation actions." : view === "delete" ? "Confirm that you want to permanently delete your account." : "Manage reports and take control of your account data."} />
      {view !== "overview" && <button className="settings-text-button" type="button" onClick={() => setView("overview")}>‹ Back to Safety</button>}
      <div className="safety-overview-grid" hidden={view !== "overview"}>
      <form className="settings-card report-form"
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
        <h3>Report a Member</h3><p>Tell us about behavior that needs attention.</p>
        <label>
          Member
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
        <button className="settings-primary" type="submit">Submit Report</button>
      </form>
      <section className="settings-card account-data-card"><h3>Your account data</h3><p>Download a copy of your account data.</p><button type="button" onClick={() => void exportAccount()}>Export Account Data</button></section>
      <section className="settings-card delete-account-card"><h3>Delete Account</h3><p>Permanently remove your account.</p><p className="settings-danger-copy">This action cannot be undone.</p><button type="button" className="danger-button" onClick={() => setView("delete")}>Delete Account</button></section>
      {records && <section className="settings-card moderation-link"><div><h3>Moderation</h3><p>Reports, actions, and records.</p></div><button type="button" onClick={() => setView("moderation")}>Open moderation</button></section>}
      </div>
      <div className="moderation-grid" hidden={records ? view !== "moderation" : view !== "overview"}>
      <div className="report-list settings-card"><h3>{records ? "Reports" : "Your reports"}</h3>
        {reports.length === 0 && <p>No reports to review.</p>}
        {reports.map((report) => (
          <article key={report.id} data-status={report.status}>
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
          <form className="settings-card moderation-action-form"
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
            <h3>Moderation Action</h3>
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
            <button className="settings-primary" type="submit">Apply Action</button>
          </form>
          <section className="settings-card moderation-records"><details>
            <summary>Moderation Records</summary>
            {records.length === 0 && <p>No moderation records yet.</p>}
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
          </button></section>
        </>
      )}
      </div>
      <form
        hidden={view !== "delete"}
        className="danger-zone settings-card"
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
        <h3>Delete your account</h3><p className="settings-danger-copy">This action cannot be undone.</p><p>Enter your password and type DELETE to confirm.</p>
        <label>
          Password
          <input name="password" type="password" required />
        </label>
        <label>
          Type DELETE
          <input name="confirmation" pattern="DELETE" required />
        </label>
        <div className="settings-actions"><button type="button" onClick={() => setView("overview")}>Cancel</button><button className="danger-button" type="submit">Delete Account</button></div>
      </form>
    </section>
  );
}
