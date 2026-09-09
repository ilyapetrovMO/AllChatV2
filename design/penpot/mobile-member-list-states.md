# Mobile member list

Source: `mobile/src/screens/CommunityScreen.tsx:3494–3568`, grouping in `memberSections` at 4311. Native light capture shows one Owner (You, idle), zero Online members, and five Offline members from the cached fixture state.

The panel uses a slide modal, a Close Members button, a loading spinner while busy, and a SectionList otherwise. Rows open member profiles and contain an avatar/initial, display name, current-member suffix, username, owner suffix, and presence indicator. Owner/Online/Offline sections show counts. The source sorts each group by name.

Penpot draft uses one reusable light member-row component with six instances and editable identity/presence overrides. Avatar images, online/mobile/DND presence variants, loading, profile navigation, dark theme, and live refresh remain uncaptured. Current member data is cached from the prior fixture session; this capture is not proof of a successful current server fetch. Native font metrics, per-row rounding and OS chrome remain unverified.
