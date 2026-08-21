# AllChat

AllChat is a self-hosted communication system for a single online community, operated as one independently deployed instance.

## Language

**Instance**:
One deployed installation of AllChat, including its Community and persisted data.
_Avoid_: Server, deployment

**Community**:
The single social group hosted by an Instance.
_Avoid_: Server, guild, workspace

**Community Owner**:
The Member with ultimate administrative authority over a Community.
_Avoid_: Server owner, instance owner

**Member**:
A person admitted to a Community through an invitation and represented by a local account.
_Avoid_: User

**Direct Message**:
A private, persistent conversation between exactly two Members.
_Avoid_: Private message, group DM

**Voice Room**:
A Community space where Members communicate through live audio and may share a screen.
_Avoid_: Voice channel, call

**Direct Call**:
A live audio session between the two Members in a Direct Message, with optional screen sharing.
_Avoid_: DM voice room, private voice channel

**Category**:
An ordered grouping of Text Channels and Voice Rooms within a Community.
_Avoid_: Channel group, section

**Text Channel**:
A persistent Community conversation contained within a Category.
_Avoid_: Chat room, room

**Role**:
An ordered collection of Permissions assigned to one or more Members.
_Avoid_: Group, rank

**Permission**:
A named authorization granted through a Role and optionally overridden for a Text Channel or Voice Room.
_Avoid_: Privilege, capability

**Attachment**:
A file uploaded by a Member and associated with a message.
_Avoid_: Upload, media

**Moderation Record**:
An append-only account of moderation actions, including the responsible Member and stated reason, but not deleted message content.
_Avoid_: Audit log, moderation log

**Username**:
A Community-unique, case-insensitive, changeable name by which a Member signs in and can be addressed.
_Avoid_: Handle, login

**Display Name**:
An optional, non-unique name a Member presents to other Members.
_Avoid_: Nickname, username

**Invitation**:
A revocable, expiring authorization with a bounded number of uses that admits new Members to a Community with its base Role.
_Avoid_: Invite link, registration token

**Presence**:
A Member-level summary derived from all of the Member's connected sessions, indicating online, idle, do-not-disturb, or offline state.
_Avoid_: Session status, availability

**Read Position**:
The latest message a Member has read in a Text Channel or Direct Message, shared across that Member's sessions.
_Avoid_: Read receipt, last-seen message

**Media Session**:
A Member's active participation in exactly one Voice Room or Direct Call within an Instance.
_Avoid_: Connection, call session

**Reaction**:
A Unicode emoji a Member associates with a message at most once, independently of their other Reactions to that message.
_Avoid_: Custom emoji, response

**Message**:
A persisted UTF-8 text contribution to a Text Channel or Direct Message, optionally containing structured mentions and Attachment references.
_Avoid_: Post, chat

**Mention**:
A structured reference from a Message to a Member, independent of that Member's current Username or Display Name.
_Avoid_: Tag, textual username reference

**Unread State**:
The Messages after a Member's Read Position in a Text Channel or Direct Message.
_Avoid_: Notification, read receipt

**Relay**:
The Instance's built-in service that carries WebRTC traffic when Members cannot connect directly to the SFU.
_Avoid_: TURN server, media proxy

**Block**:
A Member's boundary preventing another Member from initiating new Direct Messages, Direct Calls, or Direct Message Reactions in either direction while preserving prior history.
_Avoid_: Ignore, mute

**Suspension**:
A moderation state that prevents a Member from accessing the Community without erasing their identity or prior contributions.
_Avoid_: Ban, account deletion

**Account Deletion**:
The irreversible anonymization of a Member's identity while retaining otherwise undeleted Community Messages and Direct Message history.
_Avoid_: Suspension, leaving

**Channel Visibility**:
Whether a Member can discover and access a Text Channel or Voice Room, as determined by their Roles and channel-specific Permission overrides.
_Avoid_: Channel membership, subscription

**Recovery Token**:
A short-lived, single-use authorization issued by a privileged administrator that lets a Member replace a forgotten password and invalidates their existing Sessions.
_Avoid_: Temporary password, reset password

**Session**:
A revocable authenticated relationship between a Member and one web or native client device.
_Avoid_: Login, connection

**Desktop Client**:
The installed AllChat application that lets one Member use multiple Instances from one operating-system session.
_Avoid_: Desktop Instance, Electron app

**Instance Profile**:
The Desktop Client's non-secret local record for one Instance, including its stable local identity, address, and presentation metadata.
_Avoid_: Account, server profile

**Desktop Device Session**:
A revocable, scoped Session issued to the Desktop Client for one Member on one Instance and held through the operating system's credential protection.
_Avoid_: Cookie, desktop password

**Conversation Sequence**:
A monotonically increasing position that orders Messages and their subsequent edit or deletion events within one Text Channel or Direct Message.
_Avoid_: Timestamp, global message ID

**Rejoin Window**:
The short interval during which a disconnected Member may resume the same Media Session before their participation ends.
_Avoid_: Session timeout, call persistence

**Reply**:
A Message that structurally references another Message in the same Text Channel or Direct Message.
_Avoid_: Quote, thread

**Pinned Message**:
A Message selected for persistent prominence within its Text Channel or Direct Message.
_Avoid_: Bookmark, saved message

**Report**:
A Member's request for moderator review of content or another Member, including a reason and a recorded resolution state.
_Avoid_: Complaint, automatic infraction

**Archive**:
A reversible state that preserves a Text Channel or Voice Room and its history while removing it from normal active use.
_Avoid_: Delete, hide

**Activity**:
A modular interactive application installed for a Community and run for Members inside an isolated client frame.
_Avoid_: Bot, plugin, embedded website

**Activity Installation**:
A versioned Activity package accepted and enabled or disabled by the Community Owner.
_Avoid_: Extension, server plugin

**Activity Session**:
A short-lived, Activity-scoped authorization connecting one Member to one Activity and optionally one Activity Resource.
_Avoid_: Session, login token

**Activity Resource**:
A durable shared object managed by an Activity, such as a Sketchboard, with Activity-defined ownership and collaboration rules.
_Avoid_: Channel, document

**Sketchboard**:
An Activity Resource owned by its creating Member on which active participants draw ordered strokes together.
_Avoid_: Whiteboard channel, canvas file
