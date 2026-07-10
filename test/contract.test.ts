import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  details: { ok: boolean; [key: string]: unknown };
  isError?: boolean;
};

type RenderComponent = {
  render(width: number): string[];
};

type ThemeStub = {
  fg: (name: string, text: string) => string;
  bold: (text: string) => string;
};

type RegisteredTool = {
  name: string;
  parameters: unknown;
  renderCall?: (
    args: Record<string, unknown>,
    theme: ThemeStub,
    context: Record<string, unknown>,
  ) => RenderComponent;
  renderResult?: (
    result: ToolResult,
    options: { expanded: boolean; isPartial: boolean },
    theme: ThemeStub,
    context: { args?: Record<string, unknown> },
  ) => RenderComponent;
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

test("schema exposes finite op and action unions", () => {
  const { tools } = registerExtension();
  const params = tools[0]?.parameters as {
    properties?: Record<string, { anyOf?: Array<{ const?: string }> }>;
  };

  assert.deepEqual(
    params.properties?.op?.anyOf?.map((entry) => entry.const),
    ["read", "edit", "batch"],
  );
  assert.deepEqual(
    params.properties?.action?.anyOf?.map((entry) => entry.const),
    ["replace", "insert", "delete", "replace-range"],
  );
});

test("resolves hledit from PATH by default", () => {
  assert.equal(resolveHleditBin({}), "hledit");
  assert.equal(resolveHleditBin({ HLEDIT_BIN: "/tmp/hledit" }), "/tmp/hledit");
});

test("builds read args with default range limit", () => {
  assert.deepEqual(buildReadArgs({ op: "read", path: "a.ts" }), [
    "read-range",
    "a.ts",
    "--offset",
    "1",
    "--limit",
    "2000",
  ]);
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
test("translates structured batch edits array to CLI request", () => {
  const translation = translateBatchEdits([
    { op: "replace", anchor: "1#ABC", lines: ["one"] },
    { op: "delete", anchor: "2#CDE", end_anchor: "3#EFG", lines: [] },
    { op: "insert", anchor: "4#GHJ", lines: ["new"] },
  ]);

  assert.equal(translation.ok, true);
  if (translation.ok) {
    assert.deepEqual(translation.request, {
      edits: [
        { op: "replace", pos: "1#ABC", lines: ["one"] },
        { op: "delete", pos: "2#CDE", end_pos: "3#EFG", lines: [] },
        { op: "insert", pos: "4#GHJ", lines: ["new"] },
      ],
    });
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

test("registered batch tool returns human-readable summary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-hledit-test-"));
  const fakeBin = join(dir, "hledit-fake.mjs");
  await writeFile(
    fakeBin,
    `#!/usr/bin/env node\nconsole.log(JSON.stringify({ ok: true, firstChangedLine: 12, lastChangedLine: 18, linesAdded: 3, linesDeleted: 2, editsApplied: 1 }))\n`,
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

    assert.equal(result.details.ok, true);
    assert.match(result.content[0]?.text ?? "", /Batch ok\./);
    assert.match(result.content[0]?.text ?? "", /Edits applied: 1/);
    assert.match(result.content[0]?.text ?? "", /Changed lines: 12-18/);
    assert.match(result.content[0]?.text ?? "", /Lines: \+3 -2/);
    const batchRendered = tool.renderResult?.(
      result,
      { expanded: true, isPartial: false },
      {
        fg: (name, text) => `<${name}>${text}</${name}>`,
        bold: (text) => `**${text}**`,
      },
      { args: { op: "batch" } },
    );
    assert.deepEqual(batchRendered?.render(120), [
      "<success>󰄬</success> Batch ok. Edits applied: 1. Changed lines: 12-18. Lines: +3 -2.",
    ]);
  } finally {
    if (oldBin === undefined) {
      delete process.env.HLEDIT_BIN;
    } else {
      process.env.HLEDIT_BIN = oldBin;
    }
  }
});


test("registered edit tool returns human-readable summary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-hledit-test-"));
  const fakeBin = join(dir, "hledit-fake.mjs");
  await writeFile(
    fakeBin,
    `#!/usr/bin/env node\nconsole.log(JSON.stringify({ ok: true, firstChangedLine: 1, lastChangedLine: 1, linesAdded: 2, linesDeleted: 1 }))\n`,
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
        op: "edit",
        path: "file.ts",
        action: "replace",
        anchor: "1#AB",
        content: "x",
      },
      undefined,
      undefined,
      ctx,
    );

    assert.equal(result.details.ok, true);
    const editRendered = tool.renderResult?.(
      result,
      { expanded: true, isPartial: false },
      {
        fg: (name, text) => `<${name}>${text}</${name}>`,
        bold: (text) => `**${text}**`,
      },
      { args: { op: "edit" } },
    );
    assert.deepEqual(editRendered?.render(80), [
      "<success>󰄬</success> Edit ok. Changed line: 1 Lines: +2 -1",
    ]);
  } finally {
    if (oldBin === undefined) {
      delete process.env.HLEDIT_BIN;
    } else {
      process.env.HLEDIT_BIN = oldBin;
    }
  }
});

test("registered edit tool renders UI-only diff", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-hledit-test-"));
  const fakeBin = join(dir, "hledit-fake.mjs");
  const filePath = join(dir, "file.ts");
  await writeFile(filePath, "alpha\nbeta\ngamma\n");
  await writeFile(
    fakeBin,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync("file.ts", "alpha\\nBETA\\ngamma\\n");
console.log(JSON.stringify({ ok: true, firstChangedLine: 2, lastChangedLine: 2, linesAdded: 1, linesDeleted: 1 }));
`,
    { mode: 0o755 },
  );

  const oldBin = process.env.HLEDIT_BIN;
  process.env.HLEDIT_BIN = fakeBin;
  try {
    const { tools } = registerExtension();
    const tool = tools[0];
    assert.ok(tool?.renderResult);
    const ctx = { cwd: dir, signal: undefined } as unknown as ExtensionContext;
    const result = await tool.execute(
      "call-1",
      {
        op: "edit",
        path: "file.ts",
        action: "replace",
        anchor: "2#ABC",
        content: "BETA",
      },
      undefined,
      undefined,
      ctx,
    );

    assert.equal(result.details.ok, true);
    assert.ok(result.details.diff);
    assert.doesNotMatch(result.content[0]?.text ?? "", /BETA/);

    const rendered = tool.renderResult(
      result,
      { expanded: true, isPartial: false },
      {
        fg: (name, text) => `<${name}>${text}</${name}>`,
        bold: (text) => `**${text}**`,
      },
      { args: { op: "edit" } },
    );

    assert.deepEqual(rendered.render(120), [
      "<success>󰄬</success> Edit ok. Changed line: 2 Lines: +1 -1",
      "<toolDiffContext>  alpha</toolDiffContext>",
      "<toolDiffRemoved>- beta</toolDiffRemoved>",
      "<toolDiffAdded>+ BETA</toolDiffAdded>",
      "<toolDiffContext>  gamma</toolDiffContext>",
    ]);
  } finally {
    if (oldBin === undefined) {
      delete process.env.HLEDIT_BIN;
    } else {
      process.env.HLEDIT_BIN = oldBin;
    }
  }
});

test("diff renderer honors env caps and context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-hledit-test-"));
  const fakeBin = join(dir, "hledit-fake.mjs");
  const filePath = join(dir, "file.ts");
  await writeFile(filePath, "a\nb\nc\nd\ne\n");
  await writeFile(
    fakeBin,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync("file.ts", "A\\nB\\nC\\nD\\nE\\n");
console.log(JSON.stringify({ ok: true, firstChangedLine: 1, lastChangedLine: 5, linesAdded: 5, linesDeleted: 5 }));
`,
    { mode: 0o755 },
  );

  const oldBin = process.env.HLEDIT_BIN;
  const oldMaxLines = process.env.PI_HLEDIT_DIFF_MAX_LINES;
  const oldContext = process.env.PI_HLEDIT_DIFF_CONTEXT;
  process.env.HLEDIT_BIN = fakeBin;
  process.env.PI_HLEDIT_DIFF_MAX_LINES = "5";
  process.env.PI_HLEDIT_DIFF_CONTEXT = "0";
  try {
    const { tools } = registerExtension();
    const tool = tools[0];
    assert.ok(tool?.renderResult);
    const ctx = { cwd: dir, signal: undefined } as unknown as ExtensionContext;
    const result = await tool.execute(
      "call-1",
      {
        op: "edit",
        path: "file.ts",
        action: "replace-range",
        anchor: "1#ABC",
        end_anchor: "5#DEF",
        content: "A\nB\nC\nD\nE",
      },
      undefined,
      undefined,
      ctx,
    );

    const rendered = tool.renderResult(
      result,
      { expanded: true, isPartial: false },
      {
        fg: (name, text) => `<${name}>${text}</${name}>`,
        bold: (text) => `**${text}**`,
      },
      { args: { op: "edit" } },
    );

    assert.deepEqual(rendered.render(120), [
      "<success>󰄬</success> Edit ok. Changed lines: 1-5 Lines: +5 -5",
      "<toolDiffRemoved>- a</toolDiffRemoved>",
      "<toolDiffRemoved>- b</toolDiffRemoved>",
      "<toolDiffContext>... (6 diff lines omitted) ...</toolDiffContext>",
      "<toolDiffAdded>+ D</toolDiffAdded>",
      "<toolDiffAdded>+ E</toolDiffAdded>",
    ]);
  } finally {
    if (oldBin === undefined) {
      delete process.env.HLEDIT_BIN;
    } else {
      process.env.HLEDIT_BIN = oldBin;
    }
    if (oldMaxLines === undefined) {
      delete process.env.PI_HLEDIT_DIFF_MAX_LINES;
    } else {
      process.env.PI_HLEDIT_DIFF_MAX_LINES = oldMaxLines;
    }
    if (oldContext === undefined) {
      delete process.env.PI_HLEDIT_DIFF_CONTEXT;
    } else {
      process.env.PI_HLEDIT_DIFF_CONTEXT = oldContext;
    }
  }
});
test("registered read tool returns annotated lines and calls read-range", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-hledit-test-"));
  const fakeBin = join(dir, "hledit-fake.mjs");
  const argsLog = join(dir, "args.json");
  await writeFile(
    fakeBin,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(argsLog)}, JSON.stringify(process.argv.slice(2)));
console.log("1#AB:const ok = true;\\n2#CD:console.log(ok);");
`,
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
      { op: "read", path: "file.ts" },
      undefined,
      undefined,
      ctx,
    );

    assert.equal(result.details.ok, true);
    assert.equal(
      result.content[0]?.text,
      "1#AB:const ok = true;\n2#CD:console.log(ok);",
    );

    const calledArgs = JSON.parse(await readFile(argsLog, "utf8"));
    assert.deepEqual(calledArgs, [
      "read-range",
      "file.ts",
      "--offset",
      "1",
      "--limit",
      "2000",
    ]);
  } finally {
    if (oldBin === undefined) {
      delete process.env.HLEDIT_BIN;
    } else {
      process.env.HLEDIT_BIN = oldBin;
    }
  }
});

test("renderResult folds long read output", () => {
  const { tools } = registerExtension();
  const tool = tools[0];
  assert.ok(tool?.renderResult);
  assert.ok(tool?.renderCall);
  const call = tool.renderCall(
    { op: "read", path: "test/contract.test.ts", offset: 300, limit: 18 },
    {
      fg: (name, text) => `<${name}>${text}</${name}>`,
      bold: (text) => `**${text}**`,
    },
    {},
  );
  assert.deepEqual(call.render(120), [
    "<toolTitle>**hledit read:**</toolTitle> <accent>test/contract.test.ts</accent><warning>:300-317</warning>",
  ]);

  const rendered = tool.renderResult(
    {
      content: [
        {
          type: "text",
          text: Array.from({ length: 24 }, (_, i) => `line ${i + 1}`).join("\n"),
        },
      ],
      details: { ok: true },
      isError: false,
    },
    { expanded: true, isPartial: false },
    {
      fg: (name, text) => `<${name}>${text}</${name}>`,
      bold: (text) => `**${text}**`,
    },
    { args: { op: "read" } },
  );

  assert.deepEqual(rendered.render(80), [
    "<accent>󰋽</accent> Read folded: 24 lines",
    "line 1",
    "... (22 lines) ...",
    "line 24",
  ]);
});

// Tabs render wider than their string length, so a length-based truncation
// can undercount and let an over-wide line through — this is the exact bug
// that crashed a real session (pi-crash.log: "Rendered line exceeds terminal
// width"). Literal tabs also render as terminal jumps that leave unpainted
// gaps in the tool box background, so rendered display lines should expand
// tabs before truncating. Sweep a range of widths against tab-heavy lines and
// assert the invariant holds everywhere (measured with pi-tui's own
// visibleWidth, the same function that re-measures this output when pi
// actually renders it), not just at one width a targeted regression test
// happened to pick.
test("renderResult truncation never exceeds the requested width, even with tabs", async () => {
  const { visibleWidth } = await import("@earendil-works/pi-tui");
  const { tools } = registerExtension();
  const tool = tools[0];
  assert.ok(tool?.renderResult);

  const tabHeavyLines = [
    "196#VY:\t\tnotice := fmt.Sprintf(\"-- %d more matches, use offset %d --\", remaining, lastLn+1)",
    "\t\t\t\t\t\t\t\tdeeply nested",
    "no tabs at all, just a very long line of plain ascii text to force truncation somewhere",
    "",
  ];

  const rendered = tool.renderResult(
    {
      content: [{ type: "text", text: tabHeavyLines.join("\n") }],
      details: { ok: true },
      isError: false,
    },
    { expanded: true, isPartial: false },
    { fg: (name: string, text: string) => text, bold: (text: string) => text },
    { args: { op: "read" } },
  );

  for (let width = 0; width <= 120; width++) {
    for (const line of rendered.render(width)) {
      assert.ok(!line.includes("\t"), `render(${width}) leaked a tab: ${JSON.stringify(line)}`);
      assert.ok(
        visibleWidth(line) <= width,
        `render(${width}) produced a line of visual width ${visibleWidth(line)}: ${JSON.stringify(line)}`,
      );
    }
  }
});
