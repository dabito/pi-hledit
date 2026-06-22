# pi-hledit

Pi coding agent extension that provides hash-anchored file editing tools.

## Install

`pi-hledit` is the Pi extension. It wraps the separate [`hledit`](https://github.com/dabito/hledit) CLI binary, so install the CLI first.

```bash
# 1. Install the hledit CLI
go install github.com/dabito/hledit@latest

# 2. Make sure the binary is on PATH for pi
export PATH="$HOME/go/bin:$PATH"
hledit --version

# 3. Install the Pi extension
pi install git:github.com/dabito/pi-hledit
```

By default the extension looks for `~/.local/bin/hledit`. If your Go install puts it somewhere else, either add that directory to `PATH` or set `HLEDIT_BIN`:

```bash
export HLEDIT_BIN="$HOME/go/bin/hledit"
```

## What it does

Registers a single `hledit` tool for pi agents:

- **read** — read a file with LN#HASH anchors for stale-safe editing
- **edit** — replace, insert, or delete a single line by anchor
- **batch** — apply multiple edits atomically in one call
- **grep** — filter lines by substring to reduce token usage

## Requirements

- Go 1.21+ to install [`github.com/dabito/hledit`](https://github.com/dabito/hledit)
- `hledit` binary installed at `~/.local/bin/hledit`, on `PATH`, or configured with `HLEDIT_BIN`

## Why hash-anchored editing?

Traditional text-matching edits fail silently when the file changes between read and write. Hash anchors detect stale context before any write, preventing silent corruption.
