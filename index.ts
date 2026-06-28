import type {
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { Type, type Static } from "typebox";

const HLEDIT_BIN =
  process.env.HLEDIT_BIN || `${process.env.HOME}/.local/bin/hledit`;

const HLEDIT_INSTALL_HINT = `Install the hledit CLI first:
  go install github.com/dabito/hledit@latest

Then either put it at ~/.local/bin/hledit, add ~/go/bin to PATH, or set:
  export HLEDIT_BIN="$HOME/go/bin/hledit"

CLI repo: https://github.com/dabito/hledit`;

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
  anchor: Type.Optional(
    Type.String({ description: "LN#HASH anchor, e.g. 12#NK" }),
  ),
  end_anchor: Type.Optional(
    Type.String({ description: "End anchor for replace_range" }),
  ),
  content: Type.Optional(
    Type.String({ description: "Replacement content; empty = delete" }),
  ),
  after: Type.Optional(
    Type.Boolean({ description: "Insert after anchor instead of before" }),
  ),
  // Batch params — JSON array of ops. See promptGuidelines for exact format.
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

const BATCH_OPS = ["replace", "delete", "insert"] as const;

type BatchOp = (typeof BATCH_OPS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBatchOp(value: unknown): value is BatchOp {
  return typeof value === "string" && BATCH_OPS.includes(value as BatchOp);
}

function errorResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: { ok: false },
    isError: true,
  };
}

async function runHledit(
  args: string[],
  stdin: string | undefined,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined = ctx.signal,
): Promise<HleditRun> {
  return new Promise((resolve) => {
    const child = spawn(HLEDIT_BIN, args, {
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
        stdout: `failed to run ${HLEDIT_BIN}: ${err.message}\n\n${HLEDIT_INSTALL_HINT}`,
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

function validateBatchEdits(parsed: unknown): string | undefined {
  if (!Array.isArray(parsed)) {
    return 'edits must be a JSON array, not an object. Example: [{"op":"replace","anchor":"5#TX","lines":["new"]}]';
  }

  for (let i = 0; i < parsed.length; i++) {
    const edit = parsed[i];
    if (!isRecord(edit)) {
      return `edit ${i} must be an object. Got: ${JSON.stringify(edit)}`;
    }

    const { op, anchor, lines } = edit;
    if (typeof op !== "string" || typeof anchor !== "string") {
      return `edit ${i} missing required fields. Each op needs: op (replace|delete|insert) and anchor (LN#HASH). Got: ${JSON.stringify(edit)}`;
    }

    if (!isBatchOp(op)) {
      return `edit ${i} has invalid op '${op}'. Must be: replace, delete, or insert.`;
    }

    if (!anchor.includes("#")) {
      return `edit ${i} anchor '${anchor}' is invalid. Expected LN#HH format (e.g. '5#TX'). Run hledit read first to get anchors.`;
    }

    if (lines !== undefined && !Array.isArray(lines)) {
      return `edit ${i} lines must be an array of strings when provided. Got: ${JSON.stringify(lines)}`;
    }

    if (
      Array.isArray(lines) &&
      !lines.every((line) => typeof line === "string")
    ) {
      return `edit ${i} lines must contain only strings. Got: ${JSON.stringify(lines)}`;
    }
  }

  return undefined;
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
      "For multiple edits to the same file, use op:'batch' with all anchors from the same read.",
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
        const offset = toNum(params.offset);
        const limit = toNum(params.limit);
        const grep = params.grep || undefined;
        const hasRange =
          offset !== undefined || limit !== undefined || grep !== undefined;
        let args: string[];
        if (hasRange) {
          args = [
            "read-range",
            path,
            "--offset",
            String(offset ?? 1),
            "--limit",
            String(limit ?? 2000),
          ];
          if (grep) {
            args.push("--grep", grep);
          }
        } else {
          args = ["read", path];
        }
        return textResult(await runHledit(args, undefined, ctx, signal));
      }

      if (op === "edit") {
        const anchor = params.anchor;
        if (!anchor) {
          return errorResult(
            "missing 'anchor' param for op:'edit'. Run hledit read first to get an LN#HASH anchor.",
          );
        }

        const content = params.content ?? "";
        const endAnchor = params.end_anchor || undefined;
        const after = params.after || false;

        let args: string[];
        if (endAnchor) {
          args = ["replace-range", path, anchor, endAnchor, "-"];
        } else if (after) {
          args = ["insert", "--after", path, anchor, "-"];
        } else {
          args = ["replace", path, anchor, "-"];
        }
        return textResult(await runHledit(args, content, ctx, signal));
      }

      if (op === "batch") {
        const edits = params.edits;
        if (!edits) {
          return errorResult(
            'missing \'edits\' param. Expected JSON array of ops, e.g.: [{"op":"replace","anchor":"5#TX","lines":["new line"]},{"op":"delete","anchor":"3#AB","lines":[]}] Each op needs: op (replace|delete|insert), anchor (LN#HASH), lines (string array, empty = delete). Use \'insert\' op with anchor from read; set after:true to insert after instead of before.',
          );
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(edits) as unknown;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return errorResult(
            `invalid JSON in edits param: ${message}. Expected: [{"op":"replace","anchor":"5#TX","lines":["new"]}]`,
          );
        }

        const validationError = validateBatchEdits(parsed);
        if (validationError) {
          return errorResult(validationError);
        }

        return textResult(await runHledit(["batch", path], edits, ctx, signal));
      }

      return errorResult(
        `unknown op '${op}'. Must be: read, edit, or batch. Examples: {op:'read', path:'file.ts'} | {op:'edit', path:'file.ts', anchor:'5#TX', content:'new'} | {op:'batch', path:'file.ts', edits:'[{op,pos,lines}]'}`,
      );
    },
  });

  // ── Status command ─────────────────────────────────────────────────────
  pi.registerCommand("hledit-status", {
    description: "Check the configured hledit binary",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const run = await runHledit(["help"], undefined, ctx);
      if (run.exitCode === 0) {
        ctx.ui.notify(`hledit ready: ${HLEDIT_BIN}`, "info");
      } else {
        ctx.ui.notify(
          `hledit failed: ${HLEDIT_BIN}\n\n${HLEDIT_INSTALL_HINT}`,
          "error",
        );
      }
    },
  });
}
