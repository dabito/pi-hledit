# Changelog

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
