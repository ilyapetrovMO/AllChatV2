# Milestone 39 — Minimum-window camera-on states

Three editable static 960×640 views cover landscape video, portrait video, and the camera-started status at the bottom of Voice & Video settings. Local source JSX/CSS fixtures with synthetic canvas streams establish preview geometry, content heights and maximum scroll positions. No camera hardware was accessed. Native color bars are arbitrary video fixtures, not product UI.

Landscape fills the 542×304.875px preview. Portrait content is 180×320px, centered inside a 542×320px preview. The camera device selector, Stop Video button and subsequent sections move down by the measured height change. The bottom view includes Camera preview started. Content heights are 1924.78125px and 1939.90625px; maximum scroll positions are 1469px and 1484px.

All three native SVG/PNG designs were visually reviewed against source captures. Checks cover dimensions, video containment, centered button text, absence of stale camera-off copy, visible controls/notice and zero interactions. Penpot file validation returns no issues. Named save and independent confirmation are included. No prototype or production changes.

Reconstruction: restore included milestones 29 and 37 and their prerequisites, run author-minimum-camera.js on Desktop — Main, then check-minimum-camera.js and inspect exported SVG/PNG. Scripts require the repository MCP SDK and renderer helpers; measurement uses the milestone 37 source fixture and milestone 03 font setup.

This is a reconstruction backup, not a native .penpot export or a verified reimport. Named/long/empty device fixtures, full runtime/native-control/header/font fidelity, and broader desktop design coverage remain open.
