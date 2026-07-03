# Changelog

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
