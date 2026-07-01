import type {
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
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

const HLEDIT_PARAMS_SCHEMA = Type.Object({
  op: Type.String({
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
    Type.String({
      description:
        "Edit action: replace, insert, delete, or replace-range. Defaults to replace unless end_anchor or after imply legacy behavior.",
    }),
  ),
  anchor: Type.Optional(
    Type.String({ description: "LN#HASH anchor, e.g. 12#NK" }),
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
  // Batch params — JSON array of wrapper ops. Translated to CLI-native JSON.
  edits: Type.Optional(
    Type.String({
      description: "JSON array of batch edit ops",
    }),
  ),
});

type HleditParams = Static<typeof HLEDIT_PARAMS_SCHEMA>;

type HleditRun = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

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

function textResult(run: HleditRun) {
  const text =
    run.stdout.trimEnd() || run.stderr.trimEnd() || HLEDIT_INSTALL_HINT;
  return {
    content: [{ type: "text" as const, text }],
    details: { ok: run.exitCode === 0 },
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
  const hasRange = offset !== undefined || limit !== undefined || grep !== undefined;

  if (!hasRange) {
    return ["read", params.path];
  }

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

export function translateBatchEdits(editsJson: string): BatchTranslationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(editsJson) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `invalid JSON in edits param: ${message}` };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: "edits must be a JSON array" };
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
      "For op:'batch', pass edits as a JSON array using anchor/end_anchor; the wrapper translates to the CLI batch request.",
      "If edit returns stale, re-read the file to get fresh anchors before retrying.",
      "Use grep param to filter lines and reduce token usage: {op:'read', path, grep:'func '}",
    ],
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
        return textResult(await runHledit(buildReadArgs(params), undefined, ctx, signal));
      }

      if (op === "edit") {
        const request = buildEditRequest(params);
        if (!request.ok) {
          return errorResult(request.error);
        }
        return textResult(
          await runHledit(request.args, request.stdin, ctx, signal),
        );
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

        return textResult(
          await runHledit(["batch", path], translation.json, ctx, signal),
        );
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
