# Voice & Video settings coverage

Source: desktop/src/renderer/app.tsx:3556–3671, styles.css:438–452, and voice-capture.ts defaults. Initial native designs cover the complete default form across four scroll positions. Default microphone/speaker/camera use System default; input and output are 100%, noise suppression Standard, echo cancellation on, automatic gain control off, noise gate on, threshold -50 dB, screen-share quality Auto, camera preview off.

All displayed controls are present: three device selectors, microphone/speaker/input-sensitivity ranges and outputs, Mic Test, noise-suppression select, three processing checkboxes, camera preview/Test Video, screen-share-quality select, Play sound and Reset. Changes persist locally without an overall Save button. Reset preserves ringtone volume.

Milestone 28 covers media-device enumeration failure; standard/enhanced/fallback/error microphone notices; camera stopped/error notices; speaker-test and reset notices. All nine are shown below Advanced in the scrolled view, matching the source placement. Enhanced and fallback fixtures retain the enhanced preference.

Milestone 29 adds camera-on landscape and portrait fixtures plus a scrolled started-notice view. Source CSS measured with synthetic canvas video gives an 854×320 video element with centered contained content: 568.89×320 for 16:9 and 180×320 for 9:16. Stop Video replaces Test Video and the off placeholder is absent. No physical camera was accessed.

Milestone 30 adds all five expanded select menus: suppression, quality, microphone, speaker, and camera. Device fixtures use two unnamed devices and source fallback numbering. Local Chromium captures show 24px menu rows and an 800px cap for the wide camera menu, aligned to the selector right edge.

Still required: selected alternatives and named/long-device fixtures; nondefault ranges and processing toggles; focus/hover; minimum-window and long-device labels; full runtime geometry/typography comparison. The test notice strings must come directly from the source, including capture.compatibilityNotice. No live media capture is authorized or needed to draw static fixture states.

Default-menu options: noise suppression Standard / Enhanced (RNNoise) / Off; screen-share quality Auto / Text / Balanced / Motion / Data saver. Device labels use browser-provided names, falling back to numbered Microphone, Speaker or Camera labels when absent.
