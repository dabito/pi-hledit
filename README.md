# pi-hledit

Hashline edit support for Pi: `hledit` hash-anchored file editing tools for AI coding agents.

## Install

```bash
pi install npm:pi-hledit
```

Then reload or restart pi:

```text
/reload
```

### Requirements

- [hledit CLI](https://github.com/dabito/hledit) — install the CLI first:

```bash
go install github.com/dabito/hledit@latest
```

Make sure the binary is on your `PATH` or set `HLEDIT_BIN`:

```bash
export HLEDIT_BIN="$HOME/go/bin/hledit"
```

### Alternative: install from git

```bash
pi install git:github.com/dabito/pi-hledit
```

### Verify

```text
/hledit-status
```

By default the extension looks for `~/.local/bin/hledit`. If your Go install puts it somewhere else, either keep `$HOME/go/bin` on `PATH` for pi or set `HLEDIT_BIN` before starting pi.

## What it does

Registers a single `hledit` tool for pi agents:

- **read** — read a file with LN#HASH anchors for stale-safe editing
- **edit** — replace, insert, or delete a single line by anchor
- **batch** — apply multiple edits atomically in one call
- **grep** — filter lines by substring to reduce token usage

## Why hash-anchored editing?

Traditional text-matching edits fail silently when the file changes between read and write. Hash anchors detect stale context before any write, preventing silent corruption.
