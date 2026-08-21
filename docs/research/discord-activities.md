# Discord Activities: architecture and lessons for AllChat

Research date: 2026-08-21

## Question

How does Discord implement Activities, and which parts of that design should AllChat adopt for a modular Activity system in which an Instance owner can install third-party Activities? The first planned Activity is a shared sketchboard browser where Members can list boards and their current participants, create boards, enter boards, and delete boards they own.

## Executive summary

Discord Activities are separately registered, developer-hosted web applications embedded in a Discord-controlled iframe on desktop, web, and mobile. A JavaScript SDK performs a `postMessage`-based handshake with the host, exposes scoped RPC commands and events, and mediates access to Discord context. Discord assigns a launch to an ephemeral application instance associated with a location; participants can be fetched or observed, while durable multiplayer state remains the Activity developer's responsibility. Network traffic normally passes through a Discord proxy governed by configured URL mappings and CSP. ([Activities overview](https://docs.discord.com/developers/activities/overview), [How Activities Work](https://docs.discord.com/developers/activities/how-activities-work), [Multiplayer Experience](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience), [Networking](https://docs.discord.com/developers/activities/development-guides/networking))

Discord's public model is modular, but not in the sense of uploading arbitrary code to an individual Discord server. Each Activity is a Discord application registered and configured in the Developer Portal, hosted by its developer, and discoverable through Discord only after platform-level verification and discovery opt-in. AllChat therefore needs its own Instance-owner installation, manifest, trust, capability, upgrade, and removal model; Discord's iframe/SDK design is a strong runtime precedent, but Discord's distribution model is not the requested AllChat model. ([Overview of Discord Apps](https://docs.discord.com/developers/quick-start/overview-of-apps), [Enabling Discovery](https://docs.discord.com/developers/discovery/enabling-discovery), [Discovery on Discord](https://docs.discord.com/developers/discovery/overview))

## Discord's architecture

### Activity identity and packaging

- Every Activity is backed by a Discord application. That application is the identity and configuration boundary for credentials, OAuth, metadata, supported platforms, Activity settings, and launch behavior. ([Overview of Discord Apps](https://docs.discord.com/developers/quick-start/overview-of-apps))
- The executable experience is a web app, normally a single-page application. It is hosted by the Activity developer and loaded into an iframe controlled by the Discord client. Discord recommends putting incompatible runtimes, such as a game-engine export, beneath a top-level SPA and bridging messages to it. ([How Activities Work](https://docs.discord.com/developers/activities/how-activities-work))
- The official Embedded App SDK is published as `@discord/embedded-app-sdk`; Discord also maintains starter, SDK-playground, and nested-message examples. ([Embedded App SDK reference](https://docs.discord.com/developers/developer-tools/embedded-app-sdk), [official examples repository](https://github.com/discord/embedded-app-sdk-examples))

### Host/guest boundary and lifecycle

The iframe and Discord client communicate using `postMessage`; the SDK wraps this protocol as RPC. The documented lifecycle is:

1. Discord loads the iframe with launch-specific query parameters.
2. Constructing the SDK starts a handshake; Discord sends a `READY` frame and `ready()` resolves.
3. The Activity requests OAuth scopes and authenticates.
4. Once authenticated, it invokes commands and subscribes to events allowed by the granted scopes.
5. A `CLOSE` frame signals an error or restart requirement. The Activity can also request closure; normal closure is silent, while non-normal closure can display an error.

Commands or subscriptions outside the granted scopes fail, and requesting new scopes can cause the user to reconfirm permission. ([How Activities Work](https://docs.discord.com/developers/activities/how-activities-work))

The SDK's core methods are `ready`, `subscribe`, `unsubscribe`, and `close`. Its RPC surface covers host-mediated capabilities including authorization/authentication, Activity and channel context, connected participants, layout/orientation and platform state, invites and sharing, external links, rich presence, voice state, purchases, and host UI. Availability and required scopes vary by command, event, and platform, so Activities must feature-detect and remain backward compatible. ([Embedded App SDK reference](https://docs.discord.com/developers/developer-tools/embedded-app-sdk), [Production Readiness](https://docs.discord.com/developers/activities/development-guides/production-readiness))

### Authorization and trusted identity

Discord's documented flow uses the SDK's `authorize` command to obtain an authorization code. The Activity frontend sends that code to its own backend, which exchanges it for an access token and returns authentication data to the Activity. The backend, not the embedded frontend, holds the application secret. ([Building Your First Activity](https://docs.discord.com/developers/activities/building-an-activity))

Discord explicitly warns that client-provided context is untrusted and potentially falsified, including the current user and channel. Security-sensitive claims should be verified server-to-server with Discord's API and the OAuth token. Names and other client strings are also unsanitized user input. ([Networking: Security Considerations](https://docs.discord.com/developers/activities/development-guides/networking))

### Instances and participants

- An **application instance** is the shared launch context that lets friends entering the same Activity in the same location reach the same shared state. Discord exposes `instanceId` to the Activity. ([Multiplayer Experience](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience))
- An instance is ephemeral: when all users of an application in a channel leave or close it, that instance ends and is never reused; a later launch in that channel gets a new `instanceId`. ([Multiplayer Experience](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience))
- **Instance participants** are users actively connected to that application instance. An Activity can fetch them with `getInstanceConnectedParticipants()` and subscribe to `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE`. ([Multiplayer Experience](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience))
- A backend can query Discord's Activity Instance API with its bot token to verify that an instance exists and inspect its application, launch location, and users. Discord recommends this because an attacker could load the public Activity URL and imitate the client RPC protocol. ([Multiplayer Experience: Preventing Unwanted Activity Sessions](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience))

Discord defines the cohort and lifecycle but does not provide a generic synchronized game-state database. The Activity developer must run or choose the authoritative multiplayer backend and map `instanceId` to its state. This is an inference from Discord's instance-management guidance and official examples, not an explicitly branded limitation. ([Multiplayer Experience](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience), [official examples repository](https://github.com/discord/embedded-app-sdk-examples))

### Embedding, networking, and security

- Activities are sandboxed behind a Discord proxy. Discord says this hides user and application IP addresses and blocks known malicious destinations. Activity owners configure prefix-to-target URL mappings for permitted external endpoints. ([Local Development: URL Mapping](https://docs.discord.com/developers/activities/development-guides/local-development), [Networking](https://docs.discord.com/developers/activities/development-guides/networking))
- CSP enforces the network boundary. Unmapped external requests fail; the SDK can patch `fetch`, `WebSocket`, and `XMLHttpRequest` URLs for libraries that assume absolute external URLs. ([Networking](https://docs.discord.com/developers/activities/development-guides/networking))
- The proxy currently supports WebSockets but not WebTransport or WebRTC, which materially affects multiplayer and media architecture. ([Networking](https://docs.discord.com/developers/activities/development-guides/networking))
- Cookies must target the Activity's `{clientId}.discordsays.com` domain and use `SameSite=None; Partitioned` for iframe use and per-top-level-site partitioning. ([Networking](https://docs.discord.com/developers/activities/development-guides/networking))
- Discord also documents optional cryptographic proxy-authentication headers, plus the server-side Activity Instance API, as ways to prove requests/instances rather than trusting the iframe. ([Multiplayer Experience](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience))

The iframe and proxy reduce exposure but do not make Activity code trusted. The Activity remains an external principal that should receive only explicit, revocable capabilities.

### Discovery and launch

Discord supports two principal launch paths:

1. A user invokes the application's Entry Point command from the App Launcher. Enabling Activities creates a default `Launch` entry point.
2. An application responds to a command, component, or modal interaction with the `LAUNCH_ACTIVITY` callback (`type 12`).

([How Activities Work](https://docs.discord.com/developers/activities/how-activities-work))

Activities can run in channels, DMs, or group DMs. During development, Activity owners and team members can launch embedded applications from a developer shelf, subject to configured supported platforms. Public distribution is centralized: the team owner completes identity and application verification, opts into Discovery, supplies metadata, and then the app becomes searchable/installable in the App Directory and App Launcher. Discovery also includes installed/recent apps, curated collections, social visibility, links, and rich presence. ([Activities platform overview](https://docs.discord.com/developers/platform/activities), [Local Development](https://docs.discord.com/developers/activities/development-guides/local-development), [Enabling Discovery](https://docs.discord.com/developers/discovery/enabling-discovery), [Discovery on Discord](https://docs.discord.com/developers/discovery/overview))

## What Discord does not provide for AllChat's requirement

The reviewed first-party material does not describe an owner uploading or installing an arbitrary Activity package into one Discord guild, nor Discord executing a third party's backend inside a guild-scoped runtime. Discord owns application registration, verification, discovery, proxy policy, and the client host; developers host their own web app and backend.

Consequently, AllChat must specify mechanisms absent from the Discord model:

- a signed, versioned Activity manifest and package or immutable hosted origin;
- Instance-owner review, installation, enable/disable, upgrade, rollback, and uninstall;
- an explicit capability policy, network allowlist, storage quotas, and CSP generation;
- provenance and integrity checks for code and assets;
- isolation from Instance secrets, database internals, filesystem, and unrestricted server APIs;
- audit logs and a kill switch for an Activity or version;
- compatibility negotiation between host SDK version and Activity API version;
- a choice between developer-hosted backends and tightly sandboxed Instance-side extensions.

This is the main architectural difference between "Discord-like Activities" and the requested owner-extensible AllChat platform.

## Recommended AllChat model

The recommendations below are design inferences from the Discord model, adapted to a self-hosted Instance.

### 1. Separate five concepts

| Concept | Responsibility |
| --- | --- |
| Activity definition | Stable identity, name, icon, developer, versions, entry URL, capabilities, supported clients, integrity/provenance |
| Activity installation | Instance-scoped owner approval, selected version, granted capabilities, network policy, enabled state |
| Activity launch | One user's request to open an installed Activity in a Community/channel/DM context |
| Activity session | Ephemeral host-issued session containing authenticated user, context, Activity version, and expiry |
| Activity resource | Durable Activity-owned domain data such as a sketchboard, with its own owner and ACL |

Do not equate a sketchboard with a Discord-style Activity instance. A board must survive everybody leaving, while a launch/session should expire. This separation also allows many boards to be browsed from one Activity and many users to join the same board across launches.

### 2. Use an iframe and narrow host SDK first

For web and desktop, serve each Activity in a sandboxed iframe on an origin distinct from the main AllChat application. Expose a versioned `postMessage` RPC SDK with:

- handshake and negotiated SDK/API version;
- current authenticated Member and allowed context, represented by opaque IDs;
- launch parameters and Activity resource ID;
- open/close, responsive layout, theme, locale, and safe-area events;
- participant join/leave snapshots for the current resource/session;
- host-controlled invite/share/jump UI;
- short-lived backend session exchange;
- explicit errors for unsupported or ungranted commands.

Keep message, member-directory, moderation, filesystem, and arbitrary Instance APIs out of the first SDK. Add capabilities only for demonstrated Activity needs.

For mobile, either use the same sandbox contract in a hardened WebView or declare an Activity unsupported. Native plugin code should not be the default third-party extension mechanism because it cannot be installed safely or uniformly into already-distributed clients.

### 3. Make the Instance authoritative

The host should mint a short-lived, single-Activity session token after validating the signed-in Member, installation, Community/context access, requested resource, Activity version, and granted capabilities. The Activity backend must validate that token and must never accept user, role, ownership, or Community claims solely from iframe messages.

Use an opaque `activity_session_id`; never expose the normal AllChat bearer token to Activity code. Scope the token to one installation, user, context, resource/session, and expiry. Support revocation when the owner disables the Activity or the Member loses access.

### 4. Treat networking as a granted capability

Default to same-Activity/Instance endpoints only. Generate CSP and host proxy rules from the owner's approved manifest. Require separate grants for external HTTPS and WebSocket destinations. Disallow top navigation, popups, downloads, microphone, camera, screen capture, clipboard, and device APIs unless the manifest requests them and the host supports a clear consent flow.

An initial sketchboard needs HTTPS plus a realtime channel, but no WebRTC, arbitrary external origins, or media-device capability.

### 5. Model lifecycle independently from transport presence

Persist Activity resources and ownership in the Instance database. Track connected participants as leases refreshed by authenticated realtime connections, with a bounded timeout after disconnect. Emit participant snapshots/deltas to the Activity and AllChat UI. Do not infer ownership or deletion rights from presence.

### 6. Give owners a controlled installation workflow

An MVP can support bundled first-party Activities using the same manifest and SDK contract intended for third parties. Follow with owner installation from a trusted registry or an explicit manifest URL. Before enabling, show developer/provenance, requested capabilities, network destinations, version, compatibility range, and data/storage behavior. Never let a third-party bundle run privileged Instance-side JavaScript in the main server process.

If Instance-side backend extensibility is later required, put it behind a separate sandboxed worker/WASM contract with quotas and a narrow host ABI. A remote developer-hosted backend is operationally simpler but discloses participant traffic/data to that developer; an Instance-hosted sandbox preserves self-hosting but substantially increases security and operations complexity.

## First Activity: sketchboard implications

The Activity landing view should call Activity-owned APIs through the granted session and return boards visible in the current Community/context. Each board card needs at least:

- board ID and display name;
- creator/owner ID plus host-resolved display identity;
- current participant summary and count derived from leases;
- creation/update timestamps if used for ordering;
- the current Member's `can_enter` and `can_delete` decisions from the server.

Suggested domain rules:

- `create`: any Member with the Activity's Community-use permission creates a durable board owned by that Member;
- `enter`: validate Community membership and board visibility, mint/join a board session, then subscribe to board operations and participant updates;
- `delete`: server-authorized only when `actor_id == board.owner_id`, unless a separately documented Instance moderation override exists;
- owner departure or offline state does not delete the board;
- deleting an occupied board should require confirmation, atomically mark it deleted, reject new operations, notify participants, and close their board sessions;
- drawing changes should use authoritative ordered operations or a CRDT with snapshots/compaction; participant presence is separate ephemeral data.

This maps Discord's useful participant/instance lifecycle onto AllChat without making the persistent sketchboard accidentally ephemeral.

## Decisions to resolve before implementation

1. Are third-party Activity frontends fetched from developer origins, installed as immutable static bundles on the Instance, or both?
2. Are Activity backends always developer-hosted, or will AllChat define a sandboxed Instance-side runtime?
3. Is a board visible Community-wide, channel-scoped, or configurable? The requested grid suggests Community-wide discovery, but this must be explicit.
4. May Community moderators delete abandoned/abusive boards, or is deletion literally owner-only apart from the Instance owner?
5. Which clients are required for the first release? A shared iframe/WebView contract is the most direct cross-client path, but mobile security and lifecycle need qualification.
6. What install provenance is acceptable initially: bundled first-party only, signed registry, or owner-approved URL with integrity hash?

## Primary sources

- [Discord: Activities platform overview](https://docs.discord.com/developers/platform/activities)
- [Discord: Activities overview](https://docs.discord.com/developers/activities/overview)
- [Discord: How Activities Work](https://docs.discord.com/developers/activities/how-activities-work)
- [Discord: Building Your First Activity](https://docs.discord.com/developers/activities/building-an-activity)
- [Discord: Embedded App SDK reference](https://docs.discord.com/developers/developer-tools/embedded-app-sdk)
- [Discord: Multiplayer Experience](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience)
- [Discord: Networking](https://docs.discord.com/developers/activities/development-guides/networking)
- [Discord: Local Development and URL Mapping](https://docs.discord.com/developers/activities/development-guides/local-development)
- [Discord: Production Readiness](https://docs.discord.com/developers/activities/development-guides/production-readiness)
- [Discord: Overview of Discord Apps](https://docs.discord.com/developers/quick-start/overview-of-apps)
- [Discord: Enabling Discovery](https://docs.discord.com/developers/discovery/enabling-discovery)
- [Discord: Discovery on Discord](https://docs.discord.com/developers/discovery/overview)
- [Discord official Embedded App SDK examples](https://github.com/discord/embedded-app-sdk-examples)
