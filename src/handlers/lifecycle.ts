import { promptToSwitchTurn, switchToLocal } from "../actions";
import { resolveCloudProvider, type ConfigResolver } from "../config";
import {
	DEFAULT_STRUGGLE_CONSECUTIVE,
	DEFAULT_TOOL_FAILURE_THRESHOLD,
} from "../constants";
import { isLocalModel } from "../model-utils";
import { detectStruggle, failureTag } from "../struggle-detection";
import type { TaskState } from "../task-state";
import type { Config, ExtensionAPI, TurnState } from "../types";

/**
 * Registers all handlers that track model state across the session/task
 * lifecycle: session start, model switches, tool failures, task
 * boundaries, and per-turn struggle evaluation.
 */
export function registerLifecycleHandlers(
	pi: ExtensionAPI,
	configResolver: ConfigResolver,
	taskState: TaskState,
): void {
	registerSessionStart(pi, configResolver, taskState);
	registerModelTracking(pi, configResolver, taskState);
	registerToolFailureTracking(pi, configResolver, taskState);
	registerTaskBoundary(pi, configResolver, taskState);
	registerTurnTracking(pi, configResolver, taskState);
}

function registerSessionStart(
	pi: ExtensionAPI,
	configResolver: ConfigResolver,
	taskState: TaskState,
): void {
	pi.on("session_start", async (_event: { reason: string }, ctx: any) => {
		taskState.resetTask();
		configResolver.reset();
		const cfg = configResolver.resolve();
		const cloudProvider = resolveCloudProvider(cfg);
		if (!cfg) {
			ctx.ui?.notify(
				"route-model: config.json missing — copy config/config.example.json to config/config.json.",
				"warning",
			);
			return;
		}
		ctx.ui?.notify(
			isLocalModel(ctx.model, cloudProvider)
				? "🔧 route-model: watching local model performance"
				: "☁️ route-model: using cloud model — monitoring off",
			"info",
		);
	});
}

/**
 * Tracks local <-> cloud transitions: resets per-task state on any switch,
 * and clears the cloudSwitchWasFromStruggle flag when the user manually
 * returns to local (future cloud usage is then treated as user intent).
 */
function registerModelTracking(
	pi: ExtensionAPI,
	configResolver: ConfigResolver,
	taskState: TaskState,
): void {
	pi.on("model_select", async (event: any, ctx: any) => {
		const cfg = configResolver.resolve();
		const cloudProvider = resolveCloudProvider(cfg);
		const wasCloud = !isLocalModel(event.previousModel, cloudProvider);
		const isCloud = !isLocalModel(event.model, cloudProvider);

		if (isCloud && !wasCloud) {
			// Switched to cloud (struggle-detected or manual). doToggleModel
			// already recorded cloudSwitchWasFromStruggle for this switch (and
			// only if it actually succeeded) before this event fires — this
			// handler only needs to reset the per-task counters.
			taskState.resetTask();
			ctx.ui?.notify("✅ route-model: on cloud — monitoring off", "info");
		} else if (isLocalModel(event.model, cloudProvider) && wasCloud) {
			// User switched back to local — resume monitoring. Clear the flag:
			// this was a manual switch, so future cloud usage is user-intent.
			taskState.setCloudSwitchWasFromStruggle(false);
			taskState.resetTask();
			ctx.ui?.notify(
				"⚠️ route-model: back on local — monitoring for struggle",
				"info",
			);
		}
	});
}

/** Tracks consecutive tool failures while on a local model. */
function registerToolFailureTracking(
	pi: ExtensionAPI,
	configResolver: ConfigResolver,
	taskState: TaskState,
): void {
	pi.on("tool_execution_end", async (event: any, ctx: any) => {
		const cfg = configResolver.resolve();
		const cloudProvider = resolveCloudProvider(cfg);
		if (!isLocalModel(ctx.model, cloudProvider)) return;
		taskState.recordToolResult(Boolean(event.isError), failureTag(event));
	});
}

/**
 * On every new user prompt: if on cloud and the switch was struggle-driven,
 * offer to restore to local now that the previous task is done. If on
 * local, just reset per-task counters and keep monitoring.
 */
function registerTaskBoundary(
	pi: ExtensionAPI,
	configResolver: ConfigResolver,
	taskState: TaskState,
): void {
	pi.on("before_agent_start", async (_event: any, ctx: any) => {
		const cfg = configResolver.resolve();
		const cloudProvider = resolveCloudProvider(cfg);

		if (!isLocalModel(ctx.model, cloudProvider)) {
			await offerRestoreToLocal(pi, ctx, cfg, taskState);
			return;
		}
		taskState.resetTask();
	});
}

async function offerRestoreToLocal(
	pi: ExtensionAPI,
	ctx: any,
	cfg: Config | undefined,
	taskState: TaskState,
): Promise<void> {
	// If user manually switched to cloud, respect that intent and stay put.
	if (!taskState.cloudSwitchWasFromStruggle) return;
	if (!cfg) return;

	if (cfg.autoMode) {
		await switchToLocal(pi, ctx, cfg, taskState);
		return;
	}
	// Manual mode needs a confirm dialog — without a UI we can't ask, so
	// leave the user on cloud rather than silently switching them back.
	if (!ctx.hasUI) return;
	const ok = await ctx.ui.confirm(
		"route-model",
		"New task starting — switch back to local model?",
	);
	if (ok) await switchToLocal(pi, ctx, cfg, taskState);
}

/** Counts turns and evaluates struggle signals at the end of each turn. */
function registerTurnTracking(
	pi: ExtensionAPI,
	configResolver: ConfigResolver,
	taskState: TaskState,
): void {
	pi.on("turn_start", async (_event: { turnIndex: number }, _ctx: any) => {
		taskState.incrementTurn();
	});

	pi.on("turn_end", async (_event: { turnIndex: number }, ctx: any) => {
		const cfg = configResolver.resolve();
		const cloudProvider = resolveCloudProvider(cfg);
		if (!isLocalModel(ctx.model, cloudProvider)) return;
		if (!cfg) return;

		const turnState = evaluateTurn(ctx, cfg, taskState);
		const shouldAlert = shouldAlertForTurn(cfg, taskState);

		if (shouldAlert && !taskState.hasAlerted) {
			taskState.markAlerted();
			await promptToSwitchTurn(pi, ctx, cfg, turnState, taskState);
		}
	});
}

/** Inspects the latest assistant message for struggle phrases and updates state. */
function evaluateTurn(ctx: any, cfg: Config, taskState: TaskState): TurnState {
	const allEntries = ctx.sessionManager.getBranch();
	const latestAssistant = [...allEntries]
		.reverse()
		.find((e: any) => e.type === "message" && e.message?.role === "assistant");

	let struggleReasons: string[] = [];
	if (latestAssistant?.type === "message" && latestAssistant.message) {
		struggleReasons = detectStruggle(latestAssistant.message, cfg);
	}

	const isStruggling = taskState.recordStruggle(struggleReasons);

	return {
		turnIndex: taskState.turnIndex,
		isStruggling,
		struggleReasons,
		toolFailures: taskState.consecutiveToolFailures,
	};
}

function shouldAlertForTurn(cfg: Config, taskState: TaskState): boolean {
	const toolFailureCount =
		cfg.toolFailureThreshold ?? DEFAULT_TOOL_FAILURE_THRESHOLD;
	const struggleCount = cfg.struggleConsecutive ?? DEFAULT_STRUGGLE_CONSECUTIVE;

	return (
		taskState.turnIndex >= cfg.turnThreshold &&
		(taskState.consecutiveStruggling >= struggleCount ||
			taskState.consecutiveToolFailures >= toolFailureCount ||
			taskState.turnIndex >= cfg.turnThreshold * 2)
	);
}
