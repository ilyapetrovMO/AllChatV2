# Profile state coverage audit

Source inspected: desktop/src/renderer/app.tsx ProfileImages (3672–3733), account form (1405–1453), executeAction (140 onward), and authenticated CommunityShell render (401 onward). Static design goal remains active.

| Trigger | Implemented visible result | Design evidence / remaining work |
| --- | --- | --- |
| Choose avatar/banner | Editor opens at zoom 1; file input retains filename; ready status appears | Milestone 16 |
| Zoom to 3 | Centred image scales inside clipped circular/banner preview | Milestone 16 |
| Cancel crop | Editor closes; original profile image remains; filename and ready status remain | Milestone 17 |
| Successful crop upload | Editor closes; profile asset updates; updated status appears; filename remains | Milestone 16 |
| Image decode/canvas failure | uploadCrop has no catch or error-state setter; editor remains | No separate error-message design is warranted by current code; existing crop appearance applies |
| update_profile_image rejection | executeAction rethrows; uploadCrop exits before status/editor changes | Existing crop appearance remains; no implemented profile error notice |
| Remove image | Calls remove_profile_image, with no local status update or confirmation | Empty image references exist; retained-status combinations still need item-level review |
| Empty required username | Native browser constraint validation | Milestone 18: editable Chromium popup reference and empty/focused input; other platforms pending |
| Save profile rejection | submit calls onAction without a local catch or notice | No implemented profile error notice; do not add invented copy |
| Revoke another Session | window.confirm before mutation | Milestone 19 native Linux content reference; window decoration/placement and other platforms pending |

This audit records implemented behavior, including missing feedback. It does not approve that behavior as good UX or introduce production fixes. The file picker and native validation/confirmation surfaces vary by platform; their designs need runtime evidence before claiming exact coverage. Focus/hover variants, minimum-window layout, and full runtime geometry comparison remain open.
