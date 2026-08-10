# 10 — Add rich Message interactions

**What to build:** Members can communicate expressively and preserve context with safe Markdown, structured Mentions and Replies, Unicode Reactions, and Pinned Messages across the API, realtime stream, and embedded UI.

**Blocked by:** 08 — Deliver resumable realtime events

**Status:** resolved

- [x] A deliberately limited Markdown dialect renders safely and stored HTML cannot execute or bypass output encoding.
- [x] Mentions reference immutable Member identity and remain correct after Username or Display Name changes.
- [x] Replies structurally reference a Message in the same conversation and display a safe retained/deleted preview state.
- [x] Each Member may apply each Unicode emoji once per Message and may apply multiple distinct emoji.
- [x] Authorized Members can pin and unpin Messages and retrieve the current pinned set.
- [x] Every interaction emits authorized realtime updates and survives restart.
- [x] Invalid cross-conversation references and unauthorized targets are rejected without leaking hidden content.
