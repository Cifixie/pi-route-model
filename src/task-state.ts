/**
 * Mutable state for the extension. Most fields are scoped to the CURRENT
 * task and reset on every new user prompt (see resetTask()) — turn/struggle
 * counting never carries over between unrelated tasks.
 *
 * `cloudSwitchWasFromStruggle` is the one field that survives resetTask():
 * it tracks whether the most recent cloud switch came from struggle
 * detection (true) or user intent (false), which before_agent_start uses
 * to decide whether to offer restoring to local.
 */
export class TaskState {
	turnIndex = 0;
	consecutiveStruggling = 0;
	consecutiveToolFailures = 0;
	lastFailureTag = "";
	hasAlerted = false;
	cloudSwitchWasFromStruggle = false;

	/** Reset everything scoped to the current task. */
	resetTask(): void {
		this.turnIndex = 0;
		this.consecutiveStruggling = 0;
		this.consecutiveToolFailures = 0;
		this.lastFailureTag = "";
		this.hasAlerted = false;
	}

	incrementTurn(): void {
		this.turnIndex++;
	}

	/** Track consecutive tool failures; any success breaks the streak. */
	recordToolResult(isError: boolean, tag: string): void {
		if (!isError) {
			this.consecutiveToolFailures = 0;
			this.lastFailureTag = "";
			return;
		}
		if (tag === this.lastFailureTag) {
			this.consecutiveToolFailures++;
		} else {
			// Different tool failed — start a new streak.
			this.consecutiveToolFailures = 1;
			this.lastFailureTag = tag;
		}
	}

	/**
	 * Record whether the latest assistant turn showed struggle phrases.
	 * Returns whether this turn was struggling (used to build a TurnState).
	 */
	recordStruggle(reasons: string[]): boolean {
		const isStruggling = reasons.length > 0;
		this.consecutiveStruggling = isStruggling
			? this.consecutiveStruggling + 1
			: 0;
		return isStruggling;
	}

	markAlerted(): void {
		this.hasAlerted = true;
	}

	/** Set whenever a cloud switch happens, struggle-driven or not. */
	setCloudSwitchWasFromStruggle(fromStruggle: boolean): void {
		this.cloudSwitchWasFromStruggle = fromStruggle;
	}
}
