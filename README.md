# pi-hledit

Pi coding agent extension that provides hash-anchored file editing tools.

## Install

```bash
pi install git:github.com/dabito/pi-hledit
```

## What it does

Registers a single `hledit` tool for pi agents:

- **read** — read a file with LN#HASH anchors for stale-safe editing
- **edit** — replace, insert, or delete a single line by anchor
- **batch** — apply multiple edits atomically in one call
- **grep** — filter lines by substring to reduce token usage

## Requirements

- `hledit` binary installed and on PATH (or set `HLEDIT_BIN` env var)
- Install hledit: `go install github.com/dabito/hledit@latest`

## Why hash-anchored editing?

Traditional text-matching edits fail silently when the file changes between read and write. Hash anchors detect stale context before any write, preventing silent corruption.
