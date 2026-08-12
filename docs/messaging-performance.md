# Messaging performance and overload policy

AllChat targets one active process and one SQLite database on a small VPS. Performance work must preserve Message ordering, authorization, committed-event delivery, and cursor-based recovery.

## State classification

Durable state belongs in SQLite: Messages and their Conversation Sequences, Attachments, Reactions, Mentions, Pins, moderation actions, Read Positions, accounts, channel configuration, and the retained realtime event log. A process restart reconstructs these surfaces from SQLite. Clients resume with a realtime cursor; a cursor older than the retained log receives `snapshot_required` and reloads authoritative state.

Ephemeral state stays in process memory: Presence, typing, voice activity, connection liveness, and pending UI hints. These values are replaceable snapshots, are rate-limited or emitted only when changed, and may disappear on restart. Clients must treat the next snapshot as authoritative.

The commit boundary is `validate -> commit batch -> publish committed events -> fan out`. Network writes and slow clients never hold a SQLite transaction open.

## SQLite policy

The instance opens SQLite in WAL mode with `synchronous=NORMAL`, a 5 second busy timeout, a 1,000-page automatic checkpoint, and a 16 MiB page cache. The schema provides Conversation Sequence and decoration indexes for the hot history queries. `TestMessagingSQLitePolicyAndCoveringIndexes` fails if these settings or query plans regress.

Run the repeatable database checks with:

```sh
go test ./internal/instance -run TestMessagingSQLitePolicyAndCoveringIndexes -count=1
```

For before/after measurements, run the complete burst scenario on the same machine and build, record the instance CPU and resident memory, and retain these values: publication p50/p95/p99 latency, committed transactions per second, maximum realtime queue depth, browser frame p95, Message DOM-node high-water mark, and browser resident memory. Use at least 10,000 pre-existing Messages, a 1,000-Message burst, two active browsers, and one deliberately stalled realtime consumer. A result is invalid if IDs or Conversation Sequences are missing, duplicated, or out of order.

## Bounds and recovery

- Message writes enter a bounded 64-item batch and wait no more than 5 ms for peers.
- Realtime reads return at most 128 retained events per poll; history APIs accept at most 100 Messages per cursor page.
- A browser retains at most 300 Message elements and loads both older and newer pages by Conversation Sequence while preserving its scroll anchor.
- The browser drains at most 16 ordered events per animation frame. At 1,000 queued events it discards the local queue and requests an authoritative snapshot.
- Server network writes have a 5 second deadline. A client that cannot keep up disconnects and resumes from its durable cursor or snapshot.

## Load shedding order

Protect human text Messages first. Under sustained pressure:

1. Drop duplicate or superseded ephemeral snapshots and reduce Presence, typing, and voice refresh frequency.
2. Reject new large Attachment uploads before accepting their bodies; existing published media remains readable.
3. Apply stricter rate limits to integrations and bots than interactive Members, returning an explicit retry response.
4. Disconnect severely lagging realtime consumers so they recover from a cursor or snapshot instead of retaining an unbounded queue.
5. Reject new Message publication only when SQLite cannot safely commit within its busy timeout; never acknowledge an uncommitted Message.

Operators should capture the benchmark above before and after changing a bound. A lower throughput number is acceptable only when it demonstrably protects ordering, recovery, or interactive latency.

## Recorded baseline

On 2026-08-13, the opt-in Playwright benchmark ran locally against schema 20 with 10,000 existing Messages and a 1,000-Message concurrent burst:

| Metric | Result |
| --- | ---: |
| Publication latency p50 / p95 / p99 | 2,591 / 2,895 / 2,942 ms |
| SQLite batch transactions / second | 7.25 |
| Realtime client queue high-water | 256 events |
| Browser frame time p95 | 16.8 ms |
| Live Message DOM nodes after recovery | 50 |
| Reported browser heap before / after | 10 / 10 MB |

The benchmark passed ordering/recovery assertions and is repeatable with:

```sh
ALLCHAT_BENCHMARK=1 npx playwright test ui-tests/layout.spec.js --project=visual-chromium --grep "representative messaging burst benchmark"
```
