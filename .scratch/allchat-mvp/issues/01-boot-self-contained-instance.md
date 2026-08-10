# 01 — Boot a self-contained Instance

**What to build:** A Community Owner can start one Linux Go binary from validated configuration, have it create and own a SQLite-backed data directory, and reach an embedded web page and versioned health endpoint without installing runtime services.

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] A production-shaped binary starts with a fresh temporary data directory and initializes its SQLite state exactly once.
- [x] The Instance validates boot-critical configuration and rejects invalid values before opening public listeners.
- [x] The binary serves an embedded HTMX page and a versioned JSON health response.
- [x] Graceful shutdown closes listeners and SQLite cleanly; a second process cannot concurrently own the same Instance.
- [x] The black-box test harness starts a real Instance on temporary ports and verifies behavior only through public interfaces.
- [x] The repository declares AGPL-3.0-or-later licensing and builds for Linux `amd64` and `arm64`.
