# Coverage evidence audit

This audit links drafts to source surfaces. A link does not prove that every child widget or state is designed. All visual and completeness gates remain open.

| Platform | Source surfaces | With mapped drafts | Without mapped drafts | Fully verified |
| --- | ---: | ---: | ---: | ---: |
| web | 22 | 21 | 1 | 0 |
| desktop | 20 | 11 | 9 | 0 |
| mobile | 21 | 7 | 14 | 0 |

## Surfaces without mapped editable designs

- web-003: activity-host — `internal/instance/activity_http.go`
- desktop-023: Desktop title bar and updates — `desktop/src/renderer/app.tsx`
- desktop-025: Direct calls and media controls — `desktop/src/renderer/app.tsx`
- desktop-028: Message formatting and code — `desktop/src/renderer/app.tsx`
- desktop-029: Link preview — `desktop/src/renderer/app.tsx`
- desktop-030: Attachment card and media — `desktop/src/renderer/app.tsx`
- desktop-033: Community avatar settings — `desktop/src/renderer/app.tsx`
- desktop-034: Ringtone control — `desktop/src/renderer/app.tsx`
- desktop-035: Admin channel row — `desktop/src/renderer/app.tsx`
- desktop-040: Profile image editor — `desktop/src/renderer/app.tsx`
- mobile-043: Active community and account management — `mobile/App.tsx`
- mobile-044: Community and conversations — `mobile/src/screens/CommunityScreen.tsx`
- mobile-046: Media room — `mobile/src/screens/CommunityScreen.tsx`
- mobile-047: Media participant tile — `mobile/src/screens/CommunityScreen.tsx`
- mobile-049: Soundboard — `mobile/src/screens/CommunityScreen.tsx`
- mobile-050: Selected attachment — `mobile/src/screens/CommunityScreen.tsx`
- mobile-051: Conversation timeline — `mobile/src/screens/CommunityScreen.tsx`
- mobile-052: Message row — `mobile/src/screens/CommunityScreen.tsx`
- mobile-053: Attachment view — `mobile/src/screens/CommunityScreen.tsx`
- mobile-054: Image viewer — `mobile/src/screens/CommunityScreen.tsx`
- mobile-055: Link preview — `mobile/src/screens/CommunityScreen.tsx`
- mobile-059: Member profile — `mobile/src/screens/CommunityScreen.tsx`
- mobile-060: Moderation panel — `mobile/src/screens/CommunityScreen.tsx`
- mobile-062: Voice and video settings — `mobile/src/screens/VoiceVideoSettingsScreen.tsx`

Additional desktop OS surfaces are listed in `desktop-os-surfaces.json`. The 853 discovery candidates remain unreviewed; this initial surface list is not exhaustive.
