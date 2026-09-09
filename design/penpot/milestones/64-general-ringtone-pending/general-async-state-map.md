# General asynchronous state coverage

Source: `desktop/src/renderer/app.tsx`, `RingtoneSetting`, `CommunityAvatarSetting`, `AuthenticatedImage`, and the General submit handler. This records static visual reuse, not interactive prototype connections or a complete runtime test.

## Community ringtone

| Trigger / state | Visible result in source | Static reference |
| --- | --- | --- |
| First selection, generated audio, upload pending | Selected filename; Generated tone; no removal button; empty notice | Milestone 64 `ringtone-pending-{wide,small}-generated` |
| First selection, custom audio, replacement pending | Selected filename; Custom audio is active.; removal button remains; empty notice | Milestone 64 `ringtone-pending-{wide,small}-custom` |
| Another upload after a saved upload | New selected filename; custom audio remains; Ringtone saved. remains while pending | Milestones 53/61 `saved`, with filename as input data |
| Another upload after failure with generated audio | New filename; Generated tone and Could not save ringtone. remain while pending | Milestones 53/61 `error`, with filename as input data |
| Another upload after failure with custom audio | New filename; custom audio, removal button and error remain while pending | Milestones 53/61 `error-custom`, with filename as input data |
| Upload after successful removal | New filename; Generated tone and Using the generated tone. remain while pending | Milestones 53/61 `reset`, with filename as input data |
| Upload promise resolves | Custom audio becomes active; Ringtone saved.; selected filename remains | Milestones 53/61 `saved` |
| File read or upload rejects | Previous active audio remains; Could not save ringtone. | Milestones 53/61 `error` / `error-custom` |
| Removal pending or rejects | Prior audio, filename and notice remain; no dedicated pending/error indicator | Reuse the corresponding pre-removal custom state |
| Removal resolves | Generated tone; no removal button; Using the generated tone.; filename retained | Milestones 53/61 `reset` |

The source does not disable the file input or removal button while requests are pending. It does not reset the notice before an upload or removal. Upload success is driven by promise resolution, without checking a result discriminator. Removal has no catch handler. Concurrent requests are possible; this table describes the displayed state for each settlement, not guaranteed request ordering.

Filename content is variable. Milestone 64 uses synthetic `ringtone.ogg` to show the missing selected-file/empty-notice combination. It does not establish long-filename truncation or platform file-picker appearance. Those remain open. Existing middle/bottom General form references remain applicable because file selection does not change card or content height in these fixtures.

## Other General requests

- General save has no dedicated saving or success indicator. Its existing form stays visible while pending. Rejection adds the error already drawn in milestones 56/59. Success updates settings without explicitly clearing an existing error. Issue 09 records the feedback concern.
- Avatar requests also have no pending/failed-upload notice. Pending upload retains the previous avatar while the file input shows the newly selected filename. This combination and long filenames still need explicit references.
- Initial avatar asset loading uses the initial fallback. Replacement asset loading can retain the previous image because a nonempty changed path does not clear `source` first. Image decode failure after blob URL creation remains unrepresented.

General is not complete: native file-picker surfaces, avatar pending/decode cases, filename extremes, contextual headers/search, and platform fidelity remain open. Dashboard and other administration sections remain open as well.
