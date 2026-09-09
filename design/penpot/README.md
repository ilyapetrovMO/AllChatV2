# AllChat Penpot trial

**Current work order: desktop to completion, then web, then mobile.** See [work-order.md](work-order.md). Web and mobile work is paused. Historical draft counts below do not indicate verified completion.

Status: **draft imported into hosted Penpot**. See `connected-file.json` for identifiers and remaining work. The screen and 50 candidate tokens have been added; SVG text has been converted to native text, with font and positioning review still pending. These artifacts preserve the current desktop text-channel appearance; they are not yet an approved design specification. Production UI is unchanged.

## Artifacts

- `reference.png`: actual application capture, dark theme, 1280×720, disposable fixture data.
- `text-channel.svg`: editable vector/text starting point extracted from that screen. Text baselines, clipping, pseudo-elements, shadows and icon details require visual review; this is not a lossless browser-to-Penpot conversion.
- `tokens.json`: candidate colors, dimensions, observed font sizes and spacing extracted from CSS. Typography families/weights are recorded in `computed-styles.json`; semantic typography styles still need authoring. Tokens are not bound to Penpot shapes yet.
- `computed-styles.json`: selectors, geometry and browser-computed styles for mapping back to code.
- `capture.json`: source commit, browser, fixture and limitations.

Regenerate with `node design/penpot/capture.mjs` from the repository. Requires installed repository dependencies, Go, and Playwright Chromium. It starts a disposable instance on port 4187, creates fixture messages, captures the screen and removes its temporary data. Keep that port free. Run only when intentionally updating the visual baseline; review the resulting diff.

## Connect hosted Penpot

1. Run `bash design/penpot/start-mcp.sh`. This installs the official `@penpot/mcp` version 2.15.4 and pnpm 10.31.0 into an ignored `.dev/penpot-mcp` workspace. Keep the process running.
2. Configure Codex once: `codex mcp add penpot --url http://localhost:4401/mcp`. This has already been done on the current machine. Restart the agent session to discover the configured tools if needed.
3. At https://design.penpot.app create project **AllChat**, file **AllChat Design Trial**.
4. In that file, open Plugins → Load from URL and load `http://localhost:4400/manifest.json`. Run the plugin and select **Connect to MCP server**. Allow local-network access if your browser requests it. Keep the plugin open. The browser must be on the machine running the bridge (WSL localhost forwarding may apply).
5. Check with `node design/penpot/check-connection.mjs`. It is read-only and reports the active file. Confirm its name before making design changes. Share the public file URL, never an account password or token.

Official setup: https://help.penpot.dev/mcp/

## Remaining connected-file work

- Create a reference board and an editable 1280×720 text-channel board; import the SVG as native editable shapes and compare against the PNG.
- Create reusable navigation-item, message-row, avatar, composer and button components. Use instances in the screen. Verify text remains editable.
- Import candidate tokens, define named typography styles and bind component fills/dimensions to shared tokens. Change one token and verify its instances update, then restore it.
- Obtain one visual correction as a Penpot comment, apply it and obtain approval. Do not label the baseline approved before that review.
- Export the native file as `AllChat Design Trial.penpot`, export a reference PNG and tokens, then reimport the native file into a separate trial file. Verify components, token bindings and editable text survive.
- Record the file URL, approved revision and component identifiers in this directory. The native `.penpot` export has deliberately not been fabricated.

## Initial code mapping

| Design element | Current DOM selector |
| --- | --- |
| Channel navigation item | `a.channel-link` |
| Message row | `article.message` (see computed styles for actual class variants) |
| Message avatar | `.message-avatar` |
| Composer | `#composer`, `#message-body` |
| Member avatar | `.member-avatar` |

Styling sources: `internal/instance/web/assets/app.css` and `internal/instance/web/assets/channel.css`. These mappings describe the current web reference; mobile adaptations and production token adoption are outside this pilot.

## Full platform catalog

The trial has expanded into an as-built catalog of all three clients. `coverage.md` / `coverage.json` map 63 initial surfaces to source. `inventory-candidates.json` contains broader, unreviewed control discovery; regenerate it with `python3 design/penpot/discover-ui.py`. Candidate counts are not completion counts.

Run `node design/penpot/capture.mjs --catalog` to also capture 14 authenticated web routes and their rendered controls into `web-reference/`. These are default/empty-state references, not exhaustive state coverage or editable Penpot designs. Full-page images may exceed the 720px viewport height.

See `verification-notes.md` for the unresolved hosted editing/export discrepancy. Do not mark a surface complete until its actual Penpot rendering, editability and source mapping are verified.

Desktop captures and mobile runtime limitations are recorded in `platform-notes.md`. `state-candidates.json` carries 118 historical web/desktop parity-state candidates; all require current-source review and Penpot verification.

Use `--rich` to write a separate `populated/` fixture capture with five peer accounts/direct messages, image/file attachments and code content. Example: `xvfb-run -a node design/penpot/capture.mjs --rich --desktop`. All accounts/data are disposable. This is representative coverage, not yet every message/media state.

The web-reference set now includes 17 routes, including signed-out login, recovery and join. `live-recovery.json` and `live-recovery.svg` preserve live Penpot data while native export is unavailable; they are not approved or complete native backups.

The hosted file now has separate Coverage, Web, Desktop, Mobile and Shared components pages. `catalog-penpot.json` records their IDs. Coverage contains 63 editable source-index entries; these are documentation, not completed screen designs. The Desktop page has the populated screenshot as a clearly labeled raster reference. Hosted MCP image payloads require chunking to stay under its request-size limit.

Desktop captures now include `.svg` vector starting points and `.layers.json` geometry. These inherit extractor limitations (clipping, image content, typography and native text conversion); they are not automatically verified Penpot designs. The Add Instance desktop screen has a native-text/vector draft in Penpot; its board ID and pending review are recorded in `catalog-penpot.json`.

### Native mobile control evidence

Six Android dark-theme captures now cover onboarding, community home, text channel, empty pinned messages, empty search, and conversation notification preferences. `index-mobile-controls.py` extracts 33 observed controls from their UI hierarchies into `mobile-reference/controls.json`. The Mobile Penpot page contains an editable evidence index, not completed screen designs. Offscreen controls, additional states, light theme, and visual reconstruction remain pending.

### Web screen drafts

The Web Penpot page now has 17 editable default-state drafts from full-page captures of the current disposable fixture. `web-source-mappings.json` links each board to its source template. `web-live-verification.json` records live board dimensions and text counts; it does not prove visual fidelity or persisted export. Long settings forms retain their full captured height. The importer accepts `web` or `desktop`; `prepare-native-drafts.py` uses the same platform argument.

### Expanded web coverage and desktop OS surfaces

Web discovery now includes fixture channel links and the admin dashboard, bringing the current capture/draft set to 25 boards. Five are separate DM examples, so 25 is not a unique-screen count. The voice-room board is the pre-join state only. `recapture-web.mjs` reuses the local fixture; source links are refreshed by `map-web-drafts.py`. `desktop-os-surfaces.json` records tray, update dialog, display-source picker, and renderer update-state controls from source, with native references still pending.

### Sketchboard activity

`05 — Sketchboard` contains editable activity drafts. Fourteen runtime references cover the board list, populated list, Delete confirmation, nine selected drawing tools, Clear confirmation, and the horizontally scrolled trailing toolbar. `sketchboard-states.md` records behavior and remaining states. Canvas content, gradients, native input chrome, host/iframe alignment, and visual verification remain open. The fixture was restarted after its previous process exited; current Sketchboard captures use the fresh disposable instance.
