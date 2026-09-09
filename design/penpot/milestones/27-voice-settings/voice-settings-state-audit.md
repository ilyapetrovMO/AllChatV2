# Voice & Video settings coverage

Source: desktop/src/renderer/app.tsx:3556–3671, styles.css:438–452, and voice-capture.ts defaults. Initial native designs cover the complete default form across four scroll positions. Default microphone/speaker/camera use System default; input and output are 100%, noise suppression Standard, echo cancellation on, automatic gain control off, noise gate on, threshold -50 dB, screen-share quality Auto, camera preview off.

All displayed controls are present: three device selectors, microphone/speaker/input-sensitivity ranges and outputs, Mic Test, noise-suppression select, three processing checkboxes, camera preview/Test Video, screen-share-quality select, Play sound and Reset. Changes persist locally without an overall Save button. Reset preserves ringtone volume.

Still required: native device/processing/quality menu options and selected alternatives; microphone success/enhanced/compatibility/permission-error notices; camera-on/Stop Video/stopped/error states; speaker-test and reset notices; nondefault ranges and processing toggles; focus/hover; minimum-window and long-device labels; full runtime geometry/typography comparison. The test notice strings must come directly from the source, including capture.compatibilityNotice. No live media capture is authorized or needed to draw static fixture states.

Default-menu options: noise suppression Standard / Enhanced (RNNoise) / Off; screen-share quality Auto / Text / Balanced / Motion / Data saver. Device labels use browser-provided names, falling back to numbered Microphone, Speaker or Camera labels when absent.
