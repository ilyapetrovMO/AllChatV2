# Community administration static coverage

Source: desktop/src/renderer/app.tsx CommunityAdministration and desktop/src/renderer/styles.css. Static designs only. This is an open audit, not an exhaustive coverage claim.

Milestone 51 covers General loading and generic load-failure states at 1280×800, with six navigation tabs and Community search. Source-derived local fixtures use synthetic AllChat Community data and standards-mode Chromium. Entry context is Community Home with no active conversation or call. Header contextual actions when settings is opened from a conversation remain to be audited.

Remaining General coverage: loaded form, Community avatar absent/present/upload/remove states, generated/custom ringtone and controls, all editable fields, expanded relay identity, save failure, native validation, minimum window and scroll views, long content, search/filter/results variants. Server-provided error text can differ from the generic example. No dedicated retry button exists; selecting General requests settings again when settings are absent.

Other administration sections remain open: Dashboard loading/error/loaded health and charts; Channels creation/archive/permissions; Roles creation/edit/reorder/delete; Invitations creation/list/revoke; Soundboard loading/empty/upload/limits/edit/delete. Enumerate their controls and states from source before claiming coverage. Native prompt support needs checking where used.

Exact platform fonts, inherited shell/header fidelity and component/token propagation remain unverified. Local source captures are reference fixtures, not end-to-end application screenshots.
