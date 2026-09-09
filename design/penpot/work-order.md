# Desktop login restart

Current user direction (2026-09-08): start over, work on the Desktop app's login part only, and finish it before moving to another screen. Back up every milestone. This supersedes the previous catalog-wide construction order.

Latest steering: continue until the next milestone despite the plugin native-export failure. The current milestone is the navigable login prototype, backed by a named Penpot version plus a local reconstruction bundle and runnable browser artifact. Native export/reimport remains an explicitly open login-completion check; do not repeatedly stop default-screen construction for it. Do not move to settings or another screen.

## Active scope

Desktop sign-in for an already-added community: default layout, native editable text, reusable form controls, focus/hover and masked-input states, required-field validation references, failed login and retained-error editing, and the successful-login transition. Registration and recovery are included as authentication navigation destinations for this prototype. Settings and other product screens remain queued. Match the implemented desktop app, including supported window sizes and platform typography.

## Milestones and evidence

1. Prove saving with a small clearly labeled login board. Inspect an independent saved version/reopened file and export a valid native backup before expanding it.
2. Finish and visually verify the default sign-in screen. Back up the native file, rendered preview, source mapping and verification record.
3. Finish the applicable login states and transitions using the same controls. Repeat the milestone backup and persistence verification.
4. Audit login against its source and runtime references, verify component/token behavior and native reimport, then review the finished login part before starting another screen.

Each backup goes in a separate milestone directory under `design/penpot/milestones/`. Record file/page/board IDs, revision, artifact hashes and precisely what was verified. A local SVG or a successful live API read is not a native backup or proof of saving. Never label an export successful when the API failed. Keep earlier milestones intact.

## Prior work

Historical catalog artifacts remain references only. The newly connected view contains the original trial board and no Desktop catalog/components; see `reconnected-file-audit.json`. Earlier imports were not proven persisted. Do not restore the whole catalog or count its historical drafts as completed login work.

## Current checkpoint

Milestone 02: the single default login screen has been constructed, rendered, visually reviewed and saved as `Desktop login — milestone 02 default screen`, observed at revision 12. Its local reconstruction backup is `milestones/02-login-default.tar.gz`; the directory alongside it contains previews, source evidence, construction scripts, native shape properties and verification results. Four reusable control definitions have six instances in the screen; twelve native text layers have rendered bounds. This is a default-screen construction checkpoint, not completion of the login part. Stay within login for the next milestone. See `milestones/02-login-default/README.md` for remaining typography, token propagation, state and native-export checks.


Milestone 03: navigable authentication prototype saved as `Desktop login — milestone 03 navigable prototype`, revision 15, independently found in version history. Twenty native states have verified navigation; the browser prototype passed 15 interaction checks and supports actual typing. Backup: `milestones/03-login-prototype.tar.gz`; runnable artifact: `milestones/03-login-prototype/login.prototype.html`. Prototype branch `prototype/desktop-login-interactive`, commit `f961ed4`. This completes the requested navigable prototype checkpoint; remaining full fidelity/export checks are documented in its README. Continue login refinement before starting other product screens.

Milestone 04: browser prototype now offers minimum 960×640 and default 1280×800 window presets. All three authentication submit controls are reachable at both sizes. Register scrolls at minimum size. Verified backup: `milestones/04-login-window-review.tar.gz`. Penpot minimum-window variants and the other recorded full-login gates remain open.

Milestone 05: added three native 960×640 initial-viewport references for Sign in, Register and Recovery, with editable text and source-derived geometry. Saved and independently confirmed revision 16. Reconstruction archive `milestones/05-login-minimum-design.tar.gz` extracted/hash verified. Static references are excluded from the viewer; existing navigable flow remains. Token propagation, platform typography and native export/reimport are still open full-login checks.

Milestone 06: four native focus/hover references added from browser computed styles; saved/confirmed at revision 20. Backup `milestones/06-login-interaction-states.tar.gz` extracted and hash verified. Existing component propagation probe failed; original main/instance radii restored and verified. Login prototype review is usable; full-fidelity/tool limitations remain explicitly recorded in the milestone README. Inter retained as a working assumption pending user preference.

Current goal continuation: usable login-prototype checkpoint is complete; its tool/fidelity limitations are retained, not treated as newly required product work. Proceeding sequentially to the main conversation screen only. Milestone 07 is the default main-screen layout on Desktop — Main, saved/confirmed revision 22 and reconstruction archive verified. Main-screen navigation, typing, member toggle, search and minimum-window review remain. No settings/voice-screen construction.

Milestone 08: standalone browser main prototype connects login to #general, with sending messages, member toggle, draft preservation and search/jump/no-results. Thirteen browser checks pass at default/minimum dimensions. Artifact `milestones/08-main-browser-prototype/main.prototype.html`; archive extracted/hash verified. Penpot native main navigation remains next; no new product screens were constructed.

Milestone 09: native main navigation complete (six states), also integrated onto Desktop — Login via success → Open community. All 26 states reachable, full login-to-sent route verified. Saved/confirmed revision 24; archive extracted/hash verified. Main-screen prototype is ready for review. Remaining full-fidelity limitations are listed in the milestone README; no automatic-update/native-reimport claim.

Final main-screen prototype audit: `main-screen-review/README.md`. Current delivered browser passed all 13 checks; live integrated native graph passed with 26 reachable states. Reviewed Penpot version saved/confirmed at revision 25. All nine milestones now have local archive checkpoints; final review archive extracted/hash verified. The main-screen design/prototype objective is fulfilled; historical all-platform as-built catalog and tool-specific fidelity limitations remain explicitly outside this completion claim.

NEW ACTIVE DIRECTION: complete static design coverage of implemented desktop screens, popovers, controls and applicable states. No new prototypes, browser demos or interaction wiring. Previous prototype completion does not imply complete design coverage. Track source-derived coverage in static-coverage.json and issue 07; proceed screen by screen and preserve milestone backups.

Milestone 10: five static main-popover variants added; expected labels/owner role visibility/native text/no-interaction checks pass. Notification and search-filter renders reviewed; three other renders and remaining states are explicitly pending in static-coverage.json. Saved/confirmed revision 28; reconstruction archive extracted/hash verified.

Milestone 11: six static message/composer states; action ownership checks pass, no links. Owner/member/presence menu renders reviewed; non-owner fixture corrected. Own-actions and reply-composer renders reviewed; other new renders and additional message controls/states remain pending. Saved/confirmed revision 31, reconstruction archive extracted/hash verified.

Checkpoint 12 (not save-confirmed): five static message popover/pins designs created and structurally checked. Penpot disconnected during exports; export session terminated. Local reconstruction archive extracted/hash verified, pending patch and visual/save checks documented. Last confirmed named save remains milestone 11. Reconnect plugin, inspect existing state, then resume without duplicating boards.

Milestone 13: connection recovered, checkpoint12 boards found intact, emoji font/selected reaction reference corrected and rendered. Six static attachment/typing states added with native structural checks. Saved/confirmed revision35 resolves checkpoint12 persistence uncertainty. Attachment/mention exports timed out and process terminated; visual checks remain pending. Reconstruction archive extracted/hash verified.

Milestone14: local native-SVG rendering resolves hosted PNG timeout bottleneck. All17 existing static message/attachment boards visually inspected; two reply excerpts added and verified. Saved/confirmed revision36; archive extracted/hash verified. Coverage ledger separates render inspection from remaining runtime/source comparison. Continue static-only work through missing rich-media, settings and other families.

Milestone15: five static account/Sessions views reviewed, labels and no-interaction checks pass. Fieldset legend clipping fixed. SVG review renderer corrected to exclude duplicate top-level descendants; earlier clipped/overlapping renders require renewed inspection. Saved/confirmed revision40. Reconstruction archive extracted/hash verified. Crop dialogs, upload/validation feedback, native session confirmation and remaining settings are still pending.

Milestone16: six avatar/banner crop and updated views added; native labels/selected filenames/clipping/no-interaction checks pass. Eleven settings renders reviewed after account style corrections and stale-text refresh. Reviewed saved version confirmed at revision 43. Reconstruction archive extracted/hash verified. Native picker, cancelled/error states, validation, session confirmation and remaining settings remain open.

Milestone17: two cancelled avatar/banner crop states rendered and checked; filename/ready status retained, dialog absent, original preview unchanged. Saved/confirmed revision44; reconstruction archive extracted/hash verified. Profile error-path audit confirms no implemented upload/save error notice. Native validation, file picker, Session confirmation and remaining desktop design coverage remain open.

Milestone18: username hover/focus, Save Profile focus and required-username popup references added from Chromium CSS/validation measurements. Native renders inspected and checks pass; saved/confirmed revision45. Reconstruction archive extracted/hash verified. Native file-picker/Session confirmation and broader settings coverage remain open.

Milestone19: native Linux session confirmation content captured; editable confirmation and post-revocation list added and visually checked. Saved/confirmed revision46. Reconstruction archive extracted/hash verified. Native dialog positioning/decoration remains unverified without a window manager; full desktop design coverage remains active.

Milestone20: seven static Ringtone settings states added, rendered and checked. Saved/confirmed revision47. Reconstruction archive extracted/hash verified. Native-picker capture did not produce a visible dialog; investigation retained and design still missing. Ringtone alternate combinations/control states and other desktop families remain active.

Milestone21: failed custom-ringtone replacement, reset without Community audio and 50% volume variants added, checked and visually reviewed. Saved/confirmed revision48; reconstruction archive extracted/hash verified. Ringtone focus/hover, minimum-window and full runtime comparison remain open.

Milestone22: three Ringtone keyboard-focus and three 960×640 viewport designs added, checked and visually reviewed from source CSS measurements. Saved/confirmed revision49. Reconstruction archive extracted/hash verified. Hover/native-picker/full-runtime checks and other desktop families remain open.

Milestone23: four Notifications settings views and Ringtone file-hover added. Author request timed out but live inspection proved all boards complete; no duplicate retry. Native checks/render review pass; saved/confirmed revision50. Reconstruction archive extracted/hash verified. Expanded select menus, notices, control states and minimum-window review remain next.

Milestone24: four Notifications save-result states and two native-select references added. Native captures informed menu styling; channel labels repaired using rendered text clones/TextRange fills. Final checks and render review pass; saved/confirmed revision51. Reconstruction archive extracted/hash verified. Minimum-window/control-state and full runtime comparisons remain open.

Milestone25: five Notifications keyboard-focus references added, checked and visually reviewed, including select-specific border/glow. Saved/confirmed revision52. Reconstruction archive extracted/hash verified. Minimum-window/hover and broader coverage remain open.

Milestone26: Notifications minimum initial/scrolled and both select-hover designs added, source-measured, checked and visually reviewed. Saved/confirmed revision53. Reconstruction archive extracted/hash verified. Long-channel/multi-row edge cases and full runtime fidelity remain open; broader desktop scope remains active.

Milestone27: four Voice & Video default scroll views visually reviewed and checked. Canvas remount repaired stale sensitivity glyphs. Saved/confirmed revision56; reconstruction archive extracted/hash verified. Menus, alternate preferences, test/camera feedback, control states and minimum window remain next; full desktop coverage remains active.

Milestone28: nine Voice & Video feedback views source-checked, visually reviewed and structurally verified. Auto-width native reference text repaired blank exports. Saved/confirmed revision57; reconstruction archive extracted/hash verified. Camera-on/started, menus, alternate preferences and control/minimum states remain open.

Milestone29: landscape/portrait camera-on and started-notice views added, source-CSS measured and visually checked. Native text repaired through an origin-positioned reference. Saved/confirmed revision58; reconstruction archive extracted/hash verified. Expanded menus, alternate settings and control/minimum states remain open.

Milestone30: five expanded Voice & Video menus captured locally, built natively, visually checked and structurally verified. Device text settled near the origin; wide camera popup capped at 800px. Saved/confirmed revision59; reconstruction archive extracted/hash verified. Selected alternatives, named/long devices and control/minimum states remain open.

Milestone31: three nondefault processing toggles and two sensitivity limits added and visually checked. Fresh reference labels repaired stale glyphs; verifier now checks exported sensitivity text. Saved/confirmed revision60; reconstruction archive extracted/hash verified. Other preferences, control/minimum states and broader desktop coverage remain open.

Milestone32: four representative Voice & Video keyboard-focus types source-measured, drawn and visually checked. Saved/confirmed revision61; reconstruction archive extracted/hash verified. Alternate values, hover, minimum-window and full runtime comparison remain open.

Milestone33: selector/range/button hover references captured, sampled and visually checked; checked-checkbox hover is pixel-identical. Native paint changes require pixel inspection beyond computed CSS. Saved/confirmed revision62; reconstruction archive extracted/hash verified. Alternate values, minimum-window and full runtime/native-platform fidelity remain open.

Milestone34: six nondefault suppression/quality selections added, typography corrected and actual exports checked. Saved/confirmed revision63; reconstruction archive extracted/hash verified. Selected/named devices, volume ranges, minimum-window and full fidelity remain open.

Milestone35: selected microphone/speaker/camera references added using unnamed-device fallback labels, visually reviewed and export-checked. Saved/confirmed revision64; reconstruction archive extracted/hash verified. Named/long devices, volume ranges, minimum-window and full fidelity remain open.

Milestone36: microphone 0/200% and speaker 0/50% references added, visually reviewed and export-checked with fresh native labels. Saved/confirmed revision65; reconstruction archive extracted/hash verified. Named/long devices, minimum-window and full fidelity remain open.

Milestone37: four 960×640 Voice & Video default views measured from static source JSX/CSS, mapped, text-repaired and visually checked. Every control has a fully visible reference. Two gateway timeouts were resolved by live inspection without duplicate edits. Saved/confirmed revision67; reconstruction archive extracted/hash verified. Named/long devices, minimum menu/camera-on variants and full fidelity remain open.

Milestone38: all five minimum-window Voice & Video menus source-captured, drawn and visually checked. Menu/option bounds pass. Saved/confirmed revision68; reconstruction archive extracted/hash verified. Device edge fixtures, minimum camera-on and full fidelity remain open.

Milestone39: three minimum-window camera-on views added, source-measured and native exports visually reviewed. Saved/confirmed revision69; reconstruction archive extracted/hash verified. Device edge fixtures and full fidelity remain open.

Milestone40: Safety loading and Member top/bottom static views measured, authored and visually reviewed. Seven Member controls visible across views. Saved/confirmed revision70; reconstruction archive extracted/hash verified. Safety moderator/report/dialog/validation/minimum states remain open.

Milestone41: Six Safety report/moderator static views measured, authored and visually reviewed. Moderator controls visible across views. Saved/confirmed revision72; reconstruction archive extracted/hash verified. Safety menu/dialog/validation/input/minimum states remain open.

Milestone42: three Safety menus source-captured and native exports visually checked. Nine options verified. Saved/confirmed revision73; reconstruction archive extracted/hash verified. Input/validation/dialog/minimum variants and full coverage remain open.

Milestone43: three filled Safety forms source-captured and native exports visually checked. Eight entered fields verified. Saved/confirmed revision74; reconstruction archive extracted/hash verified. Input/validation/dialog/minimum variants and full coverage remain open.

Milestone44: eight Safety native-validation states captured and native exports visually checked. Messages, values and popup bounds verified. Saved/confirmed revision75; reconstruction archive extracted/hash verified. Input/validation/dialog/minimum variants and full coverage remain open.

Milestone45: Safety account confirmation added and visually reviewed. Pinned Electron probes show both Safety prompt calls unsupported; issue08 records unreachable Resolve/Purge paths. Saved/confirmed revision76; reconstruction archive extracted/hash verified. Dialog placement/platform fidelity and other Safety coverage remain open.

Milestone46: Ten minimum-window Safety layouts added and visually reviewed; fourteen controls visible across references. Saved/confirmed revision77; reconstruction archive extracted/hash verified. Minimum menu/validation/input variants and full fidelity remain open.

Milestone47: three minimum-window Safety menus source-captured and native exports visually checked. Nine options verified. Saved/confirmed revision78; reconstruction archive extracted/hash verified. Input/validation/dialog/minimum variants and full coverage remain open.

Milestone48: three minimum-window filled Safety forms source-captured and native exports visually checked. Eight fields verified. Saved/confirmed revision79; reconstruction archive extracted/hash verified. Input/validation/dialog/minimum variants and full coverage remain open.

Milestone49: eight minimum-window Safety validation states captured and native exports visually checked. Narrow long-message wrapping and popup bounds verified. Saved/confirmed revision80; reconstruction archive extracted/hash verified. Input/validation/dialog/minimum variants and full coverage remain open.

Milestone50: Eight empty-data Safety moderator views added and visually reviewed; thirteen controls visible at each size. Saved/confirmed revision81; reconstruction archive extracted/hash verified. Minimum menu/validation/input variants and full fidelity remain open.

Milestone51: Community General loading/error static views added and visually reviewed. Six navigation controls and twelve labels checked on each. Saved/confirmed revision82; reconstruction archive extracted/hash verified. Loaded General form and broader administration states remain open.

Milestone52: Loaded General and expanded relay identity static views added at top/middle/bottom. Native exports reviewed and controls visible across scroll views. Save revision86 confirmed; reconstruction archive extracted/hash verified. Avatar/ringtone variants, validation and broader coverage remain open.

Milestone53: Five Community ringtone states at top/bottom added and visually reviewed. Source active-state retention, filenames, notices and control visibility checked. Saved revision87 confirmed; reconstruction archive extracted/hash verified. Avatar, validation, native file picker and broader coverage remain open.

Milestone54: Four Community avatar static states added and visually reviewed. Source image/initial, removal control, selected filename and unchanged lower layout checked. Saved revision88 confirmed; reconstruction archive extracted/hash verified. Decode/pending/picker/minimum and General validation remain open.

Milestone55: Seven General native-validation static references added and visually reviewed. Source messages, values, focus/popup bounds and numeric spinner checked. Saved revision90 confirmed; reconstruction archive extracted/hash verified. Save failure, input boundaries, minimum window and broader coverage remain open.

Milestone56: Four General save-failure references added and visually reviewed. Source message, shifted layout, scroll visibility and all controls checked. Issue09 records local hidden-feedback probe and stale-error source finding. Saved revision91 confirmed; reconstruction archive extracted/hash verified. Boundaries/minimum and broader coverage remain open.

Milestone57: Two valid General boundary references added and visually reviewed. Local validity,100-character keyboard cap, full editable long text/clipping and field positions checked. Saved revision94 confirmed; reconstruction archive extracted/hash verified. Minimum window and broader coverage remain open.

Milestone58: Six minimum-window General default/expanded views added and visually reviewed. Shell, exact paragraph wrapping, dimensions and complete control visibility checked. Saved revision96 confirmed; reconstruction archive extracted/hash verified. Minimum variants and broader coverage remain open.

Milestone59: Six minimum-window General loading/load/save-failure references added and visually reviewed. Native text, navigation, scroll/error visibility and control coverage pass. Narrow DOM probe extends issue09. Saved revision98 confirmed; reconstruction archive extracted/hash verified. Minimum variants and broader coverage remain open.

Milestone60: Four minimum-window avatar states added and visually reviewed. Source input shrink, wrapped removal button, filenames, image/initial and unchanged lower layout checked. Saved revision100 confirmed; reconstruction archive extracted/hash verified. Narrow ringtone/validation/input and broader coverage remain open.

Milestone 61: Fifteen minimum-window ringtone references added and visually reviewed. Source states, filenames, notices, text positions and complete control visibility checked. Saved revision101 confirmed; reconstruction archive extracted/hash verified. Narrow validation/input and broader coverage remain open.

Milestone 62: Seven minimum-window General validation references added, visually checked, saved at revision 102 and backed up. Local captures verify automatic scrolling, clipped focus rings and the wrapped step-mismatch message. Reconstruction archive extraction and all file hashes verified. Narrow valid-input boundaries and broader coverage remain open. No prototypes or production edits.

Milestone 63: Four minimum-window General valid-input references added, visually checked, saved at revision 103 and backed up. Name length/clipping, attachment limits, empty/filled values and full field visibility across scroll views verified. Reconstruction archive extraction and hashes verified. Pending/file-picker states and broader coverage remain open. No prototypes or production edits.

Milestone 64: Four pending Community ringtone references added, visually reviewed and saved at revision 104. Filename, retained audio, absent notice and unchanged layout verified. Repeated-upload/removal state reuse documented. Reconstruction archive extracted and hashes verified. Avatar pending/decode, picker/filename and broader coverage remain open. No prototypes or production changes.

Milestone 65: Two avatar pending-fallback designs added, visually reviewed and saved at revision 105. Initial, selected file, removal control, wrapping and unchanged form height checked. Other asynchronous avatar appearances mapped to existing references. Reconstruction archive extracted and hashes verified. Decode/picker/filename and broader coverage remain open. No prototypes or production changes.

Milestone 66: Two avatar decode-failure references added, visually reviewed and saved at revision 108. Local malformed-image evidence, clipped alt text and unchanged form layout verified. Reconstruction archive extracted and hashes verified. Picker/filename/platform and broader coverage remain open. No prototypes or production edits.

Milestone 67: Four long-avatar-filename references added, visually reviewed and saved at revision 109. Middle truncation, exact displayed/full names, text fit and unchanged layout checked. Reconstruction archive extracted and hashes verified. Native pickers, ringtone filenames and broader coverage remain open. No prototypes or production edits.

Milestone 68: Two long-ringtone-filename references added, visually reviewed and saved at revision 113. Middle truncation, displayed/full filenames, text fit and unchanged layout checked. Reconstruction archive extracted and hashes verified. Native pickers and broader coverage remain open. No prototypes or production edits.
