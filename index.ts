import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";

const HLEDIT_BIN =
	process.env.HLEDIT_BIN || `${process.env.HOME}/.local/bin/hledit`;

type HleditRun = {
	stdout: string;
	stderr: string;
	exitCode: number | null;
};

async function runHledit(
	args: string[],
	stdin: string | undefined,
	ctx: ExtensionContext,
): Promise<HleditRun> {
	return new Promise((resolve) => {
		const child = spawn(HLEDIT_BIN, args, {
			cwd: ctx.cwd,
			signal: ctx.signal,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", () => resolve({ stdout, stderr, exitCode: 1 }));
		child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
		child.stdin.end(stdin ?? "");
	});
}

function textResult(run: HleditRun) {
	return {
		content: [{ type: "text" as const, text: run.stdout.trimEnd() }],
		details: { ok: run.exitCode === 0 },
		isError: run.exitCode !== 0,
	};
}

function toNum(v: number | undefined): number | undefined {
	return v !== undefined && v >= 0 ? v : undefined;
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
		parameters: Type.Object({
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
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { op, path } = params;

			if (op === "read") {
				const offset = toNum(params.offset as number | undefined);
				const limit = toNum(params.limit as number | undefined);
				const grep = (params.grep as string) || undefined;
				const hasRange =
					offset !== undefined || limit !== undefined || grep !== undefined;
				const args = hasRange
					? [
							"read-range",
							path,
							"--offset",
							String(offset ?? 1),
							"--limit",
							String(limit ?? 2000),
							...(grep ? ["--grep", grep] : []),
						]
					: ["read", path];
				return textResult(await runHledit(args, undefined, ctx));
			}

			if (op === "edit") {
				const anchor = params.anchor as string;
				const content = (params.content as string) ?? "";
				const endAnchor = (params.end_anchor as string) || undefined;
				const after = (params.after as boolean) || false;

				let args: string[];
				if (endAnchor) {
					args = ["replace-range", path, anchor, endAnchor, "-"];
				} else if (after) {
					args = ["insert", "--after", path, anchor, "-"];
				} else {
					args = ["replace", path, anchor, "-"];
				}
				return textResult(await runHledit(args, content, ctx));
			}

			if (op === "batch") {
				const edits = params.edits as string;
				if (!edits) {
					return {
						content: [
							{
								type: "text" as const,
								text: 'missing \'edits\' param. Expected JSON array of ops, e.g.: [{"op":"replace","anchor":"5#TX","lines":["new line"]},{"op":"delete","anchor":"3#AB","lines":[]}] Each op needs: op (replace|delete|insert), anchor (LN#HASH), lines (string array, empty = delete). Use \'insert\' op with anchor from read; set after:true to insert after instead of before.',
							},
						],
						details: { ok: false },
						isError: true,
					};
				}
				try {
					const parsed = JSON.parse(edits);
					if (!Array.isArray(parsed)) {
						return {
							content: [
								{
									type: "text" as const,
									text: 'edits must be a JSON array, not an object. Example: [{"op":"replace","anchor":"5#TX","lines":["new"]}]',
								},
							],
							details: { ok: false },
							isError: true,
						};
					}
					for (let i = 0; i < parsed.length; i++) {
						const e = parsed[i];
						if (!e.op || !e.anchor) {
							return {
								content: [
									{
										type: "text" as const,
										text: `edit ${i} missing required fields. Each op needs: op (replace|delete|insert) and anchor (LN#HASH). Got: ${JSON.stringify(e)}`,
									},
								],
								details: { ok: false },
								isError: true,
							};
						}
						if (!["replace", "delete", "insert"].includes(e.op)) {
							return {
								content: [
									{
										type: "text" as const,
										text: `edit ${i} has invalid op '${e.op}'. Must be: replace, delete, or insert.`,
									},
								],
								details: { ok: false },
								isError: true,
							};
						}
						if (!e.anchor.includes("#")) {
							return {
								content: [
									{
										type: "text" as const,
										text: `edit ${i} anchor '${e.anchor}' is invalid. Expected LN#HH format (e.g. '5#TX'). Run hledit read first to get anchors.`,
									},
								],
								details: { ok: false },
								isError: true,
							};
						}
					}
				} catch (e) {
					return {
						content: [
							{
								type: "text" as const,
								text: `invalid JSON in edits param: ${e.message}. Expected: [{"op":"replace","anchor":"5#TX","lines":["new"]}]`,
							},
						],
						details: { ok: false },
						isError: true,
					};
				}
				return textResult(await runHledit(["batch", path], edits, ctx));
			}

			return {
				content: [
					{
						type: "text" as const,
						text: `unknown op '${op}'. Must be: read, edit, or batch. Examples: {op:'read', path:'file.ts'} | {op:'edit', path:'file.ts', anchor:'5#TX', content:'new'} | {op:'batch', path:'file.ts', edits:'[{op,pos,lines}]'}`,
					},
				],
				details: { ok: false },
				isError: true,
			};
		},
	});

	// ── Status command ─────────────────────────────────────────────────────
	pi.registerCommand("hledit-status", {
		description: "Check the configured hledit binary",
		handler: async (_args, ctx) => {
			const run = await runHledit(["help"], undefined, ctx);
			if (run.exitCode === 0) {
				ctx.ui.notify(`hledit ready: ${HLEDIT_BIN}`, "info");
			} else {
				ctx.ui.notify(`hledit failed: ${HLEDIT_BIN}`, "error");
			}
		},
	});
}
