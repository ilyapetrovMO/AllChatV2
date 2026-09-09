# Desktop authentication prototype

Open `login.prototype.html` directly in a browser. It is a self-contained, throwaway prototype: CSS and fonts are embedded, and all account behavior lives in memory. Nothing is sent to the production app or a server.

Question: can someone navigate authentication, recover from failed login and missing-field validation, and return to sign-in after replacing a password?

Use the real form fields or **Fill demo values**. **Use invalid values** demonstrates an error; editing retains that error until the next submission. **Restart** returns to the initial state. Guided scenario buttons reset the starting state and explain what to try. Register and Recovery tabs open their forms. Successful submission ends at an explicit prototype completion panel.

Demo account: `visual-owner`, password `visual regression password`. Invitation: `demo-invite`. Recovery token: `demo-recovery`. After recovery, Fill demo values uses the replacement password. All state resets when the file reloads.

Current verification: Chromium exercised required fields, invalid credentials, retained-error editing, retry, registration, failed/successful recovery, replacement-password sign-in, restart and keyboard focus order. The demo's login heading deliberately wraps to match the approved Penpot construction. It uses the desktop CSS's declared Inter font, not the Linux fallback from historical captures. No production behavior was changed.

The full Penpot milestone backup and verification evidence are recorded in the main workspace under `design/penpot/milestones/03-login-prototype/`. The prototype branch is a primary-source artifact for review, not a production implementation.
