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

Make sure `hledit` is on `PATH` for pi, or set `HLEDIT_BIN`:

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

By default the extension runs `hledit` from `PATH`. If pi cannot find it, set `HLEDIT_BIN` before starting pi.

## What it does

Registers a single `hledit` tool for pi agents:

- **read** — read a file with LN#HASH anchors for stale-safe editing
- **edit** — replace, insert, delete, or replace a range by anchor
- **batch** — apply multiple edits atomically in one call
- **grep** — filter lines by substring to reduce token usage

## Tool parameters

| Param | Ops | Description |
|---|---|---|
| `op` | all | `read`, `edit`, or `batch` |
| `path` | all | File path, resolved from pi cwd |
| `offset` | read | 1-indexed start line for ranged reads; default `1` when ranged |
| `limit` | read | Max lines for ranged reads; default `2000` when ranged |
| `grep` | read | Substring filter for read output; still line-capped, not byte-capped |
| `action` | edit | `replace`, `insert`, `delete`, or `replace-range`; default `replace` unless `end_anchor`/legacy `after` imply otherwise |
| `anchor` | edit/batch | Start LN#HASH anchor from latest `read` |
| `end_anchor` | edit/batch | End LN#HASH anchor for range replace/delete |
| `content` | edit | Replacement/inserted content; delete uses empty stdin |
| `after` | edit | With `action:'insert'`, insert after anchor; omitted means insert before |
| `edits` | batch | JSON array of batch edits using `op`, `anchor`, optional `end_anchor`, and `lines` |

`hledit` CLI has a `--context` option for some reads. This wrapper currently exposes `offset`, `limit`, and `grep`, not `--context`.

## Examples

Read anchors:

```json
{ "op": "read", "path": "src/file.ts", "offset": 1, "limit": 80 }
```

Replace one line:

```json
{ "op": "edit", "path": "src/file.ts", "action": "replace", "anchor": "12#NK", "content": "const ok = true;" }
```

Insert before or after an anchor:

```json
{ "op": "edit", "path": "src/file.ts", "action": "insert", "anchor": "12#NK", "content": "const added = true;" }
```

```json
{ "op": "edit", "path": "src/file.ts", "action": "insert", "anchor": "12#NK", "after": true, "content": "const added = true;" }
```

Delete a line:

```json
{ "op": "edit", "path": "src/file.ts", "action": "delete", "anchor": "12#NK" }
```

Replace a range:

```json
{ "op": "edit", "path": "src/file.ts", "action": "replace-range", "anchor": "12#NK", "end_anchor": "18#VR", "content": "new block" }
```

Batch edits use wrapper-friendly fields. `pi-hledit` translates them to the CLI-native `{"edits":[{"pos":"..."}]}` request before spawning `hledit batch`.

```json
{
  "op": "batch",
  "path": "src/file.ts",
  "edits": "[{\"op\":\"replace\",\"anchor\":\"12#NK\",\"lines\":[\"const ok = true;\"]},{\"op\":\"delete\",\"anchor\":\"20#AB\",\"end_anchor\":\"22#CD\",\"lines\":[]},{\"op\":\"insert\",\"anchor\":\"30#EF\",\"lines\":[\"const added = true;\"]}]"
}
```

Batch insert is insert-before only because the current `hledit batch` CLI has no insert-after field.

## Why hash-anchored editing?

Traditional text-matching edits fail silently when the file changes between read and write. Hash anchors detect stale context before any write, preventing silent corruption.
