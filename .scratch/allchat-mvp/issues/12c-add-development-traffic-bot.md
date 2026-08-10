# 12C — Add a development traffic bot

**What to build:** Provide an easy development command that runs a synthetic Member against an AllChat Instance and exercises realtime Messages, inline image Attachments, Presence modes, and profile changes.

**Blocked by:** 12B — Refine Discord-like Channel interactions

**Status:** resolved

- [x] `make dev-bot` starts the development-only bot command.
- [x] The bot logs into an existing Member or registers once with a supplied Invitation.
- [x] The bot discovers authorized Text Channels and sends randomized Messages across them.
- [x] Some Messages contain locally generated PNG Attachments without external assets.
- [x] The bot cycles supported Presence modes and periodically changes its Display Name.
- [x] Configuration, safety expectations, and first-run setup are documented.
- [x] Bot tests, repository tests, vet, and a bot build pass.

## Answer

The `allchat-bot` development command uses only AllChat's public HTTP API and cookie/CSRF contracts. It is opt-in, requires explicit credentials, supports one-time Invitation registration, and stops cleanly on SIGINT or SIGTERM.

The bot also uploads a generated profile avatar at startup so realtime Message rendering exercises actual Member avatar delivery.
