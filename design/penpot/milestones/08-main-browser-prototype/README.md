# Connected desktop conversation prototype

Open main.prototype.html directly in a browser. Fill demo values and Sign in. Authentication retains the login prototype's simulated flows. Successful login now opens #general with synthetic sample messages.

Type in Message general and press Enter or Send. Shift+Enter inserts a newline. Whitespace-only messages are ignored. Toggle the member list; drafts persist. Search text with Enter, then use Jump to message or Close search. Restart resets authentication and all local messages. Window size presets cover 960×640 and 1280×800.

Everything runs in memory, with embedded CSS/fonts and no backend. Main-screen message identity is the synthetic Alex fixture. Rail, voice, settings, notifications and pins are visual references; their separate flows are not implemented here. Attachment flow is omitted; this prototype uses an explicit Send button to expose composing for review. This is not production code.

Thirteen browser checks passed, including login entry, send, empty-send rejection, member toggles, preserved drafts, search/no-results/jump, minimum-window control bounds, restart and JavaScript errors. Screenshots and the milestone backup live under design/penpot/milestones/08-main-browser-prototype in the main workspace. Penpot still contains milestone 07's static main layout; native navigation is a separate remaining pass.
