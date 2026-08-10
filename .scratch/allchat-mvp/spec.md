# AllChat MVP

Status: ready-for-agent

## Problem Statement

People who operate an online Community need a private, dependable alternative to a hosted Discord server without adopting a complex collection of databases, proxies, media relays, frontend build systems, and operational services. Existing self-hosted communication systems can be difficult to deploy or omit the combination of persistent text, private conversations, moderation, voice, and screen sharing that a Community expects.

Community operators need one independently deployable Instance that is straightforward to install on a VPS, owns its data locally, secures public access, and remains operable through backup, restore, upgrade, and recovery. Members need a coherent web experience for Community conversations and live media, with a client-neutral protocol that can support native desktop and mobile clients later.

## Solution

Build AllChat as an AGPL-licensed, self-contained Go binary for one invite-only Community. An Instance embeds its web frontend, persists structured data in SQLite and files in one data directory, serves HTTPS directly or behind a reverse proxy, runs a Pion SFU for live media, and embeds a Pion TURN Relay for Members whose networks cannot connect directly.

The MVP provides local accounts, invitations, categorized Text Channels and Voice Rooms, one-to-one Direct Messages and Direct Calls, roles and channel Permission overrides, persistent message history, replies, pins, search, Reactions, Attachments, Presence, unread state, reporting and moderation, voice, and screen sharing. A versioned JSON HTTP and WebSocket boundary serves both the embedded HTMX-based web client and future native clients. One active process owns each Instance, with guarded migrations, consistent backup and restore, explicit resource limits, and operator diagnostics.

## User Stories

1. As a Community Owner, I want to install one binary on a Linux VPS, so that I can host a Community without assembling external runtime services.
2. As a Community Owner, I want all persistent Instance data under one configured data directory, so that I can understand and manage what must be protected.
3. As a Community Owner, I want a one-time setup URL and token on first launch, so that I can establish ownership securely.
4. As a Community Owner, I want an offline recovery command gated by filesystem access, so that I can recover ownership when normal authentication is unavailable.
5. As a Community Owner, I want to configure boot-critical networking and storage settings before launch, so that the Instance starts with valid infrastructure settings.
6. As a Community Owner, I want invalid boot configuration rejected before it replaces working configuration, so that a configuration error does not silently damage the Instance.
7. As a Community Owner, I want to run plain HTTP behind a trusted reverse proxy, so that AllChat fits an existing TLS deployment.
8. As a Community Owner, I want to supply certificate files, so that I can use certificates managed outside AllChat.
9. As a Community Owner, I want automatic ACME certificates for a public hostname, so that I can operate HTTPS without manual renewal.
10. As a Community Owner, I want certificates persisted and renewed automatically, so that routine certificate rotation does not interrupt the Community.
11. As a prospective Member, I want to join using a valid Invitation, so that registration is limited to people admitted by the Community.
12. As a Community Owner, I want Invitations to expire, be revocable, and have bounded usage, so that leaked invitations do not grant indefinite access.
13. As a Community Owner, I want new Members to receive only the base Member Role, so that Invitations cannot silently confer elevated authority.
14. As a Member, I want a unique case-insensitive Username, so that I can sign in and be addressed unambiguously.
15. As a Member, I want to change my Username without breaking Mentions, so that my identity is not coupled to mutable text.
16. As a Member, I want an optional non-unique Display Name and avatar, so that I can present myself naturally.
17. As a Member, I want my password stored using a strong memory-hard password hash, so that a database disclosure does not reveal plaintext credentials.
18. As a Member, I want authentication rate limits that do not depend on weak password composition rules, so that my account is protected without arbitrary password syntax.
19. As a Member, I want an administrator-issued, short-lived Recovery Token, so that I can replace a forgotten password without required email.
20. As a Member, I want password recovery to invalidate existing Sessions, so that recovery also removes potentially compromised access.
21. As a Member, I want to inspect and revoke my authenticated devices, so that I control where my account remains signed in.
22. As a Member, I want to revoke all Sessions at once, so that I can respond quickly to suspected compromise.
23. As a Community Owner, I want exactly one transferable Owner Role, so that ultimate authority is explicit and recoverable.
24. As a Community Owner, I want ownership transfer to require fresh authentication and explicit confirmation, so that it cannot happen accidentally.
25. As an administrator, I want ordered Roles composed of named Permissions, so that authority can be delegated coherently.
26. As a Community Owner, I want immutable default Owner, Admin, Moderator, and Member Roles, so that every Instance begins with understandable authority boundaries.
27. As a Community Owner, I want custom Roles, so that Community responsibilities can reflect local needs.
28. As an administrator, I want to be unable to manage Members or Roles equal to or above my highest Role, so that delegated administrators cannot escalate themselves.
29. As an administrator, I want Categories containing ordered Text Channels and Voice Rooms, so that the Community can organize topics and live spaces.
30. As an authorized Member, I want to create, edit, reorder, archive, and restore channels, so that Community structure can evolve without immediate data loss.
31. As a Community Owner, I want permanent channel deletion to be an explicitly confirmed maintenance action, so that history is not casually destroyed.
32. As an administrator, I want per-channel Permission overrides, so that a Role can be allowed or denied access to a specific space.
33. As a Member, I want unauthorized channels hidden entirely, so that private spaces are not disclosed.
34. As a newly authorized Member, I want access to retained Text Channel history, so that the channel remains comprehensible after my access changes.
35. As a Member, I want to send a Message to a Text Channel, so that I can participate in persistent Community conversation.
36. As a Member, I want a Message acknowledged only after durable commit, so that “sent” never means data was merely received and then lost.
37. As a Member, I want concurrent Messages ordered consistently, so that every client observes the same conversation.
38. As a Member, I want to edit my Message with an edited marker, so that I can correct it transparently.
39. As a Member, I want to delete my Message, so that I can remove content I no longer want retained.
40. As a Member, I want to Reply structurally to a Message, so that conversational context survives rendering and Username changes.
41. As a Member, I want to Mention another Member through immutable identity, so that the reference remains correct after profile changes.
42. As a Member, I want to apply multiple distinct Unicode Reactions to a Message, so that I can respond without creating another Message.
43. As a Member, I want each Reaction limited to once per emoji per Member, so that reaction counts are meaningful.
44. As an authorized Member, I want to pin important Messages, so that enduring information remains easy to find.
45. As a Member, I want typing indicators, so that live conversation feels responsive.
46. As a Member, I want full-text search over content I am authorized to see, so that I can find retained information.
47. As a Member, I want limited Markdown rendered safely, so that Messages can be readable without allowing stored HTML.
48. As a Member, I want to upload an Attachment with a Message, so that I can share files with the conversation.
49. As a Community Owner, I want configurable per-file and total-storage limits within safe ceilings, so that Attachments cannot exhaust storage unexpectedly.
50. As a Member, I want safe original display names and non-executable downloads, so that shared files do not become stored script content.
51. As a Community Owner, I want incomplete uploads quarantined and unreferenced files collected after a recovery window, so that storage remains consistent with Messages.
52. As a Member, I want a persistent one-to-one Direct Message with another Member, so that we can converse privately within the Community.
53. As a Member, I want Direct Messages limited to exactly two participants, so that the privacy and ownership model remains clear.
54. As a Member, I want to Block another Member, so that neither of us can initiate new Direct Messages, Direct Calls, or DM Reactions while the Block remains.
55. As a Member, I want prior Direct Message history retained after a Block, so that the safety boundary does not silently erase evidence or context.
56. As a Member, I want my Read Position synchronized across Sessions, so that Unread State is consistent between devices.
57. As a Member, I want reconnecting clients to fetch conversation events after their last cursor, so that transient disconnections do not lose visible activity.
58. As a Member, I want a snapshot recovery path when an old event cursor is unavailable, so that clients can regain consistency.
59. As a Member, I want Presence derived across all of my Sessions, so that one disconnected device does not incorrectly mark me offline.
60. As a Member, I want online, idle, do-not-disturb, and offline Presence, so that others can understand my availability.
61. As a Member, I want a grace period before final offline Presence, so that brief network interruptions do not cause distracting state churn.
62. As a Member, I want in-app Unread State and browser notifications while the web app is open, so that I notice relevant activity without external delivery infrastructure.
63. As a Member, I want to join a persistent Voice Room, so that I can talk with other Community Members.
64. As a Member, I want at most one active Media Session per Instance, so that my audio is not accidentally connected to multiple spaces.
65. As a Member, I want to initiate a Direct Call from a Direct Message, so that I can speak privately with its other participant.
66. As a called Member, I want to accept or decline a ringing Direct Call, so that media never connects without my consent.
67. As a busy Member, I want an incoming Direct Call recorded as missed rather than moving me from my current Media Session, so that existing participation is respected.
68. As a Member, I want a transiently disconnected Media Session to offer a short Rejoin Window, so that brief network failures are recoverable.
69. As a Member, I want active media to end clearly when the Instance restarts, so that clients never imply a call survived downtime.
70. As a Member, I want to share my screen in a Voice Room, so that I can present content to the group.
71. As a Member, I want to share my screen in a Direct Call, so that one-to-one collaboration has the same capability.
72. As a Member, I want only one active screen sharer in a Media Session, so that bandwidth and viewing behavior remain predictable.
73. As a Member, I want optional shared-system audio when my browser and operating system provide it, so that audiovisual demonstrations can include sound.
74. As a Member, I want the interface to state when system-audio capture is unavailable, so that platform variation is not mistaken for an Instance failure.
75. As a Member, I want adaptive media quality with conservative bitrate ceilings, so that voice and screen sharing remain usable on a self-hosted VPS.
76. As a Member, I want direct WebRTC connectivity when possible, so that media avoids unnecessary relay cost.
77. As a Member on a restrictive network, I want the built-in Relay to carry my media, so that calls do not depend on direct UDP access.
78. As a Community Owner, I want the Relay enabled by default with configurable disablement, so that dependable connectivity is standard but external TURN remains possible.
79. As a Community Owner, I want bounded relay ports, allocations, rates, and bandwidth, so that the Relay cannot consume unbounded resources.
80. As a Community Owner, I want short-lived per-Member Relay credentials, so that static browser credentials cannot be reused indefinitely.
81. As a Community Owner, I want Relay traffic denied to loopback, private, link-local, and cloud-metadata destinations, so that authenticated Members cannot use it to probe internal networks.
82. As a Member, I want all client-to-Instance traffic encrypted in public deployments, so that network observers cannot read credentials or communication.
83. As a Member, I want the privacy model stated clearly, so that I understand the trusted Instance operator can access stored Messages and SFU-forwarded media.
84. As a moderator, I want to warn, timeout, kick, suspend, voice-mute, or disconnect a Member, so that I can respond proportionately to Community problems.
85. As a moderator, I want to delete a Message with an actor and reason recorded, so that moderation is accountable without retaining hidden deleted content.
86. As a moderator, I want to revoke Invitations, so that compromised admission paths can be closed.
87. As a Member, I want to Report content or another Member with a reason, so that moderators can review a problem.
88. As a moderator, I want Reports to move from open to resolved with a recorded outcome, so that review work is traceable without automatic punishment.
89. As an authorized auditor, I want to read the append-only Moderation Record, so that moderator actions can be reviewed.
90. As a Community Owner, I want old Moderation Records purgeable only through explicit maintenance, so that routine operation cannot rewrite accountability history.
91. As a participant, I want every Voice Room and Direct Call participant shown visibly, so that nobody can listen invisibly.
92. As a Member, I want moderators unable to activate my devices or screen share, so that moderation authority cannot override device consent.
93. As a departing Member, I want my existing contributions preserved unless deleted, so that leaving does not destroy shared Community context.
94. As a deleted Member, I want my identity anonymized irreversibly, so that retained conversation is no longer tied to my active account.
95. As a Direct Message participant, I want retained history to remain available after the other account is deleted, so that one participant cannot erase the other participant's copy wholesale.
96. As a Member, I want an export of my profile, authored Messages, Direct Message history, and Attachment references, so that my data is portable.
97. As a Community Owner, I want an online-consistent Instance backup, so that I do not need to copy a live SQLite database unsafely.
98. As a Community Owner, I want full backup and restore to include SQLite data and Attachments coherently, so that restored references do not point to missing or mismatched files.
99. As a Community Owner, I want a pre-migration backup before an automatic schema migration, so that an upgrade has a recovery point.
100. As a Community Owner, I want migration failure to prevent startup, so that the Instance does not run against a partially upgraded schema.
101. As a Community Owner, I want downgrade instructions to require restoring a matching backup, so that unsupported reverse migrations do not corrupt data.
102. As a Community Owner, I want structured operational logs without content or secrets, so that I can diagnose failures without creating a second privacy leak.
103. As a Community Owner, I want authenticated health and status diagnostics, so that I can inspect Instance health from the administration interface.
104. As a Community Owner, I want an optional Prometheus endpoint disabled by default, so that advanced monitoring is available without expanding the default exposure.
105. As a Community Owner, I want persistent writes to fail closed when storage is exhausted, so that the Instance never acknowledges data it could not save.
106. As a Community Owner, I want read access and safe live media to continue during a storage failure, so that one failed subsystem does not cause unnecessary total downtime.
107. As a Community Owner, I want a visible low-disk alert and reserved capacity, so that I can intervene before storage is completely exhausted.
108. As a Community Owner, I want release binaries with checksums and a documented replacement procedure, so that upgrades do not require a package manager or self-updater.
109. As a web Member, I want the embedded interface to support keyboard use, visible focus, semantic controls, screen readers, sufficient contrast, and reduced motion, so that core communication is accessible.
110. As a Member, I want timestamps displayed in my local timezone while stored consistently, so that conversation time is understandable across locations.
111. As a future translator, I want user-facing strings structured for localization, so that adding languages does not require redesigning the interface.
112. As a future native-client developer, I want versioned client-neutral HTTP and WebSocket contracts, so that desktop and mobile clients can use the same application behavior.
113. As a future native-client developer, I want the first native release to establish a compatibility commitment, so that pre-release API iteration does not create accidental permanent contracts.
114. As a Community Owner, I want AllChat tested at 500 registered Members, 100 online Members, and 25 participants in one Voice Room, so that the supported operating envelope is evidence-based.

## Implementation Decisions

- The product uses the canonical domain vocabulary in `CONTEXT.md`: one Instance contains exactly one Community; “server” and “guild” are not domain synonyms.
- One active Go process owns an Instance. Multiple processes sharing a Community or SQLite database are unsupported; scaling is vertical within the stated capacity target.
- Core operation requires only the host operating system and one binary. SQLite, embedded frontend assets, application configuration, TLS material, Attachment storage, Pion SFU, and Pion TURN are integrated into the Instance.
- Boot-critical settings include the data path, HTTP/HTTPS listen addresses, public URL, public media address mapping, TURN listener and relay range, and TLS mode. Configuration files and CLI flags define these settings; environment overrides support deployment tooling.
- Community policy, Roles, Permissions, Categories, channels, limits, Invitations, and moderation configuration are managed through authenticated application operations and the administrative interface.
- Listener, public-network, Relay range, data-path, and low-level TLS changes require restart. Domain-level Community settings apply live.
- The first-run bootstrap emits a single-use setup URL/token. Offline Owner recovery requires direct filesystem access to the Instance data directory.
- Local Member accounts use immutable internal identifiers, unique case-insensitive changeable Usernames, optional non-unique Display Names, and avatars.
- Passwords use Argon2id with salts and versioned parameters. Authentication has account- and source-aware throttling, a sensible length floor, and compromised/common-password rejection without arbitrary composition rules.
- Web Sessions use opaque revocable server-side state and secure HTTP-only cookies. Future native clients use scoped bearer credentials. Recovery Tokens are short-lived and single-use and invalidate existing Sessions.
- Invitations are revocable, expiring, and usage-bounded. They always confer only the base Member Role.
- Roles are ordered collections of Permissions. Owner, Admin, Moderator, and Member defaults exist; custom Roles are supported. A Member cannot manage peers or Roles at or above their own highest Role.
- Categories contain ordered Text Channels and Voice Rooms. Channel-specific allow/deny Permission overrides determine Channel Visibility. Authorization grants access to retained history rather than creating per-Member historical partitions.
- Channels support archive and restore. Permanent deletion is Owner-only, explicitly confirmed, and participates in Attachment garbage collection.
- Messages contain UTF-8 plain text rendered using a limited safe Markdown dialect. Stored HTML is never accepted. Mentions, Replies, and Attachment references are structured data.
- Each Text Channel and Direct Message has a Conversation Sequence ordering Message creation, edit, and deletion events. Creation is acknowledged only after the SQLite transaction commits.
- Clients resume through a realtime event cursor. When retained events cannot satisfy a cursor, clients obtain a current authorized snapshot and continue from its cursor.
- SQLite full-text search indexes authorized Message content. Search results must be filtered by current authorization and Blocks where applicable.
- Reactions use Unicode emoji only. Each Member may apply one instance of each emoji to a Message and multiple distinct emoji.
- Attachments use generated storage identities while preserving safe display names. Metadata is transactional in SQLite; bytes move from temporary quarantine into managed storage only as part of successful Message publication.
- Attachment downloads use non-executable content disposition. The MVP does not claim antivirus scanning. Unreferenced files are garbage-collected after a recovery window.
- Direct Messages contain exactly two Members. Blocks prevent new DM Messages, DM Reactions, and Direct Calls in both directions while retaining prior history.
- Read Positions persist per Member and conversation and synchronize across Sessions. Presence aggregates all Member Sessions with a grace period, inactivity-based idle behavior, and manual do-not-disturb.
- A Member may participate in only one Media Session per Instance. Voice Rooms persist as Community spaces; Direct Calls are ephemeral and require ringing plus explicit acceptance.
- Media state does not survive process restart. A brief Rejoin Window permits recovery from transient disconnection.
- The Pion SFU forwards Opus audio and simulcast screen video where available, selecting layers based on receiver bandwidth and visibility and enforcing configurable safe bitrate ceilings.
- One participant may screen-share in a Voice Room or Direct Call at a time. Shared system audio is optional when the browser and operating system expose it and is not universally guaranteed.
- The embedded Pion TURN Relay is enabled by default when media is enabled and can be disabled for external TURN. Standard deployment uses UDP/TCP 3478, TURN/TLS 5349 when certificates are available, and a bounded configurable UDP relay range. HTTPS and TURN/TLS do not share IP:443 in MVP.
- Relay credentials are short-lived and per Member. Allocation quotas, rate limits, bandwidth/resource ceilings, and forbidden private/loopback/link-local/metadata destinations constrain abuse.
- Public media address rewriting is configurable for VPS environments where the process binds a private interface behind public one-to-one NAT.
- Public deployments encrypt transport. The MVP does not implement end-to-end encryption against the Instance operator; stored Message content is readable by the Instance, and the SFU terminates WebRTC transport.
- Moderation supports warnings, timeouts, kicks, Suspensions, invite revocation, Message deletion, voice mute/disconnect, and Reports. Actions record actor and reason without retaining deleted Message bodies.
- The Moderation Record is append-only during ordinary operation and visible only through a dedicated Permission. Purging old records is an explicit Owner maintenance operation.
- Account Deletion anonymizes Member identity while preserving otherwise undeleted Community Messages and Direct Message history. Members may delete individual Messages before deleting their account.
- Full Instance backup uses SQLite's online backup capability and a defined Attachment snapshot procedure. Migration is transactional and forward-only, starts after a pre-migration backup, and prevents startup on failure.
- API and realtime contracts live under a v1 boundary. Breaking v1 changes are allowed before the first native client release; afterward, incompatible changes require a new major version and a documented support window.
- HTMX is a web-only presentation layer. Client-neutral JSON HTTP operations handle commands and history; one versioned WebSocket protocol carries events and WebRTC signaling.
- TLS modes are plain HTTP for trusted reverse proxies/testing, operator-supplied certificates, and automatic ACME for a configured public hostname. ACME mode persists and renews certificates and requires the documented DNS and inbound-port setup.
- Structured logs go to stdout and exclude Message bodies, credentials, tokens, and Relay secrets. Authenticated diagnostics are available in the administration UI; optional Prometheus metrics are disabled by default.
- Resource limits have conservative defaults, safe hard ceilings, and explicit client errors. Security-sensitive authentication and Relay protections cannot be disabled.
- Persistent operations fail closed on SQLite or disk errors. The Instance reserves disk headroom, rejects risky new uploads before exhaustion, surfaces operator alerts, and keeps safe read/media behavior available where possible.
- Production release targets are Linux amd64 and arm64. Windows and macOS may be development targets but are not production commitments in MVP.
- Timestamps are stored as UTC instants and localized by clients. English ships first, with interface strings structured for later localization.
- The project is licensed AGPL-3.0-or-later in accordance with the accepted reciprocity ADR.

## Testing Decisions

- Tests assert externally observable behavior rather than private Go types, SQL statements, package structure, or HTMX fragments. Refactoring internal modules must not invalidate tests when the Instance contract remains unchanged.
- The primary and intentionally broad seam is a real AllChat Instance started with temporary configuration, ports, certificates, and data. Tests interact only through public HTTP, WebSocket, WebRTC/TURN, CLI, and backup/restore behavior and inspect persisted outcomes only where an operator could.
- There is no existing code or prior test suite. The Instance-level black-box harness is therefore the project’s initial testing prior art and should remain the preferred seam as modules emerge.
- Contract scenarios cover first-run setup, invitations, authentication, password recovery, Session revocation, ownership transfer, Role hierarchy, Permission overrides, and hidden-channel authorization.
- Messaging scenarios cover commit-before-acknowledgement, Conversation Sequence ordering, cursor resume and snapshot recovery, edits, deletion, Replies, Mentions across renames, Reactions, pins, typing, search authorization, Blocks, Read Positions, and Presence aggregation.
- Attachment scenarios cover interrupted upload, failed Message transaction, safe download headers, size/storage limits, Message and channel deletion, delayed garbage collection, low-disk reserve behavior, backup consistency, and restore.
- Moderation scenarios cover every action, authorization boundaries, Reports, append-only Moderation Records, deletion without hidden content retention, account anonymization, and explicit record purge.
- Media scenarios use real WebRTC peers against the Instance to cover Voice Rooms, Direct Call consent, busy handling, the one-Media-Session invariant, screen-share exclusivity, optional system audio negotiation, adaptive layers, disconnect/rejoin, and process restart.
- Relay scenarios exercise direct candidates and forced-relay candidates, short-lived credentials, expiry, allocation quotas, bounded ports, forbidden destinations, TCP/TLS listener configuration, public/private address rewriting, and external-TURN mode.
- TLS scenarios cover supplied certificates, ACME configuration validation and renewal state, reverse-proxy HTTP mode, secure-cookie behavior, and rejection of invalid boot configuration.
- Lifecycle scenarios cover first launch, graceful shutdown, dirty restart, online backup, full restore, pre-migration backup, successful migration, migration rollback-on-failure, downgrade-by-restore, and binary replacement.
- Security scenarios verify Argon2id parameter versioning, authentication throttling, CSRF protection for cookie-authenticated commands, output encoding, safe Markdown, authorization on search and realtime events, secret-free logs, TURN internal-address denial, and non-disableable protection ceilings.
- Resource scenarios establish the supported envelope of 500 registered Members, 100 concurrent web connections, and 25 Voice Room participants, including mixed messaging, Presence, direct and relayed media, and bounded degradation.
- A small browser suite drives the embedded web client through the same public Instance boundary on the current and previous Chromium and Firefox majors and current Safari. It covers HTMX navigation, reconnect behavior, screen-capture affordances, responsive mobile text chat, keyboard operation, focus, semantic labels, contrast, and reduced motion.
- Mobile-browser media is tested and documented as best-effort rather than a release guarantee. Native client testing begins when a native client establishes the stable API compatibility promise.
- The MVP release acceptance test starts from a clean supported Linux VPS, establishes TLS and a Community without external required services, invites two Members, exercises text/search/replies/Attachments, completes Direct and Voice media through direct and relayed paths, performs moderation and Permission changes, restarts without data loss, backs up/restores, upgrades, and passes the stated load target.

## Out of Scope

- Multiple Communities in one Instance, horizontal clustering, shared SQLite access, and automatic failover.
- Federation, public Community discovery, anonymous or guest access, and interoperability or synchronization with Discord.
- Group Direct Messages, threads, polls, scheduled Messages, stickers, custom emoji, rich embeds, bots, and a public plugin system.
- Webcam video, recording, transcription, invisible moderator listening, and activation of another Member's microphone, camera, or screen capture.
- End-to-end encryption against the trusted Instance operator.
- Email delivery, email verification, external OAuth, background web push, and native push notifications.
- Bundled external databases, caches, reverse proxies, object stores, antivirus services, and mandatory third-party infrastructure.
- TURN/TLS multiplexing with HTTPS on the same IP and port, and guarantees for browser system-audio capture or restrictive environments outside the documented Relay configuration.
- Automatic content retention policies, hidden retention of deleted Message bodies, and automatic destructive cleanup during resource exhaustion.
- Self-updating binaries, reverse database migrations, and production support for Windows or macOS.
- A stable public API before the first native client release; native desktop and mobile applications themselves are the next product step, not MVP deliverables.
- Full localization management and automatic voice transcription.

## Further Notes

- ADR 0001 establishes the self-contained single-binary constraint.
- ADR 0002 establishes the embedded TURN Relay and its security/resource obligations.
- ADR 0003 establishes SQLite ownership by one active process and vertical scaling.
- ADR 0004 establishes AGPL-3.0-or-later for network-use reciprocity.
- The embedded Relay does not eliminate firewall and network setup. Standard operators must expose its listeners and bounded relay range and configure the advertised public IP where the VPS presents a private interface.
- The privacy documentation must plainly state the trusted-operator model before Members rely on Direct Messages or live media for sensitive communication.
- Community-facing limits should ship with measured defaults rather than values guessed into the durable specification; the hard capacity target and safety invariants are fixed here.
- The spec deliberately defines behavior and boundaries rather than package names or source paths because the repository is greenfield and those structures should emerge during implementation planning.
