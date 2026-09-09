# Ringtone state coverage

Sources: desktop/src/renderer/app.tsx RingtoneSettings (3536–3555), RingtoneSetting (3378–3382), ringtoneFileType (3376), and voice-capture.ts default/clamping rules. CSS settings-card rules at styles.css:455–457 and native file-input rules at 206–209. Historical local Electron screenshot settings-ringtone.png supplies layout reference; native artwork uses the current Inter convention.

Covered in milestone 20: generated-tone fallback, Community ringtone fallback, custom active, successful upload with retained filename and “Ringtone saved.”, failed upload from inactive state, return to Community default, and zero volume. All boards also show the volume range and output. The default volume is 100%; its source range is 0–1 in 0.05 steps.

Remaining distinctions: upload failure while custom audio remains active, reset when Community has no ringtone (fallback becomes generated, but the reset notice still says “Using the Community ringtone.”), file-picker native appearance, hover/focus styles, midrange volume example, supported minimum-window clipping, and full runtime geometry/typography comparison. Community-administration ringtone settings use a separate scope and controls, and remain queued with that screen.

No loading/upload-progress state is implemented by RingtoneSetting. It shows a notice only after the upload promise settles. Removal lacks a catch/status branch for errors, so do not invent a removal error notice. Changing the volume saves locally without adding a success toast or Save button.
