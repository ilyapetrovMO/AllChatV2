# Milestone 09 — integrated main conversation prototype

## Use

Browser: open main.prototype.html, Fill demo values, Sign in. Send local messages with Enter/Send, toggle members, and search with Enter. All data is synthetic and in memory. Restart resets the demo.

Penpot: page Desktop — Login, flow Desktop login — prototype. Follow Start login, click username/password to load examples, Submit, then Open community. The six main states support member toggling, draft/sent examples, search results/no results, close/jump and restart. Main states are also available independently on Desktop — Main, flow Desktop main — prototype.

Native fields simulate prepared examples. Browser fields support real typing and persistent drafts. Settings, voice, pins, notifications and attachment workflows are visual references/future work; no separate screens were built for them.

## Evidence

Saved version Desktop — milestone 09 integrated conversation prototype, revision 24; independently confirmed in version history. Native graph verification finds all 26 login/main states reachable and verifies the complete guide → login → success → main → draft → sent route. Independent six-state main checks pass on both pages; Penpot file validation is empty. The native search state was rendered and visually inspected. The viewer itself was not automated. Browser milestone 08 has 13 successful checks including minimum-window control bounds, search/jump, drafting and send. The unchanged tested HTML is included here.

The default design and six main states use native editable text/shapes. They use the app-declared Inter working assumption, 1280×800 product geometry and synthetic messages. The browser's 960×640 preset was checked. Native prepared states do not reproduce arbitrary user input or preserve all combinations of toggle/search/draft state; the browser is authoritative for those interactions.

## Backup

This is a reconstruction archive, not a native .penpot export. It includes milestone 03 login, 07 main base, 08 browser, and additive recipes. Restore login from 03 and main from 07. On Desktop — Main, run author-main-prototype.js then wire-main-prototype.js separately. On Desktop — Login, run author-main-login-entry.js, author-integrated-main-states.js, wire-main-prototype.js, then connect-login-main.js. Run the corresponding verifiers afterward. IDs in outputs describe this file; authoring uses names for new objects. Inter and the plugin API are prerequisites. SHA256SUMS covers every included artifact.

## Completion audit

The main-screen layout, browser login entry, composing, member toggle, search, default/minimum browser sizes, native main navigation and native login entry all have inspected evidence. Every implemented milestone has a verified archive; earlier archives remain unchanged.

The broader fidelity gates remain qualified: native export/reimport still fails in the hosted API; automatic token/component changes did not propagate in probes; exact Linux DejaVu Sans typography is not established (Inter retained). These are recorded limitations, not claimed successful checks. No full native-reimport or automatic-library-update guarantee is made. Main-screen prototype review is ready; the entire desktop application is not designed.
