# Mobile account onboarding

Correction: the earlier Roboto 800 availability conclusion was wrong. Penpot’s partial-name lookup selected Roboto Mono. Exact family matching finds Roboto with weight 800; the live catalogue font correction is tracked in `font-corrections.json`. Historical fallback notes below describe the earlier draft, not an actual font limitation. Visual verification remains pending.
Source: `mobile/App.tsx:79–95,121–147,255–269`. Android reference: `mobile-reference/add-instance-dark.png`, measured with its accessibility hierarchy. Penpot units match the 1080×2400 screenshot; scale is 2.625 px/dp.

| Item / state | Source behavior | Coverage |
| --- | --- | --- |
| Account storage loading | Centered accent spinner before accounts resolve | Source reviewed; capture/design pending |
| Empty account form | Product eyebrow, title, copy, three inputs, Sign in | Native capture and editable draft |
| Instance address | URL keyboard, no capitalization/correction; URL normalization before login | Empty input captured; keyboard/invalid URL pending |
| Username | Username autofill, no capitalization | Empty input captured; autofill/focus pending |
| Password | Password autofill and secure entry | Empty placeholder captured; focused/filled state pending |
| Submitting | Sign in disabled, opacity 0.65, white spinner replaces text | Source reviewed; runtime capture/design pending |
| Error | Inline red status from normalization, login, or secure-storage failure | Source reviewed; runtime capture/design pending |
| Successful login | Stores session, activates first returned account, closes adding/managing, clears password | Source reviewed; navigation capture pending |
| Add another account | Cancel appears when accounts already exist | Source reviewed; capture/design pending |
| Cancel | Closes adding, returns to management when an active account exists | Source reviewed; capture/design pending |
| Light theme | Same layout with light palette | Existing startup reference outside manifest; editable variant pending |
| Native OS surfaces | Status/gesture bars, keyboards, password autofill | Reference-owned; platform capture pending |

Editable draft includes a reusable account input with three label overrides and a reusable submit button. Roboto weight 800 is unavailable in Penpot's current font listing, so title and eyebrow use an explicitly unverified 700 fallback. OS chrome is omitted from app-owned layers. Native font metrics, line wrapping, component override rendering, and keyboard behavior still need visual comparison.

The native API also rejected the title’s source letter spacing of −0.6dp (−1.575px). The draft omits that spacing override; this is an additional typography mismatch, not a source change. A fresh live read verified all seven expected text labels including the three input instance overrides.
