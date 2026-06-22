# Changelog

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
