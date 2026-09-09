import { useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { CommunityInvitation, CommunityRole, InstanceAction, InstanceActionResult, SoundboardSound } from "../shared/instance-actions";
import type { InstanceViewState } from "../shared/instance-state";
import { SettingsHeading } from "./settings-heading";

type Action = (action: InstanceAction) => Promise<InstanceActionResult | undefined>;
type Setter<T> = Dispatch<SetStateAction<T>>;
type Channel = InstanceViewState["channels"][number];
type Category = InstanceViewState["categories"][number];

function useManagementAction(onAction: Action) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busy = useRef(false);
  async function request(action: InstanceAction) {
    const result = await onAction(action);
    if (!result) throw new Error("The change could not be saved. Try again.");
    return result;
  }
  async function run(task: () => Promise<void>, message: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(true); setError(""); setNotice("");
    try { await task(); setNotice(message); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The change could not be saved. Try again."); }
    finally { busy.current = false; setPending(false); }
  }
  return { pending, error, notice, request, run };
}

function ManagementPage({ title, description, error, notice, children }: { title: string; description: string; error: string; notice: string; children: ReactNode }) {
  return <section className="community-management administration-list">
    <SettingsHeading community title={title} description={description} />
    {error && <p className="notice-error" role="alert">{error}</p>}
    {children}
    <p className="management-notice" role="status">{notice}</p>
  </section>;
}

export function ChannelManagement({ categories, channels, roles, onCategories, onChannels, onAction, loadError }: {
  categories: Category[]; channels: Channel[]; roles: CommunityRole[]; onCategories: Setter<Category[]>; onChannels: Setter<Channel[]>; onAction: Action; loadError: string;
}) {
  const action = useManagementAction(onAction);
  const activeCategories = categories.filter(category => !category.archived);
  return <ManagementPage title="Channels" description="Organize the places where your Community talks." error={action.error || loadError} notice={action.notice}>
    <div className="management-grid">
      <section className="settings-card management-directory"><h3>Community channels</h3><p>Group Text Channels and Voice Rooms by Category.</p>
        {categories.length === 0 && <p className="management-empty">Create a Category to start organizing your Channels.</p>}
        {categories.map(category => <section className="management-category" key={category.id}>
          <h4>{category.name}{category.archived && <span className="management-badge">Archived</span>}</h4>
          {!channels.some(channel => channel.category_id === category.id) && <p className="management-empty">No Channels in this Category yet.</p>}
          {channels.filter(channel => channel.category_id === category.id).map(channel => <ManagedChannel key={channel.id} channel={channel} roles={roles} onAction={onAction} onUpdate={updated => onChannels(current => updated ? current.map(item => item.id === channel.id ? updated : item) : current.filter(item => item.id !== channel.id))} />)}
        </section>)}
      </section>
      <form className="settings-card management-editor" aria-label="Create Channel" onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
        void action.run(async () => {
          const result = await action.request({ type: "create_channel", categoryId: String(data.get("category")), name: String(data.get("name") || ""), channelType: String(data.get("type")) as "text" | "voice", position: channels.length });
          if (result.type !== "channel") throw new Error("Could not create the Channel.");
          onChannels(current => [...current, result.channel]); form.reset();
        }, "Channel created.");
      }}>
        <h3>Create Channel</h3><p>Give your Community a place to connect.</p>
        <label>Category<select name="category" required disabled={!activeCategories.length}>{activeCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Channel name<input name="name" placeholder="e.g. introductions" required /></label>
        <label>Type<select name="type"><option value="text">Text Channel</option><option value="voice">Voice Room</option></select></label>
        <button className="settings-primary" type="submit" disabled={action.pending || !activeCategories.length}>Create Channel</button>
        {!activeCategories.length && <p>Create a Category first.</p>}
      </form>
      <form className="settings-card management-secondary-form" aria-label="Create Category" onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
        void action.run(async () => {
          const result = await action.request({ type: "create_category", name: String(data.get("name") || ""), position: categories.length });
          if (result.type !== "category") throw new Error("Could not create the Category.");
          onCategories(current => [...current, result.category]); form.reset();
        }, "Category created.");
      }}><h3>Create Category</h3><label>Category name<input name="name" placeholder="e.g. Projects" required /></label><button className="settings-primary" type="submit" disabled={action.pending}>Create Category</button></form>
    </div>
  </ManagementPage>;
}

function ManagedChannel({ channel, roles, onAction, onUpdate }: { channel: Channel; roles: CommunityRole[]; onAction: Action; onUpdate(channel: Channel | null): void }) {
  const [editing, setEditing] = useState(false);
  const action = useManagementAction(onAction);
  return <article className="management-channel" aria-label={`${channel.name} settings`}>
    <div className="management-item-row"><span className="management-symbol" aria-hidden="true">{channel.type === "voice" ? "◖" : "#"}</span><div className="management-item-identity"><strong>{channel.name}</strong><small>{channel.type === "voice" ? "Voice Room" : "Text Channel"}{channel.archived ? " · Archived" : ""}</small></div>
      <div className="management-item-actions"><button type="button" onClick={() => setEditing(!editing)}>Edit</button><button type="button" disabled={action.pending} onClick={() => void action.run(async () => { await action.request({ type: "set_channel_archived", channelId: channel.id, archived: !channel.archived }); onUpdate({ ...channel, archived: !channel.archived }); }, channel.archived ? "Channel restored." : "Channel archived.")}>{channel.archived ? "Restore" : "Archive"}</button></div>
    </div>
    {editing && <form className="management-inline-editor" aria-label="Edit Channel" onSubmit={event => {
      event.preventDefault(); const name = String(new FormData(event.currentTarget).get("name") || "");
      void action.run(async () => { const result = await action.request({ type: "update_channel", channelId: channel.id, categoryId: channel.category_id, name, channelType: channel.type, position: channel.position }); if (result.type !== "channel") throw new Error("Could not update the Channel."); onUpdate(result.channel); setEditing(false); }, "Channel updated.");
    }}><label>Channel name<input name="name" defaultValue={channel.name} required autoFocus /></label><div className="settings-actions"><button className="settings-primary" type="submit" disabled={action.pending}>Save Channel</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div></form>}
    <div className="management-channel-options"><details className="channel-permissions"><summary>Permission override</summary>
      <form aria-label={`${channel.name} permission override`} onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void action.run(async () => { await action.request({ type: "set_channel_override", channelId: channel.id, roleId: String(data.get("roleId")), permission: String(data.get("permission")), effect: String(data.get("effect")) as "allow" | "deny" | "inherit" }); }, "Permission override saved.");
      }}><label>Role<select name="roleId" required>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label>Permission<select name="permission"><option value="view_channel">View Channel</option><option value="send_messages">Send Messages</option><option value="connect_voice">Connect Voice</option></select></label><label>Effect<select name="effect"><option value="inherit">Inherit</option><option value="allow">Allow</option><option value="deny">Deny</option></select></label><button className="settings-primary" type="submit" disabled={action.pending || !roles.length}>Save override</button></form>
    </details><button className="management-delete-link" type="button" disabled={action.pending} onClick={() => { if (window.confirm(`Permanently delete ${channel.name}?`)) void action.run(async () => { await action.request({ type: "delete_channel", channelId: channel.id }); onUpdate(null); }, "Channel deleted."); }}>Delete</button></div>
    {action.error && <p role="alert" className="notice-error">{action.error}</p>}<p className="management-notice" role="status">{action.notice}</p>
  </article>;
}

const rolePermissions = ["manage_channels", "manage_roles", "manage_invitations", "manage_soundboard", "moderate_members"];
function permissionLabel(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()); }

export function RoleManagement({ roles, onRoles, onAction, loadError }: { roles: CommunityRole[] | null; onRoles: Setter<CommunityRole[] | null>; onAction: Action; loadError: string }) {
  const [editing, setEditing] = useState<CommunityRole | null>(null);
  const editor = useRef<HTMLFormElement>(null);
  const action = useManagementAction(onAction);
  return <ManagementPage title="Roles" description="Choose who can do what in your Community." error={action.error || loadError} notice={action.notice}>
    <div className="management-grid">
      <section className="settings-card management-directory"><h3>Community Roles</h3><p>Built-in Roles stay protected. Custom Roles are yours to manage.</p>
        {!roles && !loadError && <p role="status">Loading Roles…</p>}{roles?.length === 0 && <p className="management-empty">No Roles to display.</p>}
        {roles?.map(role => <article className="management-item-row" key={role.id} aria-label={`${role.name} Role`}>
          {!role.owner && !role.default && <span className="management-symbol" aria-hidden="true">•</span>}
          <div className="management-item-identity"><strong>{role.name}</strong><small>{role.owner ? "Full Community access" : role.default ? "Base Role for all Members" : `Position ${role.position} · ${role.permissions.map(permissionLabel).join(", ") || "No permissions"}`}</small></div>
          {role.owner || role.default ? <span className="management-badge">{role.owner ? "Protected" : "Default"}</span> : <div className="management-item-actions"><button type="button" onClick={() => { setEditing(role); requestAnimationFrame(() => { editor.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); editor.current?.querySelector("input")?.focus({ preventScroll: true }); }); }}>Edit</button><button className="danger-button" type="button" disabled={action.pending} onClick={() => { if (window.confirm(`Retire ${role.name}?`)) void action.run(async () => { await action.request({ type: "retire_role", roleId: role.id }); onRoles(current => current?.filter(item => item.id !== role.id) || null); if (editing?.id === role.id) setEditing(null); }, "Role retired."); }}>Retire</button></div>}
        </article>)}
      </section>
      <form key={editing?.id || "create"} ref={editor} className="settings-card management-editor" aria-label={editing ? "Edit Role" : "Create Role"} onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
        const values = { name: String(data.get("name") || ""), permissions: [...data.getAll("permissions").map(String), ...(editing?.permissions.filter(permission => !rolePermissions.includes(permission)) || [])], position: editing?.position ?? roles?.length ?? 0 };
        void action.run(async () => { const result = await action.request(editing ? { type: "update_role", roleId: editing.id, ...values } : { type: "create_role", ...values }); if (result.type !== "role") throw new Error("Could not save the Role."); onRoles(current => editing ? current?.map(item => item.id === editing.id ? result.role : item) || null : [...(current || []), result.role]); setEditing(null); form.reset(); }, editing ? "Role updated." : "Role created.");
      }}><h3>{editing ? "Edit Role" : "Create Role"}</h3><p>{editing ? "Update this Role’s name and permissions." : "Start with only the permissions this Role needs."}</p><label>Role name<input name="name" placeholder="e.g. Event host" defaultValue={editing?.name || ""} required /></label>
        <fieldset className="management-permissions"><legend>Permissions</legend>{rolePermissions.map(permission => <label key={permission}><input type="checkbox" name="permissions" value={permission} defaultChecked={editing?.permissions.includes(permission)} />{permissionLabel(permission)}</label>)}</fieldset>
        <div className="settings-actions"><button className="settings-primary" type="submit" disabled={action.pending || !roles}>{editing ? "Save Role" : "Create Role"}</button>{editing && <button type="button" onClick={() => setEditing(null)}>Cancel</button>}</div>
      </form>
    </div>
  </ManagementPage>;
}

export function InvitationManagement({ invitations, onInvitations, onAction, loadError }: { invitations: CommunityInvitation[] | null; onInvitations: Setter<CommunityInvitation[] | null>; onAction: Action; loadError: string }) {
  const action = useManagementAction(onAction);
  return <ManagementPage title="Invitations" description="Welcome new Members with controlled access to your Community." error={action.error || loadError} notice={action.notice}>
    <div className="management-grid">
      <section className="settings-card management-directory"><h3>Community Invitations</h3><p>Share an invitation code with someone you want to bring in.</p>
        {!invitations && !loadError && <p role="status">Loading Invitations…</p>}{invitations?.length === 0 && <p className="management-empty">No active Invitations. Create one to welcome a new Member.</p>}
        {invitations?.map(invitation => <article className="management-invitation" key={invitation.id}>
          <span className="management-caption">Invitation code</span><code className="invitation-code">{invitation.token || invitation.id}</code>
          <div className="management-item-row"><div className="management-item-identity"><strong>{invitation.use_count} of {invitation.max_uses} uses</strong><small>Expires {new Date(invitation.expires_at).toLocaleString()}</small>{invitation.revoked && <small>Revoked</small>}</div><button className="danger-button" type="button" disabled={action.pending || invitation.revoked} onClick={() => { if (window.confirm("Revoke this Invitation?")) void action.run(async () => { await action.request({ type: "revoke_invitation", invitationId: invitation.id }); onInvitations(current => current?.filter(item => item.id !== invitation.id) || null); }, "Invitation revoked."); }}>Revoke</button></div>
        </article>)}
      </section>
      <form className="settings-card management-editor" aria-label="Create Invitation" onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void action.run(async () => { const result = await action.request({ type: "create_invitation", expiresInMinutes: Number(data.get("expires")), maxUses: Number(data.get("uses")) }); if (result.type !== "invitation") throw new Error("Could not create the Invitation."); onInvitations(current => [result.invitation, ...(current || [])]); }, "Invitation created.");
      }}><h3>Create Invitation</h3><p>Set a lifetime and limit how often it can be used.</p><label>Expires in minutes<input name="expires" type="number" min="1" defaultValue="1440" required /></label><p>1440 minutes = 1 day</p><label>Maximum uses<input name="uses" type="number" min="1" defaultValue="1" required /></label><button className="settings-primary" type="submit" disabled={action.pending}>Create Invitation</button></form>
    </div>
  </ManagementPage>;
}

export function SoundboardManagement({ sounds, limit, onSounds, onLimit, onAction, loadError }: { sounds: SoundboardSound[] | null; limit: number; onSounds: Setter<SoundboardSound[] | null>; onLimit(limit: number): void; onAction: Action; loadError: string }) {
  const [editing, setEditing] = useState<SoundboardSound | null>(null);
  const [filename, setFilename] = useState("");
  const editor = useRef<HTMLFormElement>(null);
  const action = useManagementAction(onAction);
  return <ManagementPage title="Soundboard" description="Give your Voice Rooms a little personality." error={action.error || loadError} notice={action.notice}>
    <div className="management-grid">
      <section className="settings-card management-directory"><h3>Community sounds</h3><p>Sounds available to Members in Voice Rooms.</p>
        {!sounds && !loadError && <p role="status">Loading sounds…</p>}{sounds?.length === 0 && <p className="management-empty">No sounds uploaded. Add your Community’s first sound.</p>}
        {sounds?.map(sound => <article className="management-item-row" key={sound.id} aria-label={`${sound.name} sound`}><span className="management-symbol" aria-hidden="true">{sound.emoji || "♪"}</span><div className="management-item-identity"><strong>{sound.name}</strong><small>{(sound.duration_ms / 1000).toFixed(1)} sec · {Math.round(sound.size / 1024)} KiB</small></div><div className="management-item-actions"><button type="button" onClick={() => { setEditing(sound); setFilename(""); requestAnimationFrame(() => { editor.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); editor.current?.querySelector("input")?.focus({ preventScroll: true }); }); }}>Edit</button><button className="danger-button" type="button" disabled={action.pending} onClick={() => { if (window.confirm(`Delete ${sound.name}?`)) void action.run(async () => { await action.request({ type: "delete_sound", soundId: sound.id }); onSounds(current => current?.filter(item => item.id !== sound.id) || null); if (editing?.id === sound.id) setEditing(null); }, "Sound deleted."); }}>Delete</button></div></article>)}
      </section>
      <form key={editing?.id || "upload"} ref={editor} className="settings-card management-editor" aria-label={editing ? "Edit sound" : "Upload sound"} onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
        void action.run(async () => {
          const name = String(data.get("name") || ""); const emoji = String(data.get("emoji") || "");
          let result: InstanceActionResult;
          if (editing) result = await action.request({ type: "update_sound", soundId: editing.id, name, emoji, position: editing.position });
          else { const file = data.get("file"); if (!(file instanceof File) || !file.size) throw new Error("Choose an audio file first."); if (file.size > 1_048_576) throw new Error("Choose an audio file up to 1 MiB."); result = await action.request({ type: "upload_sound", name, emoji, position: sounds?.length || 0, contentType: file.type || (/\.ogg$/i.test(file.name) ? "audio/ogg" : /\.wav$/i.test(file.name) ? "audio/wav" : "audio/mpeg"), data: new Uint8Array(await file.arrayBuffer()) }); }
          if (result.type !== "sound") throw new Error("Could not save the sound.");
          onSounds(current => editing ? current?.map(item => item.id === editing.id ? result.sound : item) || null : [...(current || []), result.sound]); setEditing(null); setFilename(""); form.reset();
        }, editing ? "Sound updated." : "Sound uploaded.");
      }}><h3>{editing ? "Edit sound" : "Upload sound"}</h3><p>{editing ? "Update how this sound appears in Voice Rooms." : "Add an MP3, WAV, or Ogg file up to 1 MiB."}</p>
        <div className="sound-name-fields"><label>Name<input name="name" placeholder="e.g. Applause" defaultValue={editing?.name || ""} required /></label><label>Emoji<input name="emoji" maxLength={8} placeholder="♪" defaultValue={editing?.emoji || ""} /></label></div>
        {!editing && <div className="management-audio-picker"><span>Audio file</span><label className="settings-upload">Choose audio file<input name="file" aria-label="Audio (MP3, WAV, Ogg; up to 1 MiB)" type="file" accept="audio/mpeg,audio/wav,audio/ogg" required onChange={event => setFilename(event.target.files?.[0]?.name || "")} /></label><small title={filename}>{filename || "No file selected"}</small></div>}
        <div className="settings-actions"><button className="settings-primary" type="submit" disabled={action.pending || !sounds}>{editing ? "Save sound" : "Upload sound"}</button>{editing && <button type="button" onClick={() => setEditing(null)}>Cancel</button>}</div>
      </form>
      <form className="settings-card management-secondary-form" aria-label="Playback limit" onSubmit={event => { event.preventDefault(); const seconds = Number(new FormData(event.currentTarget).get("seconds")); void action.run(async () => { await action.request({ type: "set_soundboard_limit", maxDurationMs: seconds * 1000 }); onLimit(seconds * 1000); }, "Playback limit saved."); }}><h3>Playback limit</h3><p>Set the maximum length of a sound.</p><label>Maximum clip length (seconds)<input key={limit} name="seconds" type="number" min="1" max="30" defaultValue={Math.round(limit / 1000)} required /></label><button className="settings-primary" type="submit" disabled={action.pending || !sounds}>Save limit</button></form>
    </div>
  </ManagementPage>;
}
