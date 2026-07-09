import type {
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { spawn } from "node:child_process";
import { Type, type Static } from "typebox";

const DEFAULT_HLEDIT_BIN = "hledit";

const HLEDIT_INSTALL_HINT = `Install the hledit CLI first:
  go install github.com/dabito/hledit@latest

Then make sure the binary is on PATH for pi, or set:
  export HLEDIT_BIN="$HOME/go/bin/hledit"

CLI repo: https://github.com/dabito/hledit`;

const EDIT_ACTIONS = ["replace", "insert", "delete", "replace-range"] as const;
const BATCH_OPS = ["replace", "delete", "insert"] as const;

export type EditAction = (typeof EDIT_ACTIONS)[number];
type BatchOp = (typeof BATCH_OPS)[number];

const VISUAL = {
  success: { fallback: "✓", nerd: "󰄬", theme: "success" },
  warning: { fallback: "◐", nerd: "", theme: "warning" },
  info: { fallback: "•", nerd: "󰋽", nerdCodepoint: "f02fd", theme: "accent" },
} as const;

type VisualState = keyof typeof VISUAL;

type ThemeLike = {
  fg: (name: never, text: string) => string;
};

function stateIcon(theme: ThemeLike, state: VisualState): string {
  const visual = VISUAL[state];
  return theme.fg(visual.theme as never, visual.nerd);
}

const BATCH_EDIT_SCHEMA = Type.Object({
  op: Type.Union([
    Type.Literal("replace"),
    Type.Literal("delete"),
    Type.Literal("insert"),
  ]),
  anchor: Type.String({ description: "LN#HASH anchor, e.g. 12#NKA" }),
  end_anchor: Type.Optional(
    Type.String({ description: "End anchor for replace/delete range" }),
  ),
  lines: Type.Optional(
    Type.Array(Type.String(), { description: "Replacement/inserted lines" }),
  ),
  after: Type.Optional(
    Type.Boolean({ description: "Not supported for batch; use op:'edit'" }),
  ),
});
const HLEDIT_PARAMS_SCHEMA = Type.Object({
  op: Type.Union([Type.Literal("read"), Type.Literal("edit"), Type.Literal("batch")], {
    description: "Operation: 'read', 'edit', or 'batch'",
  }),
  path: Type.String({ description: "File path" }),
  // Read params
  offset: Type.Optional(
    Type.Number({ description: "1-indexed starting line" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Max lines to return" })),
  grep: Type.Optional(
    Type.String({ description: "Filter lines by substring" }),
  ),
  // Edit params
  action: Type.Optional(
    Type.Union(
      [
        Type.Literal("replace"),
        Type.Literal("insert"),
        Type.Literal("delete"),
        Type.Literal("replace-range"),
      ],
      {
        description:
          "Edit action: replace, insert, delete, or replace-range. Defaults to replace unless end_anchor or after imply legacy behavior.",
      },
    ),
  ),
  anchor: Type.Optional(
    Type.String({ description: "LN#HASH anchor, e.g. 12#NKA" }),
  ),
  end_anchor: Type.Optional(
    Type.String({ description: "End anchor for replace-range/delete range" }),
  ),
  content: Type.Optional(
    Type.String({ description: "Replacement or inserted content; empty = delete" }),
  ),
  after: Type.Optional(
    Type.Boolean({ description: "For action:'insert', insert after anchor" }),
  ),
  // Batch params — preferred structured array, legacy JSON string also supported.
  edits: Type.Optional(
    Type.Union([
      Type.Array(BATCH_EDIT_SCHEMA, {
        description: "Preferred structured batch edit ops",
      }),
      Type.String({
        description: "Legacy JSON array string of batch edit ops",
      }),
    ]),
  ),
});

type HleditParams = Static<typeof HLEDIT_PARAMS_SCHEMA>;

type HleditRun = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};
type DiffLineKind = "context" | "added" | "removed" | "omitted";

type DiffLine = {
  kind: DiffLineKind;
  text: string;
};

type HleditDiff = {
  lines: DiffLine[];
};

type ChangeMetadata = {
  firstChangedLine: number;
  lastChangedLine: number;
  linesAdded: number;
  linesDeleted: number;
};

const DIFF_CONTEXT_LINES = 2;
const MAX_DIFF_LINES = 80;
const MAX_DIFF_CELL_COUNT = 40_000;

type CliBatchEdit = {
  op: BatchOp;
  pos: string;
  end_pos?: string;
  lines: string[];
};

type CliBatchRequest = {
  edits: CliBatchEdit[];
};

export type BatchTranslationResult =
  | { ok: true; request: CliBatchRequest; json: string }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBatchOp(value: unknown): value is BatchOp {
  return typeof value === "string" && BATCH_OPS.includes(value as BatchOp);
}

function isEditAction(value: unknown): value is EditAction {
  return typeof value === "string" && EDIT_ACTIONS.includes(value as EditAction);
}

function errorResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: { ok: false },
    isError: true,
  };
}

export function resolveHleditBin(env: NodeJS.ProcessEnv = process.env): string {
  return env.HLEDIT_BIN || DEFAULT_HLEDIT_BIN;
}

async function runHledit(
  args: string[],
  stdin: string | undefined,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined = ctx.signal,
): Promise<HleditRun> {
  const bin = resolveHleditBin();
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: ctx.cwd,
      signal,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) =>
      resolve({
        stdout: `failed to run ${bin}: ${err.message}\n\n${HLEDIT_INSTALL_HINT}`,
        stderr,
        exitCode: 1,
      }),
    );
    child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
    child.stdin.end(stdin ?? "");
  });
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
async function readTextSnapshot(filePath: string, ctx: ExtensionContext): Promise<string | undefined> {
  try {
    const text = await readFile(resolvePath(ctx.cwd, filePath), "utf8");
    return text.includes("\0") ? undefined : text;
  } catch {
    return undefined;
  }
}

function splitSnapshotLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function changeMetadata(run: HleditRun): ChangeMetadata | undefined {
  if (run.exitCode !== 0) {
    return undefined;
  }
  const parsed = parseJsonObject(run.stdout.trimEnd());
  if (!parsed) {
    return undefined;
  }
  const { firstChangedLine, lastChangedLine, linesAdded, linesDeleted } = parsed;
  if (
    typeof firstChangedLine !== "number" ||
    typeof lastChangedLine !== "number" ||
    typeof linesAdded !== "number" ||
    typeof linesDeleted !== "number"
  ) {
    return undefined;
  }
  return { firstChangedLine, lastChangedLine, linesAdded, linesDeleted };
}

function lcsDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  if (oldLines.length * newLines.length > MAX_DIFF_CELL_COUNT) {
    return [
      {
        kind: "omitted",
        text: `... diff omitted: changed window too large (${oldLines.length} old lines, ${newLines.length} new lines) ...`,
      },
    ];
  }

  const dp = Array.from({ length: oldLines.length + 1 }, () =>
    Array<number>(newLines.length + 1).fill(0),
  );
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      dp[i]![j] = oldLines[i] === newLines[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const diff: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      diff.push({ kind: "context", text: oldLines[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      diff.push({ kind: "removed", text: oldLines[i]! });
      i++;
    } else {
      diff.push({ kind: "added", text: newLines[j]! });
      j++;
    }
  }
  while (i < oldLines.length) {
    diff.push({ kind: "removed", text: oldLines[i]! });
    i++;
  }
  while (j < newLines.length) {
    diff.push({ kind: "added", text: newLines[j]! });
    j++;
  }
  return diff;
}

function capDiffLines(lines: DiffLine[]): DiffLine[] {
  if (lines.length <= MAX_DIFF_LINES) {
    return lines;
  }
  const headCount = Math.floor(MAX_DIFF_LINES / 2);
  const tailCount = MAX_DIFF_LINES - headCount;
  return [
    ...lines.slice(0, headCount),
    { kind: "omitted", text: `... (${lines.length - MAX_DIFF_LINES} diff lines omitted) ...` },
    ...lines.slice(lines.length - tailCount),
  ];
}

function buildDiff(beforeText: string, afterText: string, metadata: ChangeMetadata): HleditDiff | undefined {
  const beforeLines = splitSnapshotLines(beforeText);
  const afterLines = splitSnapshotLines(afterText);
  const first = Math.max(1, metadata.firstChangedLine);
  const last = Math.max(first, metadata.lastChangedLine);
  const netLineDelta = metadata.linesAdded - metadata.linesDeleted;
  const oldStart = Math.max(1, first - DIFF_CONTEXT_LINES);
  const oldEnd = Math.min(beforeLines.length, last + DIFF_CONTEXT_LINES);
  const newStart = Math.max(1, first - DIFF_CONTEXT_LINES);
  const newEnd = Math.min(afterLines.length, Math.max(first, last + netLineDelta) + DIFF_CONTEXT_LINES);
  const oldSegment = beforeLines.slice(oldStart - 1, oldEnd);
  const newSegment = afterLines.slice(newStart - 1, newEnd);

  if (oldSegment.join("\n") === newSegment.join("\n")) {
    return undefined;
  }
  const lines = capDiffLines(lcsDiff(oldSegment, newSegment));
  return lines.length > 0 ? { lines } : undefined;
}

async function diffForRun(
  beforeText: string | undefined,
  filePath: string,
  run: HleditRun,
  ctx: ExtensionContext,
): Promise<HleditDiff | undefined> {
  if (beforeText === undefined) {
    return undefined;
  }
  const metadata = changeMetadata(run);
  if (!metadata) {
    return undefined;
  }
  const afterText = await readTextSnapshot(filePath, ctx);
  return afterText === undefined ? undefined : buildDiff(beforeText, afterText, metadata);
}

function formatBatchResult(result: Record<string, unknown>): string {
  const lines: string[] = [];
  const ok = result.ok !== false;

  if (ok) {
    lines.push(result.checked === true ? "Batch check ok." : "Batch ok.");

    if (typeof result.editsApplied === "number") {
      lines.push(`Edits applied: ${result.editsApplied}`);
    }

    const firstChangedLine = result.firstChangedLine;
    const lastChangedLine = result.lastChangedLine;
    if (
      typeof firstChangedLine === "number" &&
      typeof lastChangedLine === "number"
    ) {
      lines.push(`Changed lines: ${firstChangedLine}-${lastChangedLine}`);
    } else if (typeof firstChangedLine === "number") {
      lines.push(`First changed line: ${firstChangedLine}`);
    } else if (typeof lastChangedLine === "number") {
      lines.push(`Last changed line: ${lastChangedLine}`);
    }

    const lineDelta = lineDeltaSummary(result);
    if (lineDelta) {
      lines.push(lineDelta);
    }

    return lines.join("\n");
  }

  lines.push("Batch failed.");
  if (typeof result.error === "string") {
    lines.push(`Error: ${result.error}`);
  }
  if (typeof result.message === "string" && result.message !== result.error) {
    lines.push(`Message: ${result.message}`);
  }
  if (typeof result.failed === "number") {
    lines.push(`Failed edit: ${result.failed}`);
  }

  if (Array.isArray(result.remaps) && result.remaps.length > 0) {
    lines.push("Remaps:");
    for (const remap of result.remaps) {
      if (!isRecord(remap)) continue;
      const requested =
        typeof remap.Requested === "string"
          ? remap.Requested
          : typeof remap.requested === "string"
            ? remap.requested
            : undefined;
      const current =
        typeof remap.Current === "string"
          ? remap.Current
          : typeof remap.current === "string"
            ? remap.current
            : undefined;
      if (requested && current) {
        lines.push(`- ${requested} -> ${current}`);
      } else if (requested) {
        lines.push(`- ${requested}`);
      }
    }
  }

  return lines.join("\n");
}

function formatRunText(
  run: HleditRun,
  kind: HleditParams["op"] | undefined,
): string {
  const text = run.stdout.trimEnd() || run.stderr.trimEnd();

  if (run.exitCode !== 0) {
    return text || HLEDIT_INSTALL_HINT;
  }

  if (!text) {
    if (kind === "batch") {
      return "Batch ok.";
    }
    if (kind === "edit") {
      return "Edit ok.";
    }
    if (kind === "read") {
      return "Read ok.";
    }
    return "Done.";
  }

  const parsed = parseJsonObject(text);
  if (!parsed) {
    return text;
  }

  if ("editsApplied" in parsed || "failed" in parsed || "message" in parsed) {
    return formatBatchResult(parsed);
  }

  return text;
}

// HleditComponent renders pre-styled lines with ANSI-safe width truncation.
// Literal tabs render as terminal jumps and can leave unpainted gaps inside Pi's
// tool box background, so expand them for display before truncating. Model-facing
// tool content and file bytes stay unchanged. Caches by width and reuses via
// context.lastComponent per the Pi CachedComponent pattern.
class HleditComponent implements Component {
  private lines: string[] = [];
  private cachedWidth?: number;
  private cachedOutput?: string[];

  constructor(lines: string[] = []) {
    this.lines = lines;
  }

  setLines(lines: string[]): void {
    this.lines = lines;
    this.cachedWidth = undefined;
    this.cachedOutput = undefined;
  }

  render(width: number): string[] {
    if (this.cachedOutput && this.cachedWidth === width) {
      return this.cachedOutput;
    }
    this.cachedOutput = this.lines.map((line) =>
      truncateToWidth(line.replace(/\t/g, "   "), width, "…"),
    );
    this.cachedWidth = width;
    return this.cachedOutput;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedOutput = undefined;
  }
}

function reuseHleditComponent(context: { lastComponent?: unknown }): HleditComponent {
  return context.lastComponent instanceof HleditComponent
    ? context.lastComponent
    : new HleditComponent();
}

function setHleditComponent(
  context: { lastComponent?: unknown },
  lines: string[],
): HleditComponent {
  const component = reuseHleditComponent(context);
  component.setLines(lines);
  return component;
}

function lineFromAnchor(anchor: unknown): number | undefined {
  if (typeof anchor !== "string") {
    return undefined;
  }
  const match = anchor.match(/^(\d+)#/);
  return match ? Number(match[1]) : undefined;
}

function formatLineRange(first: number | undefined, last: number | undefined): string | undefined {
  if (first === undefined && last === undefined) {
    return undefined;
  }
  const start = first ?? last;
  const end = last ?? first;
  return start === end ? String(start) : `${start}-${end}`;
}

function batchLineRange(editsInput: unknown): string | undefined {
  let edits: unknown[] | undefined;
  if (Array.isArray(editsInput)) {
    edits = editsInput;
  } else if (typeof editsInput === "string") {
    const parsed = parseJsonObject(`{"edits":${editsInput}}`);
    edits = Array.isArray(parsed?.edits) ? parsed.edits : undefined;
  }
  if (!edits) {
    return undefined;
  }

  const lines = edits
    .filter(isRecord)
    .flatMap((edit) => [lineFromAnchor(edit.anchor), lineFromAnchor(edit.end_anchor)])
    .filter((line): line is number => line !== undefined);
  if (lines.length === 0) {
    return undefined;
  }

  return formatLineRange(Math.min(...lines), Math.max(...lines));
}

function changedLineSummary(parsed: Record<string, unknown>): string | undefined {
  const firstChangedLine = parsed.firstChangedLine;
  const lastChangedLine = parsed.lastChangedLine;
  if (typeof firstChangedLine !== "number" && typeof lastChangedLine !== "number") {
    return undefined;
  }

  const range = formatLineRange(
    typeof firstChangedLine === "number" ? firstChangedLine : undefined,
    typeof lastChangedLine === "number" ? lastChangedLine : undefined,
  );
  return range?.includes("-") ? `Changed lines: ${range}` : `Changed line: ${range}`;
}

function lineDeltaSummary(parsed: Record<string, unknown>): string | undefined {
  const linesAdded = parsed.linesAdded;
  const linesDeleted = parsed.linesDeleted;
  if (typeof linesAdded !== "number" && typeof linesDeleted !== "number") {
    return undefined;
  }
  const added = typeof linesAdded === "number" ? linesAdded : 0;
  const deleted = typeof linesDeleted === "number" ? linesDeleted : 0;
  return `Lines: +${added} -${deleted}`;
}

function foldedErrorLine(text: string): string {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const first = lines[0] ?? "Failed.";
  const error = lines.find((line) => line.startsWith("Error:"));
  if (error) {
    return `${first} ${error.replace(/^Error:\s*/, "")}`;
  }
  return first;
}

function diffFromDetails(details: Record<string, unknown>): DiffLine[] | undefined {
  const diff = details.diff;
  if (!isRecord(diff) || !Array.isArray(diff.lines)) {
    return undefined;
  }
  const lines = diff.lines.filter((line): line is DiffLine => {
    if (!isRecord(line)) {
      return false;
    }
    return (
      (line.kind === "context" ||
        line.kind === "added" ||
        line.kind === "removed" ||
        line.kind === "omitted") &&
      typeof line.text === "string"
    );
  });
  return lines.length > 0 ? lines : undefined;
}

function renderDiffLines(theme: ThemeLike, lines: DiffLine[] | undefined): string[] {
  if (!lines) {
    return [];
  }
  return lines.map((line) => {
    if (line.kind === "added") {
      return theme.fg("toolDiffAdded" as never, `+ ${line.text}`);
    }
    if (line.kind === "removed") {
      return theme.fg("toolDiffRemoved" as never, `- ${line.text}`);
    }
    if (line.kind === "omitted") {
      return theme.fg("toolDiffContext" as never, line.text);
    }
    return theme.fg("toolDiffContext" as never, `  ${line.text}`);
  });
}

function textResult(
  run: HleditRun,
  kind: HleditParams["op"] | undefined,
  details: Record<string, unknown> = {},
) {
  const text = formatRunText(run, kind);
  return {
    content: [{ type: "text" as const, text }],
    details: { ok: run.exitCode === 0, ...details },
    isError: run.exitCode !== 0,
  };
}

function toNum(v: number | undefined): number | undefined {
  return v !== undefined && v >= 0 ? v : undefined;
}

function hasAnchorShape(anchor: string): boolean {
  return /^\d+#[A-Za-z0-9]+$/.test(anchor);
}

export function buildReadArgs(params: HleditParams): string[] {
  const offset = toNum(params.offset);
  const limit = toNum(params.limit);
  const grep = params.grep || undefined;

  const args = [
    "read-range",
    params.path,
    "--offset",
    String(offset ?? 1),
    "--limit",
    String(limit ?? 2000),
  ];

  if (grep) {
    args.push("--grep", grep);
  }

  return args;
}

export function getEditAction(params: HleditParams): EditAction {
  if (params.action !== undefined) {
    if (!isEditAction(params.action)) {
      throw new Error(
        "invalid action. Must be: replace, insert, delete, or replace-range.",
      );
    }
    return params.action;
  }

  if (params.end_anchor) {
    return "replace-range";
  }

  if (params.after) {
    return "insert";
  }

  return "replace";
}

export function buildEditRequest(params: HleditParams):
  | { ok: true; args: string[]; stdin: string }
  | { ok: false; error: string } {
  const anchor = params.anchor;
  if (!anchor) {
    return { ok: false, error: "missing 'anchor' param for op:'edit'" };
  }

  let action: EditAction;
  try {
    action = getEditAction(params);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const content = action === "delete" ? "" : (params.content ?? "");
  const endAnchor = params.end_anchor || undefined;

  if ((action === "replace-range" || action === "delete") && endAnchor) {
    return {
      ok: true,
      args: ["replace-range", params.path, anchor, endAnchor, "-"],
      stdin: content,
    };
  }

  if (action === "replace-range") {
    return { ok: false, error: "action:'replace-range' requires end_anchor" };
  }

  if (action === "insert") {
    const args = params.after
      ? ["insert", "--after", params.path, anchor, "-"]
      : ["insert", params.path, anchor, "-"];
    return { ok: true, args, stdin: content };
  }

  return { ok: true, args: ["replace", params.path, anchor, "-"], stdin: content };
}

export function translateBatchEdits(editsInput: unknown): BatchTranslationResult {
  let parsed: unknown;
  if (typeof editsInput === "string") {
    try {
      parsed = JSON.parse(editsInput) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: `invalid JSON in legacy edits string: ${message}. Prefer structured edits array. If using a JSON string, Escape control characters: use \\t for tabs, \\n for newlines. Each line in the 'lines' array must be a separate string element. Or use op:'edit' for single changes.`,
      };
    }
  } else {
    parsed = editsInput;
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: "edits must be an array or legacy JSON array string" };
  }

  const edits: CliBatchEdit[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const edit = parsed[i];
    if (!isRecord(edit)) {
      return { ok: false, error: `edit ${i} must be an object` };
    }

    const { op, anchor, end_anchor: endAnchor, lines, after } = edit;

    if (!isBatchOp(op)) {
      return {
        ok: false,
        error: `edit ${i} has invalid op. Must be: replace, delete, or insert`,
      };
    }

    if (typeof anchor !== "string" || !hasAnchorShape(anchor)) {
      return {
        ok: false,
        error: `edit ${i} requires anchor in LN#HASH format`,
      };
    }

    if (endAnchor !== undefined && typeof endAnchor !== "string") {
      return { ok: false, error: `edit ${i} end_anchor must be a string` };
    }

    if (endAnchor !== undefined && !hasAnchorShape(endAnchor)) {
      return {
        ok: false,
        error: `edit ${i} end_anchor must use LN#HASH format`,
      };
    }

    if (after !== undefined) {
      return {
        ok: false,
        error: `edit ${i} uses after, but batch insert-after is not supported by hledit CLI`,
      };
    }

    if (lines !== undefined && !Array.isArray(lines)) {
      return { ok: false, error: `edit ${i} lines must be an array of strings` };
    }

    if (
      Array.isArray(lines) &&
      !lines.every((line) => typeof line === "string")
    ) {
      return { ok: false, error: `edit ${i} lines must contain only strings` };
    }

    edits.push({
      op,
      pos: anchor,
      ...(endAnchor ? { end_pos: endAnchor } : {}),
      lines: Array.isArray(lines) ? lines : [],
    });
  }

  const request = { edits };
  return { ok: true, request, json: JSON.stringify(request) };
}

export default function piHleditExtension(pi: ExtensionAPI) {
  // ── Single hledit tool: read, edit, batch ──────────────────────────────
  pi.registerTool({
    name: "hledit",
    label: "Hashline Edit",
    description:
      "Read, edit, or batch-edit files using hash-anchored line references (LN#HASH). " +
      "Use op:'read' to get anchors, op:'edit' for single changes, op:'batch' for multiple edits in one call. " +
      "Anchors come from the most recent read and detect stale context before any write.",
    promptSnippet:
      "Read/edit files with stale-safe hash-anchored line references",
    promptGuidelines: [
      "ALWAYS use hledit instead of the built-in edit tool. Hash anchors detect stale context; text matching does not.",
      "Workflow: hledit read → get anchors → hledit edit (single) or hledit batch (multiple).",
      "Use op:'edit' with action:'replace'|'insert'|'delete'|'replace-range'. For insert-before: action:'insert'. For insert-after: action:'insert', after:true.",
      "For op:'batch', prefer edits as a structured array of objects using anchor/end_anchor; legacy JSON string is still supported.",
      "If edit returns stale, re-read the file to get fresh anchors before retrying.",
      "Use grep param to filter lines and reduce token usage: {op:'read', path, grep:'func '}",
    ],
    renderCall(args, theme, context) {
      const input = isRecord(args) ? (args as Record<string, unknown>) : {};
      const op = typeof input.op === "string" ? input.op : "hledit";
      const path = typeof input.path === "string" ? input.path : undefined;
      const offset = typeof input.offset === "number" && input.offset > 0 ? input.offset : undefined;
      const limit = typeof input.limit === "number" && input.limit > 0 ? input.limit : undefined;
      const anchorLine = lineFromAnchor(input.anchor);
      const endLine = lineFromAnchor(input.end_anchor);
      const batchRange = batchLineRange(input.edits);
      const range =
        op === "read"
          ? formatLineRange(offset ?? 1, (offset ?? 1) + (limit ?? 2000) - 1)
          : op === "edit"
            ? formatLineRange(anchorLine, endLine ?? anchorLine)
            : op === "batch"
              ? batchRange
              : undefined;
      const title = theme.fg("toolTitle", theme.bold(`hledit ${op}:`));
      const targetText = path
        ? theme.fg("accent", path) + (range ? theme.fg("warning", `:${range}`) : "")
        : "";

      return setHleditComponent(context, [targetText ? `${title} ${targetText}` : title]);
    },
    renderResult(result, _options, theme, context) {
      const input = isRecord(context.args)
        ? (context.args as Record<string, unknown>)
        : {};
      const op = typeof input.op === "string" ? input.op : undefined;
      const first = Array.isArray(result.content)
        ? (result.content[0] as { text?: unknown } | undefined)
        : undefined;
      const text = typeof first?.text === "string" ? first.text : "";
      const details = isRecord(result.details)
        ? (result.details as Record<string, unknown>)
        : {};
      const failureText =
        text.startsWith("Batch failed.") ||
        text.startsWith("Error:") ||
        text.startsWith("invalid ") ||
        text.startsWith("Edit failed.") ||
        text.startsWith("Read failed.");
      const isError =
        (result as { isError?: boolean }).isError === true ||
        details.ok === false ||
        failureText;
      const lines = text ? text.split(/\r?\n/) : [];
      const warningIcon = stateIcon(theme, "warning");
      const infoIcon = stateIcon(theme, "info");
      const successIcon = stateIcon(theme, "success");
      const diffLines = renderDiffLines(theme, diffFromDetails(details));

      if (isError) {
        return setHleditComponent(context, [`${warningIcon} ${foldedErrorLine(text)}`]);
      }

      if (op === "read" && lines.length > 20) {
        return setHleditComponent(context, [
          `${infoIcon} Read folded: ${lines.length} lines`,
          lines[0] ?? "",
          `... (${lines.length - 2} lines) ...`,
          lines[lines.length - 1] ?? "",
        ]);
      }

      if (op === "read") {
        return setHleditComponent(context, lines.length > 0 ? lines : ["Read ok."]);
      }

      const parsed = parseJsonObject(text);
      if (op === "edit" && parsed) {
        const changed = changedLineSummary(parsed);
        const lineDelta = lineDeltaSummary(parsed);
        return setHleditComponent(context, [
          `${successIcon} Edit ok.${changed ? ` ${changed}` : ""}${lineDelta ? ` ${lineDelta}` : ""}`,
          ...diffLines,
        ]);
      }

      if (op === "batch") {
        if (parsed) {
          const changed = changedLineSummary(parsed);
          const lineDelta = lineDeltaSummary(parsed);
          const editsApplied = parsed.editsApplied;
          const bits = ["Batch ok."];
          if (typeof editsApplied === "number") {
            bits.push(`Edits applied: ${editsApplied}.`);
          }
          if (changed) {
            bits.push(changed.endsWith(".") ? changed : `${changed}.`);
          }
          if (lineDelta) {
            bits.push(lineDelta.endsWith(".") ? lineDelta : `${lineDelta}.`);
          }
          return setHleditComponent(context, [`${successIcon} ${bits.join(" ")}`, ...diffLines]);
        }

        const compact = lines
          .filter(Boolean)
          .map((line) => (line.endsWith(".") ? line : `${line}.`))
          .join(" ");
        return setHleditComponent(context, [`${successIcon} ${compact || "Batch ok."}`, ...diffLines]);
      }

      const outputLines = lines.length > 0 ? [...lines] : [text || "Done."];
      outputLines[0] = `${successIcon} ${outputLines[0]}`;
      return setHleditComponent(context, [...outputLines, ...diffLines]);
    },
    parameters: HLEDIT_PARAMS_SCHEMA,
    async execute(
      _toolCallId: string,
      params: HleditParams,
      signal: AbortSignal | undefined,
      _onUpdate: AgentToolUpdateCallback<unknown> | undefined,
      ctx: ExtensionContext,
    ) {
      const { op, path } = params;

      if (op === "read") {
        return textResult(
          await runHledit(buildReadArgs(params), undefined, ctx, signal),
          op,
        );
      }

      if (op === "edit") {
        const request = buildEditRequest(params);
        if (!request.ok) {
          return errorResult(request.error);
        }
        const beforeText = await readTextSnapshot(path, ctx);
        const run = await runHledit(request.args, request.stdin, ctx, signal);
        const diff = await diffForRun(beforeText, path, run, ctx);
        return textResult(run, op, diff ? { diff } : {});
      }

      if (op === "batch") {
        const edits = params.edits;
        if (!edits) {
          return errorResult("missing 'edits' param for op:'batch'");
        }

        const translation = translateBatchEdits(edits);
        if (!translation.ok) {
          return errorResult(translation.error);
        }

        const beforeText = await readTextSnapshot(path, ctx);
        const run = await runHledit(["batch", path], translation.json, ctx, signal);
        const diff = await diffForRun(beforeText, path, run, ctx);
        return textResult(run, op, diff ? { diff } : {});
      }

      return errorResult("unknown op. Must be: read, edit, or batch");
    },
  });

  // ── Status command ─────────────────────────────────────────────────────
  pi.registerCommand("hledit-status", {
    description: "Check the configured hledit binary",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const run = await runHledit(["help"], undefined, ctx);
      const bin = resolveHleditBin();
      if (run.exitCode === 0) {
        ctx.ui.notify(`hledit ready: ${bin}`, "info");
      } else {
        ctx.ui.notify(`hledit failed: ${bin}\n\n${HLEDIT_INSTALL_HINT}`, "error");
      }
    },
  });
}
