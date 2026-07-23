# route-model Architecture

## Overview

**route-model** is a Pi extension that monitors local model performance during task execution and automatically escalates to a cloud model when the local model struggles. It then restores the local model after the task completes, respecting user intent when they manually switch models.

The core design principle: **Local for efficiency, cloud for capability.**

## Key State Tracking

### Per-Task State (reset on every new user prompt)

- `turnIndex` — counter of turns spent on current task
- `consecutiveStruggling` — how many turns in a row the model showed struggle signals
- `consecutiveToolFailures` — how many tool executions failed consecutively
- `lastFailureTag` — identifier of the last failing tool (to track streaks)
- `hasAlerted` — whether we've already shown an alert for this task
- `strugglingTurns` — array of messages that showed struggle patterns

### Session-Level State (persists across task boundaries)

- `cloudSwitchWasFromStruggle` — **critical flag** that tracks whether the most recent cloud switch came from extension-initiated escalation or user intent
  - `true` → extension detected struggle and switched to cloud → `before_agent_start` should offer to restore to local
  - `false` → user manually switched to cloud (or never switched) → respect their intent, stay on cloud

## Struggle Detection: Three Signals

The extension looks for struggle at three levels, **scoped to the current task**:

### 1. Turn Count

- Configured threshold (default: 5 turns)
- Simple: how many turns has the agent spent on this task?
- Resets on every new user prompt

### 2. Struggle Phrases

- Pattern matching on assistant messages
- Looks for phrases like: "I'm not sure", "let me try again", "it might be", "I cannot determine", etc.
- Case-insensitive substring match against 13 patterns in config
- Each matched phrase is recorded

### 3. Tool Failure Streak

- Tracks consecutive tool execution failures
- Only breaks when a tool succeeds
- Different tools failing reset the streak (we track by `failureTag`)
- Catches silent failures the model doesn't verbalize

**Alert triggers when**: `turnIndex >= turnThreshold` **AND** at least one of:

- `consecutiveStruggling >= 1` (any recent struggle phrase)
- `consecutiveToolFailures >= threshold` (consecutive tool failures)
- `turnIndex >= turnThreshold * 2` (double the threshold, give up)

## State Machine: Model Selection

### Rule: "If on cloud, stay on cloud. If on local, monitor."

### Transitions

**Local → Cloud (Struggle Escalation)**

1. `promptToSwitchTurn()` detects struggle signals exceed threshold
2. In auto-mode: immediately sets `cloudSwitchWasFromStruggle = true` and sends `/route-model switch`
3. In manual-mode: shows user a dialog; if confirmed, sets flag and sends command

**Cloud → Local (Restoration)**

1. `before_agent_start` fires on next user prompt
2. Checks: is model cloud AND `cloudSwitchWasFromStruggle == true`?
3. If both: offer to switch back to local (auto-mode) or ask user (manual-mode)
4. User accepts → calls `switchToLocal()` which sets `cloudSwitchWasFromStruggle = false`

**Manual Cloud Switch (User Intent)**

1. User runs `/route-model switch` while on local
2. `doToggleModel()` calls `pi.setModel(cloudModel)`
3. `model_select` event fires with `wasCloud = false, isCloud = true`
4. Handler resets task state but **does NOT set the flag**
5. `before_agent_start` sees cloud model with `cloudSwitchWasFromStruggle == false`
6. Handler returns early: **stays on cloud, no switch offered**

**Manual Local Switch (From Cloud)**

1. User runs `/route-model switch` while on cloud
2. `doToggleModel()` calls `switchToLocal()`
3. Sets `cloudSwitchWasFromStruggle = false` explicitly
4. `model_select` event fires
5. Resets task state, monitoring resumes
6. Next task: fresh local monitoring, no cloud detour assumptions

## Event Lifecycle

### Session Start

- `session_start` → load config, show startup banner
- Monitoring mode depends on current model

### Per-Turn Monitoring (when on local)

- `turn_start` → increment `turnIndex`
- `turn_end` → scan latest assistant message for struggle, update counters, check alert condition
- `tool_execution_end` → track success/failure streaks

### Natural Language Input (when on local)

- `input` → intercept phrases like "switch to cloud", "are you struggling?"
- Can convert natural language to `/route-model` commands

### Task Boundary

- `before_agent_start` → reset per-task state if staying on local
- If on cloud with struggle flag: offer to restore to local

### Model Changes

- `model_select` → track local ↔ cloud transitions, update flag, reset task state

## Command System

### `/route-model switch`

- Toggles between current model and preferred cloud/local
- Internally calls `doToggleModel()`

### `/route-model auto`

- Toggles `config.autoMode` on/off
- Controls whether escalation is automatic or asks user

### `/route-model` (status)

- Shows current state: model type, auto-mode, thresholds, current turn/struggle/failure counts
- Used for debugging and awareness

## Config Integration

Config is loaded from `config/config.json` relative to the source file:

- `cloudProvider` — cloud provider name (optional, default "anthropic")
- `cloudModelId` — preferred cloud model ID (required)
- `localModelIds` — preferred local models in fallback order (optional, defaults to first available)
- `turnThreshold` — triggers alert at N turns (default 5)
- `struggleConsecutive` — unused (kept for future refinement)
- `toolFailureThreshold` — triggers alert at N consecutive failures (default 3)
- `autoMode` — auto-switch vs ask user
- `strugglePatterns` — array of phrase patterns to detect

If config is missing/invalid, monitoring disables with a warning instead of crashing.

## Key Design Decisions

1. **No session-start intent tracking** — Don't try to remember if the session "started on cloud". Instead, track whether the most recent cloud switch was struggle-driven or user-initiated.

2. **Flag-based state machine** — `cloudSwitchWasFromStruggle` is the single source of truth for "should we offer to restore?"

3. **Per-task scope** — Struggle signals reset on every new user prompt. Enables independent monitoring of multiple unrelated tasks in one session.

4. **No forced local switches** — Once a user is on cloud, the extension only offers to switch back if it was the one that escalated. Otherwise, cloud is treated as intentional.

5. **Model registry abstraction** — Cloud/local detection uses provider names, not model IDs. Allows fallback cloud models and provider-agnostic code.

## Error Handling

- Config load failure → one warning, monitoring disabled, no crash-loop
- Model switch failure → user notification with reason (missing API key, no model found)
- Tool failures gracefully tracked without affecting turn progression
