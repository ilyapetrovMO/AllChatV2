# 03 — Manage Sessions and account recovery

**What to build:** A Member can inspect and revoke authenticated devices, and an administrator can issue a safe recovery path that lets a Member replace a forgotten password without email or administrator knowledge of the new password.

**Blocked by:** 02 — Bootstrap the Community Owner

**Status:** resolved

- [x] The authenticated Member sees each Session's approximate device, creation time, and last activity.
- [x] Revoking one Session immediately removes its access without affecting other Sessions.
- [x] Revoking all Sessions removes every active login, including the current Session after the response completes.
- [x] A privileged administrator can issue a short-lived, single-use Recovery Token without setting a password.
- [x] Redeeming a Recovery Token replaces the password and invalidates all existing Sessions.
- [x] Expired, reused, malformed, and superseded Recovery Tokens are rejected without information leakage.
- [x] Web Sessions use secure HTTP-only cookie behavior and cookie-authenticated commands enforce CSRF protection.
