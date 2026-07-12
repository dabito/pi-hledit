# Changelog

## [1.1.7] — 2026-07-11

### Documentation

- Fix stale limitations note now that `context` is exposed for grep reads.

## [1.1.6] — 2026-07-11

### Added

- Add `context` read parameter for contextual grep; defaults to `2` when `grep` is set, with `context:0` preserving match-only output.
- Add roadmap tracking for anchored repo-wide find, peek/read-around-anchor, match controls, and variable/adaptive hash config.

## [1.1.5] — 2026-07-11

### Added

- Show active native diff renderer settings in `/hledit-status`.
## [1.1.4] — 2026-07-09

### Documentation

- Add `pi.image` gallery metadata so the demo screenshot appears on pi.dev package listings.
## [1.1.3] — 2026-07-09

### Documentation

- Include the Pi native diff demo screenshot in the published package.
## [1.1.2] — 2026-07-09

### Changed

- Render `hledit` edit/batch diffs through Pi's native `renderDiff` UI while preserving snapshot/cap/env behavior.
## [1.1.1] — 2026-07-09

### Added

- Add `PI_HLEDIT_DIFF_MAX_LINES`, `PI_HLEDIT_DIFF_CONTEXT`, and `PI_HLEDIT_DIFF_MAX_CELLS` environment variables for TUI diff rendering.
## [1.1.0] — 2026-07-09

### Added

- Render UI-only diffs for successful `edit` and `batch` calls while keeping model-facing tool output compact and metadata-only.
## [1.0.21] — 2026-07-09

### Documentation

- Clarify that `hledit >= 1.2.4` is required only for line delta summaries; older versions still work without that summary.

## [1.0.20] — 2026-07-09

### Documentation

- Note that line delta summaries require `hledit >= 1.2.4`; older `hledit` versions still work without that summary.
## [1.0.19] — 2026-07-09

### Fixed

- Expand literal tabs in TUI-rendered lines before truncation to avoid unpainted gaps in Pi tool backgrounds for wide tab-heavy source lines.
## [1.0.18] — 2026-07-09

### Changed

- Replace ad-hoc render components with a cached Pi `Component` implementation using `context.lastComponent` reuse and ANSI-safe width truncation.
## [1.0.17] — 2026-07-09

### Changed

- Add preferred structured `edits` array support for batch calls while preserving the legacy JSON string form.
## [1.0.16] — 2026-07-08

### Changed

- Update docs and schema examples to use `hledit` 1.3.0-style 3-character anchors.
## [1.0.15] — 2026-07-07

### Changed

- Show `Lines: +N -M` in edit and batch success summaries when `hledit` reports `linesAdded` and `linesDeleted`.

## [1.0.14] — 2026-07-03

### Fixed

- Read-output truncation now delegates to `@earendil-works/pi-tui`'s own width measurement instead of a local length-based reimplementation, fixing a crash ("Rendered line exceeds terminal width") on tab-heavy lines where visual width diverges from string length.

## [1.0.12] — 2026-07-02

### Changed

- Plain `{op:'read'}` (no `offset`/`limit`/`grep`) now always builds a bounded `read-range` request (`offset:1`, `limit:2000`) instead of an unbounded `hledit read`. Behavior is unchanged for files under the default limit; large files are now explicitly capped by the wrapper itself instead of relying on `hledit`'s own internal default.
- README: added Demo, Related packages, Behavior notes, Failure modes, Limitations, and Development sections; moved the Go-toolchain requirement ahead of the npm install step; softened the "preventing silent corruption" claim to describe the actual reject-and-retry behavior.

## [1.0.11] — 2026-07-02

### Changed

- Use Nerd Font codepoint `f02fd` for info/folded-read visual state.

## [1.0.10] — 2026-07-01

### Changed

- Standardize Pi TUI visual rendering behind named semantic state constants and helpers.
- Use one semantic success icon/color for edit and batch summaries.
- Tighten `op` and `action` schemas to literal unions for better host introspection.

## [1.0.9] — 2026-07-01

### Changed

- Render `hledit` tool calls/results with compact Pi TUI visuals matching built-in tool styling.
- Fold long read output with `nf-oct-fold`, colored as accent, while preserving full tool payload.
- Summarize edit and batch successes/errors with Nerd Font glyphs and concise changed-line ranges.

## [1.0.8] — 2026-07-01

### Fixed

- Improve batch `edits` JSON parse error message to mention escaping control characters (`\\t`, `\\n`) and suggest `op:'edit'` fallback.

## [1.0.7] — 2026-07-01

### Fixed

- Translate wrapper-friendly batch `edits` arrays with `anchor`/`end_anchor` into `hledit batch` CLI requests with `pos`/`end_pos`.
- Add explicit edit `action` support for `replace`, `insert`, `delete`, and `replace-range`, including insert-before and insert-after.
- Resolve `hledit` from `PATH` by default via `HLEDIT_BIN || "hledit"`.

### Added

- Add host-facing contract tests for registration, arg building, batch translation, and spawned CLI stdin.
- Add README parameter table, canonical examples, and package `bugs`/`homepage` metadata.

### Changed

- Use `go install github.com/dabito/hledit@latest` in install docs and missing-CLI hints instead of pinning an older CLI tag.
- Keep validation errors concise and move long examples into README.

## [1.0.6] — 2026-06-30

### Changed

- Add committed TypeScript and ESLint verification configs so `npx tsc --noEmit` and `npx eslint . --ext .ts` work from the package root.
- Type tool and command handler contexts explicitly and validate parsed batch edit JSON through typed guards.
- Add package scripts for typecheck, lint, and formatting.

## [1.0.3] — 2026-06-22

### Changed

- Update install docs to pin `hledit` CLI v1.0.2, which restores the `-` content-source contract and improves content-source error messages.

## [1.0.2] — 2026-06-22

### Changed

- Update install docs to pin `hledit` CLI v1.0.1, which fixes empty-string replacement/deletion from the CLI.

## [1.0.1] — 2026-06-22

### Changed

- Improve Pi/npm package discoverability for searches like "hashline edit" by adding Hashline-focused description and keywords.

## [1.0.0] — 2026-06-22

### Changed

- Promote `pi-hledit` to stable 1.0.0 package release.
- Align install docs with stable `hledit` CLI v1.0.0 and `pi-hledit` v1.0.0 tags.

## [0.1.3] — 2026-06-22

### Changed

- Clarify end-user install flow with pinned Pi package tag, `/reload`, and `/hledit-status` verification.

## [0.1.2] — 2026-06-22

### Changed

- Align package metadata with `pi-package-template`: repository, files, publish config, and typecheck scripts.
- Add package `LICENSE` and `CHANGELOG.md` files.

## [0.1.1] — 2026-06-22

### Changed

- Document the required `hledit` CLI install path and `HLEDIT_BIN` override.
- Show CLI installation hints when the extension cannot run `hledit`.

## [0.1.0] — 2026-06-22

### Added

- Initial Pi extension release.
- Registers a single `hledit` tool with `read`, `edit`, and `batch` operations.
- Wraps the [`hledit`](https://github.com/dabito/hledit) CLI for hash-anchored, stale-safe file edits.
