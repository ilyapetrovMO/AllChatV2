# Voice & Video settings coverage

Source: desktop/src/renderer/app.tsx:3556–3671, styles.css:438–452, and voice-capture.ts defaults. Initial native designs cover the complete default form across four scroll positions. Default microphone/speaker/camera use System default; input and output are 100%, noise suppression Standard, echo cancellation on, automatic gain control off, noise gate on, threshold -50 dB, screen-share quality Auto, camera preview off.

All displayed controls are present: three device selectors, microphone/speaker/input-sensitivity ranges and outputs, Mic Test, noise-suppression select, three processing checkboxes, camera preview/Test Video, screen-share-quality select, Play sound and Reset. Changes persist locally without an overall Save button. Reset preserves ringtone volume.

Milestone 28 covers media-device enumeration failure; standard/enhanced/fallback/error microphone notices; camera stopped/error notices; speaker-test and reset notices. All nine are shown below Advanced in the scrolled view, matching the source placement. Enhanced and fallback fixtures retain the enhanced preference.

Still required: native device/processing/quality menu options and selected alternatives; camera-on/Stop Video/started notice; nondefault ranges and processing toggles; focus/hover; minimum-window and long-device labels; full runtime geometry/typography comparison. The test notice strings must come directly from the source, including capture.compatibilityNotice. No live media capture is authorized or needed to draw static fixture states.

Default-menu options: noise suppression Standard / Enhanced (RNNoise) / Off; screen-share quality Auto / Text / Balanced / Motion / Data saver. Device labels use browser-provided names, falling back to numbered Microphone, Speaker or Camera labels when absent.
