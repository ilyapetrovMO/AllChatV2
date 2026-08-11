# Native Session contract

Type: task
Status: resolved

Add bearer-backed native authentication without weakening cookie CSRF protection. Cover HTTP, realtime WebSocket, media WebSocket, logout, Session listing, revocation, and compatibility tests.

## Comments

- Implemented native login and registration responses, one cookie-or-bearer authentication seam, bearer support for HTTP/realtime/media, CSRF preservation for cookie requests, native logout revocation, and acceptance coverage.
