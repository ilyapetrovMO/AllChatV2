# Main desktop screen — final prototype audit

User objective: main desktop app screen design. Apply the user's later screen-by-screen direction: complete a navigable login prototype, then work on the next screen and back up milestones. The earlier full web/desktop/mobile as-built catalog spec is historical, superseded scope; it is not claimed complete here. Settings and other separate screens remain future work.

## Requirements and inspected evidence

| Requirement | Current evidence | Outcome |
| --- | --- | --- |
| Desktop login first, navigable | Native integrated-journey.json starts with the existing login flow; delivered browser requires authentication before main | Met |
| Main desktop screen design | Milestone 07 editable native default, 31 rendered text layers and source-based regions; inspected preview | Met |
| Main navigation and interactions | Delivered HTML re-exercised: login, send, blank-send rejection, members, preserved draft, search, no-results, jump, restart | 13 checks pass |
| Penpot click-through | Fresh native route check finds 26 reachable login/main states and full login-to-sent path, with no validation errors | Met; viewer clicks not automated |
| Default and minimum app sizes | Delivered browser presets 1280×800 and 960×640; composer, search and member list remain inside minimum viewport; rendered previews inspected | Met for browser prototype |
| Saved design | Desktop main — reviewed prototype, revision 25, saved then found in an independent version-history call | Met; not a reopen test |
| Milestone backups | All nine checkpoints preserved as local archives; existing 02–09 hashes rechecked, 01 save-probe directory packaged during audit | Met as reconstruction backups |
| One screen at a time | Login checkpoints 01–06 preceded main checkpoints 07–09; no settings or voice screens constructed | Met |

## Limits retained in handoff

This completes the requested main-screen design/prototype, not the earlier all-platform catalog or production functionality. Sample accounts/messages are local and synthetic. Native inputs advance prepared examples; browser inputs support real typing. Settings, voice, attachment, notification and pin workflows remain visual references/future screens. Inter is retained as the declared app-font working assumption. Native .penpot export/reimport and automatic token/component propagation have documented unsuccessful probes; no success is claimed for them. The user authorized continuing with reconstruction backups despite native export failure. Exact Linux fallback typography and full as-built catalog fidelity remain separate unfinished work.

Use the standalone main.prototype.html in milestone 09. Penpot: Desktop — Login → Desktop login — prototype → Open community; or Desktop — Main → Desktop main — prototype. Browser source is committed on prototype/desktop-login-interactive at 8122c51. The main application source was not changed.
