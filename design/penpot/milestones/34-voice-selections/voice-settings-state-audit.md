# Voice & Video settings coverage

Source: desktop/src/renderer/app.tsx:3556–3671, styles.css:438–452, and voice-capture.ts defaults. Initial native designs cover the complete default form across four scroll positions. Default microphone/speaker/camera use System default; input and output are 100%, noise suppression Standard, echo cancellation on, automatic gain control off, noise gate on, threshold -50 dB, screen-share quality Auto, camera preview off.

All displayed controls are present: three device selectors, microphone/speaker/input-sensitivity ranges and outputs, Mic Test, noise-suppression select, three processing checkboxes, camera preview/Test Video, screen-share-quality select, Play sound and Reset. Changes persist locally without an overall Save button. Reset preserves ringtone volume.

Milestone 28 covers media-device enumeration failure; standard/enhanced/fallback/error microphone notices; camera stopped/error notices; speaker-test and reset notices. All nine are shown below Advanced in the scrolled view, matching the source placement. Enhanced and fallback fixtures retain the enhanced preference.

Milestone 29 adds camera-on landscape and portrait fixtures plus a scrolled started-notice view. Source CSS measured with synthetic canvas video gives an 854×320 video element with centered contained content: 568.89×320 for 16:9 and 180×320 for 9:16. Stop Video replaces Test Video and the off placeholder is absent. No physical camera was accessed.

Milestone 30 adds all five expanded select menus: suppression, quality, microphone, speaker, and camera. Device fixtures use two unnamed devices and source fallback numbering. Local Chromium captures show 24px menu rows and an 800px cap for the wide camera menu, aligned to the selector right edge.

Still required: selected devices and named/long-device fixtures; nondefault microphone/speaker ranges; minimum-window and long-device labels; full runtime geometry/typography comparison. The test notice strings must come directly from the source, including capture.compatibilityNotice. No live media capture is authorized or needed to draw static fixture states.

Default-menu options: noise suppression Standard / Enhanced (RNNoise) / Off; screen-share quality Auto / Text / Balanced / Motion / Data saver. Device labels use browser-provided names, falling back to numbered Microphone, Speaker or Camera labels when absent.

Milestone 31 covers echo cancellation off, automatic gain control on, noise gate off, and input sensitivity at -80 dB / -20 dB. Each checkbox variant changes one preference; the others retain defaults. Sensitivity remains available with the noise gate off, matching the source. The sensitivity check inspects exported SVG text as well as stored characters to detect stale glyphs.

Milestone 32 covers keyboard focus for all four control types using representative microphone selector, microphone slider, noise-gate checkbox and Mic Test button states. All use the source 3px cyan outline with 2px offset; selectors additionally use the brand border and 2px translucent glow. This records shared focus styling; minimum-window clipping and full runtime comparison remain open.

Milestone 33 covers the distinct selector, native range, and native button hover appearances. Local pixel comparison found the checked custom checkbox unchanged on hover. Range and button native paint changes are not reflected by computed background/accent styles: the captured range accent is #3D47E0 and button surface #7B7B7B. Cross-platform native appearance remains unverified.

Milestone 34 covers the six nondefault closed suppression/quality values: Enhanced (RNNoise), Off, Text, Balanced, Motion and Data saver. Together with the default form and expanded menus, both selectors now have all implemented options represented. Explanatory text and independent processing toggles remain unchanged, as in the source.
