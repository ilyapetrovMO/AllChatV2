# Mobile conversation panels

Correction: the earlier Roboto 800 availability conclusion was wrong. Penpot’s partial-name lookup selected Roboto Mono. Exact family matching finds Roboto with weight 800; the live catalogue font correction is tracked in `font-corrections.json`. Historical fallback notes below describe the earlier draft, not an actual font limitation. Visual verification remains pending.
Source: `mobile/src/screens/CommunityScreen.tsx:3373` (`ConversationPanel`), palette in `mobile/App.tsx:252–253`, shared styles in `CommunityScreen.tsx:4477–4496` and `4802–4827`.

Entry: the text-channel header's **Pinned Messages** or **Search Messages** control. The panel uses a native slide modal; Android Back and Close invoke `onClose`. Android status and gesture navigation overlays are OS-owned references, not AllChat components.

| State or control | Implemented behavior | Evidence / design status |
| --- | --- | --- |
| Empty pins | “No pinned Messages.” | Native dark capture and editable draft |
| Empty search query | Search field, Search button, “Enter a search query.” | Native dark capture and editable draft |
| Loading | Accent ActivityIndicator replaces the list | Source reviewed; runtime capture pending |
| No matching results | “No results.” when a nonempty query has no results | Source reviewed; runtime capture pending |
| Pinned results | MessageRow inside a field-colored card | Source reviewed; populated capture pending |
| Search results | Channel/category context above MessageRow | Source reviewed; populated capture pending |
| Jump to message | Calls `onJump(message)`; accessible label names the author | Source reviewed; interaction capture pending |
| Search submit | Button and keyboard search action invoke `onSearch` | Source reviewed; keyboard/results capture pending |
| Close | 44dp hit target, × glyph; invokes `onClose` | Reusable native component and two instances |
| Focus / keyboard | Search input autofocus and native keyboard behavior | Screenshot shows caret; keyboard capture pending |
| Light theme | Same structure with light palette | Source reviewed; capture/design pending |

The Android screenshot pixel scale is 2.625 px per dp (420 dpi emulator). Native drafts preserve the 1080×2400 reference geometry. Source title/button weight is 800; the available Penpot Roboto family only exposes normal weights through 700, so the draft uses 700 and does not pass typography fidelity. Baselines, focused caret, system overlays, and component propagation remain unverified.
