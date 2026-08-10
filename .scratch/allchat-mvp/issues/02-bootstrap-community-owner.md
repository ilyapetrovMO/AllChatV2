# 02 — Bootstrap the Community Owner

**What to build:** On a new Instance, its operator can use a one-time setup secret to create the unique Community Owner, authenticate through the embedded web client or versioned API, and recover ownership through an offline command requiring data-directory access.

**Blocked by:** 01 — Boot a self-contained Instance

**Status:** resolved

- [x] First launch emits a high-entropy, single-use setup URL/token without writing it to ordinary request logs.
- [x] The setup flow creates one Owner with an immutable internal identity, unique case-insensitive Username, and Argon2id password hash.
- [x] Reusing or regenerating the setup token after ownership exists is rejected.
- [x] Successful web authentication creates a secure opaque Session cookie; logout revokes it.
- [x] Authentication is rate-limited by account and source and does not reveal whether an account exists.
- [x] An offline recovery command gated by direct data-directory access restores Owner access without exposing the old password.
- [x] Black-box tests cover first setup, duplicate setup, login, rejection, logout, restart, and offline recovery.
