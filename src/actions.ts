import { resolveCloudProvider } from "./config";
import { findCloudModel, findLocalModel, isLocalModel } from "./model-utils";
import type { TaskState } from "./task-state";
import type { Config, ExtensionAPI, TurnState } from "./types";

/**
 * Alert the user (or auto-switch) that the local model appears to be
 * struggling, based on the accumulated turn/struggle/tool-failure signals.
 */
export async function promptToSwitchTurn(
	pi: ExtensionAPI,
	ctx: any,
	cfg: Config,
	turnState: TurnState,
	taskState: TaskState,
): Promise<void> {
	if (!ctx.hasUI) return;

	if (cfg.autoMode) {
		ctx.ui.notify(
			`🔧 route-model: detected struggle (${turnState.turnIndex} turns) — switching to cloud`,
			"info",
		);
		// Call the switch directly (rather than round-tripping through the
		// /route-model command text) and mark it struggle-driven so
		// doToggleModel only records the flag if the switch actually succeeds.
		await doToggleModel(pi, ctx, cfg, taskState, true);
		return;
	}

	const message = buildStruggleAlertMessage(cfg, turnState);
	const choice = await ctx.ui.confirm("route-model", message);

	if (choice) {
		// User confirmed the struggle-driven switch.
		await doToggleModel(pi, ctx, cfg, taskState, true);
	} else {
		ctx.ui.notify(
			"route-model: will keep monitoring. Run '/route-model switch' anytime.",
			"info",
		);
	}
}

function buildStruggleAlertMessage(cfg: Config, turnState: TurnState): string {
	return [
		"🔧 **route-model**: Agent may be struggling…",
		"",
		`⏱️ ${turnState.turnIndex} turns burned this task (threshold: ${cfg.turnThreshold})`,
		buildStruggleSummary(turnState),
		turnState.toolFailures > 0
			? `🔴 ${turnState.toolFailures} consecutive tool failure(s)`
			: "",
		"",
		"Switch to cloud to continue with more capability?",
	].join("\n");
}

/** Build a human-readable reason string from whichever signals fired. */
function buildStruggleSummary(turnState: TurnState): string {
	if (turnState.struggleReasons.length > 0) {
		return `Detected uncertainty: "${turnState.struggleReasons[0]}"`;
	}
	if (turnState.toolFailures > 0) {
		return `${turnState.toolFailures} consecutive tool failure(s) without a successful call`;
	}
	return `Agent has been turning for ${turnState.turnIndex} turns on this task without a clean resolution`;
}

/** Switch to the configured (or first available) local model. */
export async function switchToLocal(
	pi: ExtensionAPI,
	ctx: any,
	cfg: Config | undefined,
	taskState: TaskState,
): Promise<void> {
	const localModel = findLocalModel(
		ctx.modelRegistry,
		cfg?.localModelIds,
		cfg?.cloudProvider,
	);
	if (!localModel) {
		ctx.ui?.notify(
			"route-model: no local model found. Add one via /model first.",
			"error",
		);
		return;
	}
	const success = await pi.setModel(localModel);
	if (!success) {
		ctx.ui?.notify("route-model: failed to switch to local model.", "error");
		return;
	}
	// Clear the struggle flag: we're back on local after a detour.
	taskState.setCloudSwitchWasFromStruggle(false);
	taskState.resetTask();
	ctx.ui?.notify(
		`✅ route-model: switched back to local (${localModel.name || localModel.id})`,
		"info",
	);
	ctx.ui?.setStatus("route-model", "Now on local");
}

/**
 * Toggle between local and cloud, used by `/route-model switch`.
 *
 * `fromStruggle` records why a local→cloud switch happened, but only once
 * the switch actually succeeds — a failed switch (no cloud model, no API
 * key) must NOT leave `cloudSwitchWasFromStruggle` set, otherwise a later,
 * unrelated manual switch to cloud would inherit a stale "struggle-driven"
 * attribution and get wrongly offered a restore-to-local prompt.
 */
export async function doToggleModel(
	pi: ExtensionAPI,
	ctx: any,
	cfg: Config,
	taskState: TaskState,
	fromStruggle = false,
): Promise<void> {
	const cloudProvider = resolveCloudProvider(cfg);
	const isCurrentlyLocal = isLocalModel(ctx.model, cloudProvider);

	if (!isCurrentlyLocal) {
		await switchToLocal(pi, ctx, cfg, taskState);
		return;
	}

	const cloudModel = findCloudModel(
		ctx.modelRegistry,
		cloudProvider,
		cfg.cloudModelId,
	);
	if (!cloudModel) {
		ctx.ui?.notify(
			`route-model: no ${cloudProvider} model found. Add one via /model first.`,
			"error",
		);
		return;
	}
	const success = await pi.setModel(cloudModel);
	if (!success) {
		ctx.ui?.notify(
			`route-model: no API key for the ${cloudProvider} model. Check your config.`,
			"error",
		);
		return;
	}
	// Only recorded now that the switch has actually succeeded.
	taskState.setCloudSwitchWasFromStruggle(fromStruggle);
	ctx.ui?.notify("✅ route-model: switched to cloud", "info");
	ctx.ui?.setStatus("route-model", "Now on cloud");
}
