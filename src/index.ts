/**
 * route-model — "Know when to call the big guns"
 *
 * Watches the local model struggle and nudges you toward Claude when
 * a task clearly outgrows what the model on your machine can handle.
 *
 * Strategy: three simple signals, all observable at runtime — scoped to
 * the CURRENT task (reset on every new user prompt, not cumulative for
 * the whole session):
 *
 * 1. **Turn count** — how many turns the agent burns on this task.
 * 2. **Struggle phrases** — the assistant saying "I'm not sure",
 *    "let me try again", "it might be", etc.
 * 3. **Tool failure streak** — the same tool failing 2+ consecutive times
 *    (restarts when any tool succeeds). Catches struggle the model never
 *    verbalises: an edit tool that keeps failing, a grep that returns
 *    nothing repeatedly, etc.
 *
 * When the current task exceeds your configured turn threshold AND
 * shows at least one struggle signal, you get a prompt to switch to
 * Claude. The switch happens in-session — no new session is created,
 * Claude picks up with full history intact.
 *
 * Config is loaded from ../config/config.json (relative to this file).
 * If it's missing/invalid, monitoring disables itself with one warning
 * instead of crash-looping. Copy config/config.example.json to
 * config/config.json to get started.
 */
import type {
	ExtensionAPI,
	Message,
	Model,
	// @ts-expect-error
} from "@earendil-works/pi-coding-agent";
// Shape expected by pi's getArgumentCompletions — not exported from pi,
// so we define it locally (matches pi-tui's AutocompleteItem).
interface AutocompleteItem {
	value: string;
	label: string;
}
// @ts-expect-error
import { readFileSync } from "node:fs";
// @ts-expect-error
import { dirname, join } from "node:path";
// @ts-expect-error
import { fileURLToPath } from "node:url";

// ── Types ───────────────────────────────────────────────────────────

interface Config {
	claudeModelId: string;
	turnThreshold: number;
	struggleConsecutive: number;
	toolFailureThreshold: number;
	autoMode: boolean;
	strugglePatterns: string[];
}

interface TurnState {
	turnIndex: number;
	isStruggling: boolean;
	struggleReasons: string[];
	toolFailures: number;
}

// Config lives in ../config/config.json relative to this source file.
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(EXTENSION_DIR, "../config/config.json");
const DEFAULT_TOOL_FAILURE_THRESHOLD = 3;

/** Derive a "failure tag" from a tool result event: which specific thing
 *  failed, so the same failing tool increments the streak. */
function failureTag(event: any): string {
	if (event?.toolName) return `tool:${event.toolName}`;
	if (event?.toolCallId) return `call:${event.toolCallId}`;
	return "unknown";
}

// ── Helpers ─────────────────────────────────────────────────────────

function loadConfig(): Config {
	const raw = readFileSync(CONFIG_PATH, "utf-8");
	try {
		return JSON.parse(raw) as Config;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`invalid JSON in ${CONFIG_PATH}: ${msg}`);
	}
}

/** Check if an assistant message signals struggle. */
function detectStruggle(message: Message, cfg: Config): string[] {
	if (message.role !== "assistant") return [];
	const text = extractAssistantText(message);
	if (!text) return [];
	const matched: string[] = [];
	for (const pattern of cfg.strugglePatterns) {
		if (text.toLowerCase().includes(pattern)) matched.push(pattern);
	}
	return matched;
}

function extractAssistantText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	if (Array.isArray(message.content)) {
		const items = message.content as Array<{ type: string; text?: string }>;
		return items
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("\n");
	}
	return "";
}

function isLocalModel(model: Model | undefined): boolean {
	if (!model) return false;
	return !model.provider.toLowerCase().includes("anthropic");
}

function findClaudeModel(
	modelRegistry: any,
	preferredId: string,
): Model | undefined {
	const byId = modelRegistry.find("anthropic", preferredId);
	if (byId) return byId;
	const candidates = [
		"claude-sonnet-4-5",
		"claude-sonnet-5",
		"claude-sonnet-4-6",
		"claude-opus-4-5",
	];
	for (const id of candidates) {
		const m = modelRegistry.find("anthropic", id);
		if (m) return m;
	}
	return modelRegistry.getAll().find((m: any) => m.provider === "anthropic");
}

function findLocalModel(modelRegistry: any): Model | undefined {
	const localProviders = ["omlx", "ollama", "lmstudio", "openai"];
	for (const provider of localProviders) {
		const models = modelRegistry
			.getAll()
			.filter((m: any) => m.provider === provider);
		if (models.length > 0) return models[0];
	}
	return modelRegistry.getAll().find((m: any) => m.provider !== "anthropic");
}

// ── Extension ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let config: Config | undefined;
	let configLoadFailed = false;

	// Per-task tracking (reset on every new user prompt, see resetTaskState)
	let turnIndex = 0;
	let consecutiveStruggling = 0;
	let consecutiveToolFailures = 0;
	let lastFailureTag = "";
	let hasAlerted = false;
	let strugglingTurns: Message[] = [];
	// Track whether the previous model (before the current task) was Claude.
	// When a user manually switches to Claude, this stays true so the
	// task-boundary handler knows to stay put until the user explicitly
	// switches back. Resets on every new task.
	let prevModelWasClaude = false;

	function resolveConfig(): Config | undefined {
		if (configLoadFailed) return undefined;
		if (config !== undefined) return config;
		try {
			config = loadConfig();
			return config;
		} catch (err) {
			configLoadFailed = true;
			const msg = err instanceof Error ? err.message : String(err);
			console.error(
				`[route-model] config load failed, monitoring disabled: ${msg}`,
			);
			return undefined;
		}
	}

	/** Reset state scoped to the current task. Called on session_start AND
	 *  on every new user prompt (before_agent_start), so turn/struggle
	 *  counting never carries over between unrelated tasks. */
	function resetTaskState(): void {
		turnIndex = 0;
		consecutiveStruggling = 0;
		consecutiveToolFailures = 0;
		lastFailureTag = "";
		hasAlerted = false;
		strugglingTurns = [];
	}

	// ── Lifecycle ───────────────────────────────────────────────────

	pi.on("session_start", async (_event: { reason: string }, ctx: any) => {
		resetTaskState();
		configLoadFailed = false;
		config = undefined;
		const cfg = resolveConfig();
		if (!cfg) {
			ctx.ui.notify(
				"route-model: config.json missing — copy config/config.example.json to config/config.json.",
				"warning",
			);
			return;
		}
		ctx.ui.notify(
			isLocalModel(ctx.model)
				? "🔧 route-model: watching local model performance"
				: "☁️ route-model: using cloud model — monitoring off",
			"info",
		);
	});

	// ── Status / manual-switch command ──────────────────────────────

	pi.registerCommand("route-model", {
		description:
			"Show status · 'switch' toggles model · 'auto' toggles auto-switch mode",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const options = [
				{ value: "switch", label: "Toggle between local and Claude" },
				{ value: "auto", label: "Toggle auto-switch mode on/off" },
			];
			const filtered = options.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args: any, ctx: any) => {
			const cfg = resolveConfig();
			if (!cfg) {
				ctx.ui.notify(
					"route-model: config.json missing — copy config/config.example.json to config/config.json.",
					"warning",
				);
				return;
			}

			const arg = String(args).trim();

			if (arg === "switch") {
				await doToggleModel(ctx, cfg);
				return;
			}

			if (arg === "auto") {
				cfg.autoMode = !cfg.autoMode;
				ctx.ui.notify(
					`🔧 route-model: auto-switch ${cfg.autoMode ? "ON — will switch automatically" : "OFF — will ask before switching"}`,
					"info",
				);
				ctx.ui.setStatus("route-model", cfg.autoMode ? "auto ON" : "auto OFF");
				return;
			}

			const active = isLocalModel(ctx.model);
			ctx.ui.notify(
				[
					"🔧 route-model status",
					"",
					`Model:     ${active ? "🟡 Local (monitoring ON)" : "🟢 Cloud (monitoring OFF)"}`,
					`Auto-mode: ${cfg.autoMode ? "✅ ON (switches automatically)" : "🔕 OFF (asks first)"}`,
					`Threshold: ${cfg.turnThreshold} turns`,
					`Tool fail threshold: ${cfg.toolFailureThreshold ?? DEFAULT_TOOL_FAILURE_THRESHOLD} consecutive`,
					`Struggling turns: ${consecutiveStruggling} consecutive`,
					`Tool failures:  ${consecutiveToolFailures} consecutive`,
					`Turns this task: ${turnIndex}`,
					hasAlerted ? "⚠️ Alert was shown for this task" : "✅ No alert yet",
					"",
					"'/route-model switch' — toggle model",
					"'/route-model auto'   — toggle auto-switch",
				].join("\n"),
				"info",
			);
		},
	});

	// ── Model tracking ──────────────────────────────────────────────

	pi.on("model_select", async (event: any, ctx: any) => {
		if (isLocalModel(event.model) && !isLocalModel(event.previousModel)) {
			ctx.ui.notify(
				"⚠️ route-model: switched to local model — monitoring for struggle",
				"info",
			);
		} else if (
			!isLocalModel(event.model) &&
			isLocalModel(event.previousModel)
		) {
			resetTaskState();
			ctx.ui.notify(
				"✅ route-model: switched to cloud model — monitoring off",
				"info",
			);
		}
	});

	// ── Tool execution monitoring: track consecutive failures ──────

	pi.on("tool_execution_end", async (event: any, ctx: any) => {
		if (!isLocalModel(ctx.model)) return;
		if (event.isError) {
			const tag = failureTag(event);
			if (tag === lastFailureTag) {
				consecutiveToolFailures++;
			} else {
				// Different tool failed — start a new streak.
				consecutiveToolFailures = 1;
				lastFailureTag = tag;
			}
		} else {
			// Any successful tool call breaks the streak.
			consecutiveToolFailures = 0;
			lastFailureTag = "";
		}
	});

	// ── Per-task / per-turn monitoring ──────────────────────────────

	pi.on("before_agent_start", async (_event: any, ctx: any) => {
		if (!isLocalModel(ctx.model)) {
			// If the previous model was Claude, the user chose to go there.
			// Stay on Claude — don't interfere. They can switch back manually.
			if (prevModelWasClaude) {
				prevModelWasClaude = false;
				return;
			}
			// Otherwise: struggle-driven switch. Normal task-boundary logic.
			const cfg = resolveConfig();
			if (!cfg) return;

			if (cfg.autoMode) {
				await switchToLocal(ctx);
			} else {
				const ok = await ctx.ui.confirm(
					"route-model",
					"New task starting — switch back to local model?",
				);
				if (ok) await switchToLocal(ctx);
			}
			return;
		}
		resetTaskState();
	});

	pi.on("turn_start", async (_event: { turnIndex: number }, _ctx: any) => {
		turnIndex++;
	});

	pi.on("turn_end", async (_event: { turnIndex: number }, ctx: any) => {
		if (!isLocalModel(ctx.model)) return;
		const cfg = resolveConfig();
		if (!cfg) return;

		const allEntries = ctx.sessionManager.getBranch();
		const latestAssistant = [...allEntries]
			.reverse()
			.find(
				(e: any) => e.type === "message" && e.message?.role === "assistant",
			);

		let isStruggling = false;
		let struggleReasons: string[] = [];

		if (latestAssistant?.type === "message" && latestAssistant.message) {
			const reasons = detectStruggle(latestAssistant.message, cfg);
			if (reasons.length > 0) {
				isStruggling = true;
				struggleReasons = reasons;
				strugglingTurns.push(latestAssistant.message);
			}
		}

		consecutiveStruggling = isStruggling ? consecutiveStruggling + 1 : 0;

		const toolFailureCount =
			cfg.toolFailureThreshold ?? DEFAULT_TOOL_FAILURE_THRESHOLD;
		const turnState: TurnState = {
			turnIndex,
			isStruggling,
			struggleReasons,
			toolFailures: consecutiveToolFailures,
		};

		const shouldAlert =
			turnIndex >= cfg.turnThreshold &&
			(consecutiveStruggling >= 1 ||
				consecutiveToolFailures >= toolFailureCount ||
				turnIndex >= cfg.turnThreshold * 2);

		if (shouldAlert && !hasAlerted) {
			hasAlerted = true;
			await promptToSwitchTurn(ctx, cfg, turnState);
		}
	});

	// ── Input event: intercept natural-language switch phrases ───────

	pi.on("input", async (event: any, ctx: any) => {
		if (!isLocalModel(ctx.model)) return { action: "continue" };

		const lower = event.text.toLowerCase().trim();
		const cfg = resolveConfig();
		if (!cfg) return { action: "continue" };

		const isSwitchPhrase =
			lower === "switch to claude" ||
			lower === "use claude" ||
			lower === "claude please" ||
			lower === "use the big model" ||
			lower.startsWith("please switch to claude");

		if (isSwitchPhrase) {
			pi.sendUserMessage("/route-model switch", { deliverAs: "followUp" });
			return { action: "handled" };
		}

		const isStruggleQuery =
			/(?:are|do you|is it|is the|seem)/i.test(lower) &&
			/(?:struggling|stuck|having trouble|can't handle|out of depth)/i.test(
				lower,
			);

		if (isStruggleQuery) {
			let status: string;
			if (consecutiveStruggling > 0) {
				status = `yes — ${consecutiveStruggling} consecutive struggling turn(s) this task`;
			} else if (turnIndex > 0) {
				status = `no — ${turnIndex} turn(s) so far this task, seems on track`;
			} else {
				status = "no — task just started";
			}
			ctx.ui.notify(`route-model assessment: ${status}`, "info");
			return { action: "handled" };
		}

		return { action: "continue" };
	});

	// ── Core logic ──────────────────────────────────────────────────

	async function promptToSwitchTurn(
		ctx: any,
		cfg: Config,
		turnState: TurnState,
	) {
		if (!ctx.hasUI) return;

		// Build a human-readable reason string from whichever signals fired.
		const struggleSummary =
			turnState.struggleReasons.length > 0
				? `Detected uncertainty: "${turnState.struggleReasons[0]}"`
				: turnState.toolFailures > 0
					? `${turnState.toolFailures} consecutive tool failure(s) without a successful call`
					: `Agent has been turning for ${turnState.turnIndex} turns on this task without a clean resolution`;

		if (cfg.autoMode) {
			ctx.ui.notify(
				`🔧 route-model: detected struggle (${turnState.turnIndex} turns) — switching to Claude`,
				"info",
			);
			pi.sendUserMessage("/route-model switch", { deliverAs: "followUp" });
		} else {
			const message = [
				"🔧 **route-model**: Agent may be struggling…",
				"",
				`⏱️ ${turnState.turnIndex} turns burned this task (threshold: ${cfg.turnThreshold})`,
				struggleSummary,
				turnState.toolFailures > 0
					? `🔴 ${turnState.toolFailures} consecutive tool failure(s)`
					: "",
				"",
				"Switch to Claude to continue with more capability?",
			].join("\n");

			const choice = await ctx.ui.confirm("route-model", message);

			if (choice) {
				pi.sendUserMessage("/route-model switch", { deliverAs: "followUp" });
			} else {
				ctx.ui.notify(
					"route-model: will keep monitoring. Run '/route-model switch' anytime.",
					"info",
				);
			}
		}
	}

	async function switchToLocal(ctx: any) {
		const localModel = findLocalModel(ctx.modelRegistry);
		if (!localModel) {
			ctx.ui.notify(
				"route-model: no local model found. Add one via /model first.",
				"error",
			);
			return;
		}
		const success = await pi.setModel(localModel);
		if (!success) {
			ctx.ui.notify("route-model: failed to switch to local model.", "error");
			return;
		}
		resetTaskState();
		ctx.ui.notify(
			`✅ route-model: switched back to local (${localModel.name || localModel.id})`,
			"info",
		);
		ctx.ui.setStatus("route-model", "Now on local");
	}

	async function doToggleModel(ctx: any, cfg: Config) {
		const isCurrentlyLocal = isLocalModel(ctx.model);

		if (isCurrentlyLocal) {
			const claudeModel = findClaudeModel(ctx.modelRegistry, cfg.claudeModelId);
			if (!claudeModel) {
				ctx.ui.notify(
					"route-model: no Claude model found. Add one via /model first.",
					"error",
				);
				return;
			}
			const success = await pi.setModel(claudeModel);
			if (!success) {
				ctx.ui.notify(
					"route-model: no API key for the Claude model. Check your config.",
					"error",
				);
				return;
			}
			ctx.ui.notify("✅ route-model: switched to Claude", "info");
			ctx.ui.setStatus("route-model", "Now on Claude");
		} else {
			await switchToLocal(ctx);
		}
	}
}
