# 12A — Establish Discord-like embedded UI foundation

**What to build:** Make every existing embedded web flow comfortable to dogfood through a cohesive, responsive dark interface closely matching Discord's information architecture, density, and interaction patterns while retaining original AllChat branding and assets.

**Blocked by:** 12 — Search authorized Message history

**Status:** resolved

- [x] Shared embedded CSS, JavaScript, layout conventions, and reusable components replace isolated page styling.
- [x] Auth, Community navigation, Text Channels, search, profile, Sessions, Invitations, Roles, and channel administration share one coherent visual language.
- [x] Desktop and narrow mobile layouts remain usable without horizontal page overflow.
- [x] Keyboard focus, semantic labels, status announcements, reduced motion, contrast, and destructive-action treatment meet the accessibility baseline.
- [x] Existing application routes, authorization, CSRF, realtime, persistence, and self-contained binary behavior remain unchanged.
- [x] Public-seam UI checks, the full acceptance suite, vet, and Linux amd64/arm64 builds pass.

## Answer

All existing web flows now use a self-contained Discord-like dark design system with responsive Community navigation, accessible interaction states, and original AllChat branding. Search includes the same mobile navigation drawer as the other settings flows. Playwright checks pass in desktop Chromium and Pixel 7 emulation without external asset requests.

## Comments

- Verified with `go test -count=1 -buildvcs=false ./internal/...` and the full `./acceptance` suite.
- `go vet -buildvcs=false ./...` passes.
- Static Linux amd64 and arm64 builds pass.
- All 6 Playwright UI foundation checks pass.
