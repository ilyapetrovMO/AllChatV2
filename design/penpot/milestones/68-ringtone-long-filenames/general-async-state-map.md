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
- Avatar requests also have no pending/failed-upload notice. Pending upload retains the previous avatar while the file input shows the newly selected filename. Milestones 54/60 `removed` provide the no-avatar selected-file appearance; `uploaded` provides the image-retained selected-file appearance. These are visual reuse mappings, not assertions that the underlying operations are identical. Long filenames remain open.
- Initial avatar asset loading uses the initial fallback. Replacement asset loading can retain the previous image because a nonempty changed path does not clear `source` first. Image decode failure after blob URL creation is represented by milestone 66 for the local Chromium appearance.

General is not complete: native file-picker surfaces, filename extremes, contextual headers/search, and platform fidelity remain open. Dashboard and other administration sections remain open as well.

## Avatar pending and settlement map (milestone 65)

| State | Visible appearance | Static reference |
| --- | --- | --- |
| First upload pending, no prior avatar URL | Initial, selected filename, no removal button | Milestones 54/60 `removed` (same visual combination) |
| Replacement upload pending with a loaded prior image | Prior image, selected filename, removal button | Milestones 54/60 `uploaded` (image artwork represents retained prior content) |
| Upload resolved with a URL, initial asset request pending | Initial, selected filename, removal button | Milestone 65 `avatar-pending-fallback-{wide,small}` |
| Upload selected while an existing URL still shows the fallback | Initial, selected filename, removal button | Milestone 65 `avatar-pending-fallback-{wide,small}` |
| Initial asset request rejects or returns a non-asset result | Initial remains, selected filename and removal button remain | Milestone 65, when reached after upload |
| Asset request yields usable image data | Image replaces initial; filename and removal button remain | Milestones 54/60 `uploaded` |
| Upload rejects | Prior avatar/URL state remains; selected filename remains; no dedicated error text | Corresponding pending appearance above |
| Removal pending or rejects | Current avatar, selected filename and removal button remain | Corresponding pre-removal image/fallback reference |
| Removal resolves | Initial, selected filename, no removal button | Milestones 54/60 `removed` |

The upload continuation sets a new timestamped avatar URL on promise resolution without inspecting a result discriminator. The removal continuation clears the URL. Neither handler catches rejection or disables the controls. `AuthenticatedImage` starts with no source; it sets a blob URL only for an asset result and has no image `onError` handler. Replacement paths can retain a previous source while loading, but the effect cleanup revokes the previous object URL; this map is not a live browser verification of every replacement/decode outcome.

Milestone 65 local fixtures measure only the initial + selected filename + removal-control combination. Long filenames, native picker appearance, contextual headers/search and platform fidelity remain open. Lower General form references are reused because this avatar row remains 64px high.

## Avatar decode failure (milestone 66)

Malformed image data after a blob URL is set renders an img with complete=true and naturalWidth=0 in the local Chromium fixture. The64px rounded purple surface contains clipped Community/avatar alt text; the initial does not return. The removal control and surrounding form remain unchanged. Two native references cover wide/minimum sizes. This covers the no-selected-file fixture; filename state follows the existing selected-file designs. Other browser/platform broken-image renderings are not verified.

## Long avatar filenames (milestone 67)

Four native references show middle truncation for a synthetic long filename at306px and213.25px input widths. The removal control determines the narrower case at minimum desktop size. The full selected name is retained in design metadata. This covers representative avatar filename overflow; ringtone overflow, native picker surfaces and other platform rendering remain open.

## Long ringtone filenames (milestone 68)

Two references cover middle truncation and input-content clipping at862/542px file input widths. The full filename remains in metadata. This geometry also applies to custom-audio cards. Source-derived captures are local and synthetic; native file-picker surfaces, contextual headers/search and platform fidelity remain open.
