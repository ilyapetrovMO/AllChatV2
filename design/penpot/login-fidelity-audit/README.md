# Login fidelity audit — 2026-09-08

Current authoritative state: Penpot file c828d3cf-7d4e-8145-8008-9a4f1a6ff37f, Desktop — Login. Milestone 05 is saved; the reversible token probe advanced the live revision to 18 and restored the original values. Earlier checkpoint archives remain unchanged.

## Token experiment

Changed login.color.brand from #6D75E8 to #FF00FF. A separate execute/read call verified that the token value changed but the primary main control and default-screen instance fills did not. Both held the login.color.brand fill binding; the token set was active. This rules out same-call stale reads and an inactive set for this reproduction.

Calling applyToken again on an already-bound property removed its binding instead of recomputing its fill. It is therefore not a valid propagation refresh operation. The experiment does not prove the cause inside hosted Penpot. The original token value, both original fills, and both bindings were explicitly restored and independently verified; file validation returned no errors. See token-restored.json.

Do not promise automatic palette propagation. Native controls and stored token bindings exist, but a token value edit alone did not update these fills in this environment. No production code change is warranted by this hosted-tool observation.

## Export

A fresh current-file export('penpot','all') failed with Error: No matching clause. No native archive or reimport success is claimed. Milestones 03–05 retain verified reconstruction archives; the browser prototype is self-contained. The user previously authorized continued work despite this native export failure.

## Remaining login review

Navigation and required-field, error/retry, registration/recovery paths have milestone 03 evidence. Minimum-window interaction and geometry evidence is in milestones 04 and 05. Explicit hover/focus references and component-change propagation still need review. Typography preference was requested: current Inter (the declared app font and available Penpot font) versus exact Linux DejaVu Sans fallback matching. No answer has been received at the time of this note; retaining Inter is a working assumption, not user approval.

The broad main desktop screen goal is not complete. Keep next-screen construction sequential after resolving or reviewing these login limits; source inspection for the next screen can proceed without constructing it.
