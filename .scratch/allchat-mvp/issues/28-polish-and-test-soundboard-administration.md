# 28 — Polish and test Soundboard administration

**What to build:** Make Soundboard administration work consistently through in-app navigation, provide clear upload and management feedback, and lock the browser workflow down with an end-to-end test.

**Status:** resolved

- [x] Opening Soundboard in the settings overlay installs its browser runtime.
- [x] Uploads use `POST` multipart requests and never expose CSRF tokens or file placeholders in URLs.
- [x] Upload, loading, empty, failure, settings, preview, and delete states provide clear feedback.
- [x] Sound cards remain readable with long names and responsive layouts.
- [x] A real WAV upload is exercised through the browser and verified through settings and deletion.

## Answer

Moved the Soundboard administration runtime out of an inline page script and into an overlay-aware module. The form now also has safe native `POST` multipart semantics. A browser regression test covers opening the overlay, uploading valid audio, rendering its duration, updating the limit, and deleting the sound without leaking CSRF data into navigation URLs.
