# 19 — Secure public web traffic

**What to build:** An operator can expose the Instance using a trusted reverse proxy, supplied certificates, or automatic ACME while receiving early validation and secure browser Session behavior.

**Blocked by:** 01 — Boot a self-contained Instance

**Status:** resolved

- [x] Plain HTTP mode is explicit and documents its trusted reverse-proxy/local-testing purpose.
- [x] Supplied-certificate mode validates readable matching certificate/key material before public startup.
- [x] ACME mode validates the public hostname and challenge prerequisites, persists certificates, and renews them automatically.
- [x] Restart uses persisted valid certificates without unnecessary reissuance.
- [x] Public HTTPS mode applies secure cookies, modern TLS defaults, and correct public-origin behavior.
- [x] Invalid or expired configuration fails clearly without replacing a previously usable setup.
- [x] Black-box tests exercise supplied certificates and deterministic ACME lifecycle boundaries without depending on a public CA.

## Answer

Implemented explicit HTTP, supplied-certificate, and persistent ACME modes with early validation, TLS 1.2 minimum, HTTPS-aware secure sessions, durable ACME cache, clear invalid/expired failures, black-box HTTPS coverage, and operator deployment documentation.
