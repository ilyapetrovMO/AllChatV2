# 26 — Optimize messaging hot paths

**What to build:** Keep long-running conversations and bursty communities responsive on a small VPS by bounding message, realtime, database, and browser work without weakening durability, authorization, ordering, or recovery guarantees.

**Blocked by:** 25 — Qualify and package the MVP release

**Status:** ready-for-agent

- [ ] Virtualize the active conversation so only messages near the viewport, plus a measured overscan window, create DOM nodes.
- [ ] Maintain a bounded client-side conversation window (initial target: 200–500 Messages), load older history by cursor when scrolling upward, and preserve scroll position while adding or evicting pages.
- [ ] Bound the ingress batch, realtime event, per-WebSocket outbound, and client render queues; slow consumers recover from an authoritative cursor/snapshot instead of growing memory indefinitely.
- [ ] Coalesce replaceable state updates, including Presence, typing, Read Positions, voice activity, and bursty profile changes, while never coalescing ordered durable Message events.
- [ ] Keep ephemeral traffic in memory and durable Message, interaction, moderation, and account state in SQLite; document the classification and recovery behavior.
- [ ] Use Conversation Sequence cursor pagination for every history surface and avoid offset-based pagination on growing tables.
- [ ] Benchmark and document SQLite WAL mode, synchronous policy, busy timeout, checkpointing, cache limits, prepared hot statements, and covering indexes against representative small-VPS workloads.
- [ ] Remove N+1 Message decoration work by loading authors, Attachments, Reactions, Mentions, Replies, and related presentation data for a page or ingress batch with bounded set-based queries.
- [ ] Preserve the `validate → commit batch → publish committed events → fan out` pipeline; no WebSocket or slow consumer may hold a SQLite transaction open or receive uncommitted data.
- [ ] Render locally-authored Messages optimistically with a temporary client ID, then reconcile them with the committed server ID and Conversation Sequence without duplicates or visible flicker.
- [ ] Maintain unread state incrementally from committed Conversation Sequences and Read Positions instead of repeatedly counting complete Message ranges.
- [ ] Define overload shedding that protects human messaging first by rejecting risky uploads, reducing ephemeral update frequency, slowing integration/bot traffic, and resynchronizing severely lagging consumers.

## Suggested order

1. Message-list virtualization and bounded conversation windows.
2. Per-client realtime backpressure and snapshot recovery.
3. Set-based Message decoration.
4. SQLite WAL/index review backed by benchmarks.
5. Optimistic Message rendering and reconciliation.
6. Ephemeral-event coalescing.
7. Incremental unread counters and documented load shedding.

## Acceptance

- [ ] A repeatable burst benchmark records publication latency, SQLite transaction rate, realtime queue depth, browser frame time, DOM node count, and memory before and after each optimization.
- [ ] Message IDs, Conversation Sequences, realtime cursors, and visible rendering remain strictly ordered with no loss or duplication across reconnects, snapshots, validation failures, and shutdown.
- [ ] Accessibility, notification suppression, autoscroll suspension, attachment media growth, Direct Messages, and SPA navigation retain regression coverage under burst delivery.
