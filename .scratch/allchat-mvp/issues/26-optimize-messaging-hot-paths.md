# 26 — Optimize messaging hot paths

**What to build:** Keep long-running conversations and bursty communities responsive on a small VPS by bounding message, realtime, database, and browser work without weakening durability, authorization, ordering, or recovery guarantees.

**Blocked by:** 08 — Deliver resumable realtime events; 09 — Synchronize Presence, Read Positions, and typing; 10 — Add rich Message interactions; 13 — Exchange Direct Messages and enforce blocks

**Status:** resolved

- [x] Virtualize the active conversation so only messages near the viewport, plus a measured overscan window, create DOM nodes.
- [x] Maintain a bounded client-side conversation window (initial target: 200–500 Messages), load older history by cursor when scrolling upward, and preserve scroll position while adding or evicting pages.
- [x] Bound the ingress batch, realtime event, per-WebSocket outbound, and client render queues; slow consumers recover from an authoritative cursor/snapshot instead of growing memory indefinitely.
- [x] Coalesce replaceable state updates, including Presence, typing, Read Positions, voice activity, and bursty profile changes, while never coalescing ordered durable Message events.
- [x] Keep ephemeral traffic in memory and durable Message, interaction, moderation, and account state in SQLite; document the classification and recovery behavior.
- [x] Use Conversation Sequence cursor pagination for every history surface and avoid offset-based pagination on growing tables.
- [x] Benchmark and document SQLite WAL mode, synchronous policy, busy timeout, checkpointing, cache limits, prepared hot statements, and covering indexes against representative small-VPS workloads.
- [x] Remove N+1 Message decoration work by loading authors, Attachments, Reactions, Mentions, Replies, and related presentation data for a page or ingress batch with bounded set-based queries.
- [x] Preserve the `validate → commit batch → publish committed events → fan out` pipeline; no WebSocket or slow consumer may hold a SQLite transaction open or receive uncommitted data.
- [x] Render locally-authored Messages optimistically with a temporary client ID, then reconcile them with the committed server ID and Conversation Sequence without duplicates or visible flicker.
- [x] Maintain unread state incrementally from committed Conversation Sequences and Read Positions instead of repeatedly counting complete Message ranges.
- [x] Define overload shedding that protects human messaging first by rejecting risky uploads, reducing ephemeral update frequency, slowing integration/bot traffic, and resynchronizing severely lagging consumers.

## Suggested order

1. Message-list virtualization and bounded conversation windows.
2. Per-client realtime backpressure and snapshot recovery.
3. Set-based Message decoration.
4. SQLite WAL/index review backed by benchmarks.
5. Optimistic Message rendering and reconciliation.
6. Ephemeral-event coalescing.
7. Incremental unread counters and documented load shedding.

## Acceptance

- [x] A repeatable burst benchmark records publication latency, SQLite transaction rate, realtime queue depth, browser frame time, DOM node count, and memory before and after each optimization.
- [x] Message IDs, Conversation Sequences, realtime cursors, and visible rendering remain strictly ordered with no loss or duplication across reconnects, snapshots, validation failures, and shutdown.
- [x] Accessibility, notification suppression, autoscroll suspension, attachment media growth, Direct Messages, and SPA navigation retain regression coverage under burst delivery.

## Comments

- 2026-08-13: Added bounded set-based Message decoration, bidirectional Conversation Sequence paging, a 300-node browser window, optimistic client-ID reconciliation, realtime queue bounds, SQLite policy/index assertions, and the performance/recovery policy in `docs/messaging-performance.md`. Fixed SPA runtime parity and retained Direct Message authorization in the set-based realtime filter. Verification: `go test ./...` and `npx playwright test` (125 passed). True viewport virtualization, the representative recorded benchmark, incremental DM unread storage, and executable admission controls remain open.
- 2026-08-13: Completed the remaining work: 80-node viewport/overscan virtualization inside the 300-Message logical window, schema 20 incremental DM unread counters, early oversized-upload admission rejection, replaceable Read Position coalescing, messaging metrics, and an opt-in 10,000-history/1,000-burst benchmark. Final verification: `go test ./...`; `npx playwright test` (125 passed, benchmark skipped); opt-in benchmark passed separately.

## Answer

Messaging hot paths are bounded end to end. Durable ordered events retain cursor/snapshot recovery, replaceable state is rate-limited or coalesced, SQLite page decoration is set-based and indexed, unread state advances incrementally, and the browser maintains at most 80 live Message nodes within a 300-Message recoverable logical window. The repeatable benchmark and its 2026-08-13 baseline are documented in `docs/messaging-performance.md`.
