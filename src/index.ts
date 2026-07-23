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
 * Config is loaded from ../config/config.json (relative to config.ts).
 * If it's missing/invalid, monitoring disables itself with one warning
 * instead of crash-looping. Copy config/config.example.json to
 * config/config.json to get started.
 *
 * This file is intentionally thin: it just wires the pieces together.
 * See docs/ARCHITECTURE.md for the full design writeup, and:
 *   - types.ts                    Config, TurnState, AutocompleteItem
 *   - constants.ts                 shared default thresholds/provider
 *   - config.ts                     config loading + cloud provider resolution
 *   - model-utils.ts                 local/cloud model detection & lookup
 *   - struggle-detection.ts           struggle-phrase + tool-failure signals
 *   - task-state.ts                   mutable per-task/session state
 *   - actions.ts                       user-facing actions (switch/prompt/toggle)
 *   - handlers/lifecycle.ts             session/model/turn lifecycle handlers
 *   - handlers/interaction.ts            /route-model command + natural language
 */
import { createConfigResolver } from "./config";
import { registerLifecycleHandlers } from "./handlers/lifecycle";
import { registerInteractionHandlers } from "./handlers/interaction";
import { TaskState } from "./task-state";
import type { ExtensionAPI } from "./types";

export default function (pi: ExtensionAPI) {
	const configResolver = createConfigResolver();
	const taskState = new TaskState();

	registerLifecycleHandlers(pi, configResolver, taskState);
	registerInteractionHandlers(pi, configResolver, taskState);
}
