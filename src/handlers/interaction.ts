import { doToggleModel } from "../actions";
import {
	persistConfig,
	resolveCloudProvider,
	type ConfigResolver,
} from "../config";
import { DEFAULT_TOOL_FAILURE_THRESHOLD } from "../constants";
import { isLocalModel } from "../model-utils";
import type { TaskState } from "../task-state";
import type { AutocompleteItem, Config, ExtensionAPI } from "../types";

/** Registers the `/route-model` command and natural-language input shortcuts. */
export function registerInteractionHandlers(
	pi: ExtensionAPI,
	configResolver: ConfigResolver,
	taskState: TaskState,
): void {
	registerStatusCommand(pi, configResolver, taskState);
	registerNaturalLanguageInput(pi, configResolver, taskState);
}

function registerStatusCommand(
	pi: ExtensionAPI,
	configResolver: ConfigResolver,
	taskState: TaskState,
): void {
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
			const cfg = configResolver.resolve();
			if (!cfg) {
				ctx.ui?.notify(
					"route-model: config.json missing — copy config/config.example.json to config/config.json.",
					"warning",
				);
				return;
			}

			const arg = String(args).trim();

			if (arg === "switch") {
				await doToggleModel(pi, ctx, cfg, taskState);
				return;
			}
			if (arg === "auto") {
				toggleAutoMode(cfg, ctx);
				return;
			}
			showStatus(ctx, cfg, taskState);
		},
	});
}

function toggleAutoMode(cfg: Config, ctx: any): void {
	cfg.autoMode = !cfg.autoMode;
	// Persist so the toggle survives past this session instead of quietly
	// reverting to the file's old value on the next restart.
	persistConfig(cfg);
	ctx.ui?.notify(
		`🔧 route-model: auto-switch ${cfg.autoMode ? "ON — will switch automatically" : "OFF — will ask before switching"}`,
		"info",
	);
	ctx.ui?.setStatus("route-model", cfg.autoMode ? "auto ON" : "auto OFF");
}

function showStatus(ctx: any, cfg: Config, taskState: TaskState): void {
	const cloudProvider = resolveCloudProvider(cfg);
	const active = isLocalModel(ctx.model, cloudProvider);
	ctx.ui?.notify(
		[
			"🔧 route-model status",
			"",
			`Model:     ${active ? "🟡 Local (monitoring ON)" : "🟢 Cloud (monitoring OFF)"}`,
			`Auto-mode: ${cfg.autoMode ? "✅ ON (switches automatically)" : "🔕 OFF (asks first)"}`,
			`Threshold: ${cfg.turnThreshold} turns`,
			`Tool fail threshold: ${cfg.toolFailureThreshold ?? DEFAULT_TOOL_FAILURE_THRESHOLD} consecutive`,
			`Struggling turns: ${taskState.consecutiveStruggling} consecutive`,
			`Tool failures:  ${taskState.consecutiveToolFailures} consecutive`,
			`Turns this task: ${taskState.turnIndex}`,
			taskState.hasAlerted
				? "⚠️ Alert was shown for this task"
				: "✅ No alert yet",
			"",
			"'/route-model switch' — toggle model",
			"'/route-model auto'   — toggle auto-switch",
		].join("\n"),
		"info",
	);
}

/** Intercepts common phrases like "switch to cloud" or "are you struggling?". */
function registerNaturalLanguageInput(
	pi: ExtensionAPI,
	configResolver: ConfigResolver,
	taskState: TaskState,
): void {
	pi.on("input", async (event: any, ctx: any) => {
		const cfg = configResolver.resolve();
		if (!cfg) return { action: "continue" };
		const cloudProvider = resolveCloudProvider(cfg);
		const currentlyLocal = isLocalModel(ctx.model, cloudProvider);

		const lower = event.text.toLowerCase().trim();

		// Only intercept a switch phrase in the direction that's actually
		// possible right now: "switch to cloud" while on local, "switch to
		// local" while on cloud. Previously only the cloud-direction phrases
		// were recognized at all, so there was no natural-language way back.
		if (currentlyLocal && isSwitchToCloudPhrase(lower)) {
			pi.sendUserMessage("/route-model switch", { deliverAs: "followUp" });
			return { action: "handled" };
		}
		if (!currentlyLocal && isSwitchToLocalPhrase(lower)) {
			pi.sendUserMessage("/route-model switch", { deliverAs: "followUp" });
			return { action: "handled" };
		}

		// Struggle status is only meaningful while monitoring (i.e. on local).
		if (currentlyLocal && isStruggleQuery(lower)) {
			ctx.ui?.notify(
				`route-model assessment: ${describeStruggleStatus(taskState)}`,
				"info",
			);
			return { action: "handled" };
		}

		return { action: "continue" };
	});
}

function isSwitchToCloudPhrase(lower: string): boolean {
	return (
		lower === "switch to cloud" ||
		lower === "use cloud" ||
		lower === "cloud please" ||
		lower === "use the big model" ||
		lower.startsWith("please switch to cloud")
	);
}

function isSwitchToLocalPhrase(lower: string): boolean {
	return (
		lower === "switch to local" ||
		lower === "use local" ||
		lower === "local please" ||
		lower === "use the local model" ||
		lower.startsWith("please switch to local")
	);
}

function isStruggleQuery(lower: string): boolean {
	return (
		/(?:are|do you|is it|is the|seem)/i.test(lower) &&
		/(?:struggling|stuck|having trouble|can't handle|out of depth)/i.test(lower)
	);
}

function describeStruggleStatus(taskState: TaskState): string {
	if (taskState.consecutiveStruggling > 0) {
		return `yes — ${taskState.consecutiveStruggling} consecutive struggling turn(s) this task`;
	}
	if (taskState.turnIndex > 0) {
		return `no — ${taskState.turnIndex} turn(s) so far this task, seems on track`;
	}
	return "no — task just started";
}
