import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import piHleditExtension, {
  buildEditRequest,
  buildReadArgs,
  resolveHleditBin,
  translateBatchEdits,
} from "../index.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: { ok: boolean };
  isError?: boolean;
};

type RegisteredTool = {
  name: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<unknown> | undefined,
    ctx: ExtensionContext,
  ) => Promise<ToolResult>;
};

type RegisteredCommand = {
  description: string;
  handler: (args: string, ctx: ExtensionContext) => Promise<void>;
};

function registerExtension() {
  const tools: RegisteredTool[] = [];
  const commands = new Map<string, RegisteredCommand>();
  const pi = {
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
    registerCommand(name: string, command: RegisteredCommand) {
      commands.set(name, command);
    },
  } as unknown as ExtensionAPI;

  piHleditExtension(pi);

  return { tools, commands };
}

test("registers hledit tool and status command", () => {
  const { tools, commands } = registerExtension();

  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.name, "hledit");
  assert.ok(tools[0]?.parameters);
  assert.ok(commands.has("hledit-status"));
});

test("resolves hledit from PATH by default", () => {
  assert.equal(resolveHleditBin({}), "hledit");
  assert.equal(resolveHleditBin({ HLEDIT_BIN: "/tmp/hledit" }), "/tmp/hledit");
});

test("builds read args with default range limit", () => {
  assert.deepEqual(buildReadArgs({ op: "read", path: "a.ts" }), ["read", "a.ts"]);
  assert.deepEqual(buildReadArgs({ op: "read", path: "a.ts", grep: "func" }), [
    "read-range",
    "a.ts",
    "--offset",
    "1",
    "--limit",
    "2000",
    "--grep",
    "func",
  ]);
});

test("builds explicit edit actions", () => {
  assert.deepEqual(
    buildEditRequest({ op: "edit", path: "a.ts", action: "replace", anchor: "1#AB", content: "x" }),
    { ok: true, args: ["replace", "a.ts", "1#AB", "-"], stdin: "x" },
  );
  assert.deepEqual(
    buildEditRequest({ op: "edit", path: "a.ts", action: "insert", anchor: "1#AB", content: "x" }),
    { ok: true, args: ["insert", "a.ts", "1#AB", "-"], stdin: "x" },
  );
  assert.deepEqual(
    buildEditRequest({ op: "edit", path: "a.ts", action: "insert", anchor: "1#AB", after: true, content: "x" }),
    { ok: true, args: ["insert", "--after", "a.ts", "1#AB", "-"], stdin: "x" },
  );
  assert.deepEqual(
    buildEditRequest({ op: "edit", path: "a.ts", action: "delete", anchor: "1#AB" }),
    { ok: true, args: ["replace", "a.ts", "1#AB", "-"], stdin: "" },
  );
  assert.deepEqual(
    buildEditRequest({ op: "edit", path: "a.ts", action: "replace-range", anchor: "1#AB", end_anchor: "3#CD", content: "x" }),
    { ok: true, args: ["replace-range", "a.ts", "1#AB", "3#CD", "-"], stdin: "x" },
  );
});

test("translates wrapper batch edits to CLI request", () => {
  const translation = translateBatchEdits(
    JSON.stringify([
      { op: "replace", anchor: "1#AB", lines: ["one"] },
      { op: "delete", anchor: "2#CD", end_anchor: "3#EF", lines: [] },
      { op: "insert", anchor: "4#GH", lines: ["new"] },
    ]),
  );

  assert.equal(translation.ok, true);
  if (translation.ok) {
    assert.deepEqual(translation.request, {
      edits: [
        { op: "replace", pos: "1#AB", lines: ["one"] },
        { op: "delete", pos: "2#CD", end_pos: "3#EF", lines: [] },
        { op: "insert", pos: "4#GH", lines: ["new"] },
      ],
    });
    assert.equal(translation.json, JSON.stringify(translation.request));
  }
});

test("rejects unsupported batch insert-after", () => {
  const translation = translateBatchEdits(
    JSON.stringify([{ op: "insert", anchor: "1#AB", after: true, lines: ["x"] }]),
  );

  assert.deepEqual(translation, {
    ok: false,
    error: "edit 0 uses after, but batch insert-after is not supported by hledit CLI",
  });
});

test("batch edits with literal control chars give actionable error", () => {
  // Simulates a model generating JSON with a literal tab in a string value.
  const malformed = `{"edits":[{"op":"replace","anchor":"4#VJ","lines":["\treturn"]}]}`;
  const translation = translateBatchEdits(malformed);

  assert.equal(translation.ok, false);
  if (!translation.ok) {
    assert.ok(
      translation.error.includes("Escape control characters"),
      `error should mention escaping: ${translation.error}`,
    );
    assert.ok(
      translation.error.includes("op:'edit'"),
      `error should suggest op:'edit' fallback: ${translation.error}`,
    );
  }
});

test("registered batch tool sends CLI-native JSON to hledit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-hledit-test-"));
  const fakeBin = join(dir, "hledit-fake.mjs");
  await writeFile(
    fakeBin,
    `#!/usr/bin/env node\nimport { readFileSync } from 'node:fs';\nconst stdin = readFileSync(0, 'utf8');\nconsole.log(JSON.stringify({ argv: process.argv.slice(2), stdin }));\n`,
    { mode: 0o755 },
  );

  const oldBin = process.env.HLEDIT_BIN;
  process.env.HLEDIT_BIN = fakeBin;
  try {
    const { tools } = registerExtension();
    const tool = tools[0];
    assert.ok(tool);
    const ctx = { cwd: dir, signal: undefined } as unknown as ExtensionContext;
    const result = await tool.execute(
      "call-1",
      {
        op: "batch",
        path: "file.ts",
        edits: JSON.stringify([{ op: "replace", anchor: "1#AB", lines: ["x"] }]),
      },
      undefined,
      undefined,
      ctx,
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    assert.equal(result.details.ok, true);
    assert.deepEqual(payload, {
      argv: ["batch", "file.ts"],
      stdin: JSON.stringify({ edits: [{ op: "replace", pos: "1#AB", lines: ["x"] }] }),
    });
  } finally {
    if (oldBin === undefined) {
      delete process.env.HLEDIT_BIN;
    } else {
      process.env.HLEDIT_BIN = oldBin;
    }
  }
});
