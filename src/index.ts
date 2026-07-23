/**
 * route-model — "Know when to call the big guns"
 *
 * Watches the local model struggle and nudges you toward a cloud model
 * when a task clearly outgrows what the model on your machine can handle.
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
 * the cloud. The switch happens in-session — no new session is created,
 * the cloud model picks up with full history intact.
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
	cloudProvider?: string; // Cloud provider name (default: "anthropic")
	cloudModelId: string;
	localModelIds?: string[]; // Preferred local models in order; falls back to first available
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
const DEFAULT_CLOUD_PROVIDER = "anthropic"; // Default to Anthropic if not specified in config

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

function isLocalModel(model: Model | undefined, cloudProvider: string): boolean {
	if (!model) return false;
	return !model.provider.toLowerCase().includes(cloudProvider.toLowerCase());
}

/** Find a cloud model by the configured ID, or fall back to the first
 *  available model from the cloud provider. */
function findCloudModel(
	modelRegistry: any,
	cloudProvider: string,
	preferredId: string,
): Model | undefined {
	// First, try to find by the preferred ID
	const byId = modelRegistry.find(cloudProvider, preferredId);
	if (byId) return byId;

	// Fall back to first available model from cloud provider
	return modelRegistry
		.getAll()
		.find((m: any) => m.provider.toLowerCase() === cloudProvider.toLowerCase());
}

function findLocalModel(
	modelRegistry: any,
	preferredIds?: string[],
	cloudProvider?: string,
): Model | undefined {
	// First, try preferred IDs from config
	if (preferredIds && preferredIds.length > 0) {
		for (const id of preferredIds) {
			const m = modelRegistry.getAll().find((model: any) => model.id === id);
			if (m) return m;
		}
	}

	// Fallback: search by provider
	const localProviders = ["omlx", "ollama", "lmstudio", "openai"];
	for (const provider of localProviders) {
		const models = modelRegistry
			.getAll()
			.filter((m: any) => m.provider === provider);
		if (models.length > 0) return models[0];
	}

	// Final fallback: any non-cloud-provider model
	const cloudProv = (cloudProvider || DEFAULT_CLOUD_PROVIDER).toLowerCase();
	return modelRegistry.getAll().find((m: any) => m.provider.toLowerCase() !== cloudProv);
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
	// Track whether the most recent cloud switch came from struggle detection.
	// If true, before_agent_start will offer to switch back to local.
	// If false, user initiated the cloud switch and we respect that intent.
	let cloudSwitchWasFromStruggle = false;

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
		const cloudProvider = cfg?.cloudProvider || DEFAULT_CLOUD_PROVIDER;
		if (!cfg) {
			ctx.ui.notify(
				"route-model: config.json missing — copy config/config.example.json to config/config.json.",
				"warning",
			);
			return;
		}
		ctx.ui.notify(
			isLocalModel(ctx.model, cloudProvider)
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
				{ value: "switch", label: "Toggle between local and cloud" },
				{ value: "auto", label: "Toggle auto-switch mode on/off" },
			];
			const filtered = options.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args: any, ctx: any) => {
			const cfg = resolveConfig();
			const cloudProvider = cfg?.cloudProvider || DEFAULT_CLOUD_PROVIDER;
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

			const active = isLocalModel(ctx.model, cloudProvider);
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
		const cfg = resolveConfig();
		const cloudProvider = cfg?.cloudProvider || DEFAULT_CLOUD_PROVIDER;
		const wasCloud = !isLocalModel(event.previousModel, cloudProvider);
		const isCloud = !isLocalModel(event.model, cloudProvider);

		if (isCloud && !wasCloud) {
			// Switched to cloud (struggle-detected or manual).
			// Note: we can't distinguish here, so the flag is already set by promptToSwitchTurn if applicable.
			// Manual switches don't change the flag (it stays false).
			resetTaskState();
			ctx.ui.notify("✅ route-model: on cloud — monitoring off", "info");
		} else if (isLocalModel(event.model, cloudProvider) && wasCloud) {
			// User switched back to local — resume monitoring.
			// Clear the flag: this was a manual switch, so future cloud usage is user-intent.
			cloudSwitchWasFromStruggle = false;
			resetTaskState();
			ctx.ui.notify(
				"⚠️ route-model: back on local — monitoring for struggle",
				"info",
			);
		}
	});

	// ── Tool execution monitoring: track consecutive failures ──────

	pi.on("tool_execution_end", async (event: any, ctx: any) => {
		const cfg = resolveConfig();
		const cloudProvider = cfg?.cloudProvider || DEFAULT_CLOUD_PROVIDER;
		if (!isLocalModel(ctx.model, cloudProvider)) return;
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
		const cfg = resolveConfig();
		const cloudProvider = cfg?.cloudProvider || DEFAULT_CLOUD_PROVIDER;
		if (!isLocalModel(ctx.model, cloudProvider)) {
			// On cloud. If the extension switched here due to struggle detection,
			// offer to return to local now that the task is done.
			// If user manually switched, respect that intent and stay on cloud.
			if (cloudSwitchWasFromStruggle) {
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
			}
			return;
		}
		resetTaskState();
	});

	pi.on("turn_start", async (_event: { turnIndex: number }, _ctx: any) => {
		turnIndex++;
	});

	pi.on("turn_end", async (_event: { turnIndex: number }, ctx: any) => {
		const cfg = resolveConfig();
		const cloudProvider = cfg?.cloudProvider || DEFAULT_CLOUD_PROVIDER;
		if (!isLocalModel(ctx.model, cloudProvider)) return;
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
		const cfg = resolveConfig();
		const cloudProvider = cfg?.cloudProvider || DEFAULT_CLOUD_PROVIDER;
		if (!isLocalModel(ctx.model, cloudProvider)) return { action: "continue" };
		if (!cfg) return { action: "continue" };

		const lower = event.text.toLowerCase().trim();

		const isSwitchPhrase =
			lower === "switch to cloud" ||
			lower === "use cloud" ||
			lower === "cloud please" ||
			lower === "use the big model" ||
			lower.startsWith("please switch to cloud");

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
				`🔧 route-model: detected struggle (${turnState.turnIndex} turns) — switching to cloud`,
				"info",
			);
			// Mark this as a struggle-driven switch so before_agent_start can restore.
			cloudSwitchWasFromStruggle = true;
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
				"Switch to cloud to continue with more capability?",
			].join("\n");

			const choice = await ctx.ui.confirm("route-model", message);

			if (choice) {
				// User confirmed the struggle-driven switch.
				// Mark it so before_agent_start can restore.
				cloudSwitchWasFromStruggle = true;
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
		const cfg = resolveConfig();
		const localModel = findLocalModel(
			ctx.modelRegistry,
			cfg?.localModelIds,
			cfg?.cloudProvider,
		);
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
		// Clear the struggle flag: we're back on local after a detour.
		cloudSwitchWasFromStruggle = false;
		resetTaskState();
		ctx.ui.notify(
			`✅ route-model: switched back to local (${localModel.name || localModel.id})`,
			"info",
		);
		ctx.ui.setStatus("route-model", "Now on local");
	}

	async function doToggleModel(ctx: any, cfg: Config) {
		const cloudProvider = cfg.cloudProvider || DEFAULT_CLOUD_PROVIDER;
		const isCurrentlyLocal = isLocalModel(ctx.model, cloudProvider);

		if (isCurrentlyLocal) {
			const cloudModel = findCloudModel(
				ctx.modelRegistry,
				cloudProvider,
				cfg.cloudModelId,
			);
			if (!cloudModel) {
				ctx.ui.notify(
					`route-model: no ${cloudProvider} model found. Add one via /model first.`,
					"error",
				);
				return;
			}
			const success = await pi.setModel(cloudModel);
			if (!success) {
				ctx.ui.notify(
					`route-model: no API key for the ${cloudProvider} model. Check your config.`,
					"error",
				);
				return;
			}
			ctx.ui.notify("✅ route-model: switched to cloud", "info");
			ctx.ui.setStatus("route-model", "Now on cloud");
		} else {
			await switchToLocal(ctx);
		}
	}
}
