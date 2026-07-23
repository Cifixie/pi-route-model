# route-model Commands & Natural Language

## CLI Commands

All commands start with `/route-model` and support autocomplete.

### `/route-model switch`

**Description**: Toggle between local and cloud model

**When to use**:

- You're on local and want to manually escalate to cloud without waiting for struggle detection
- You're on cloud and want to return to local immediately
- You want to test cloud capability for a task

**Example**:

```
You: /route-model switch
route-model: switched to cloud
```

**Behavior**:

- If on local → switches to configured cloud model
- If on cloud → switches to default local model
- Clears the struggle flag (cloud switch is now treated as user intent if going to local)

### `/route-model auto`

**Description**: Toggle auto-switch mode on/off

**When to use**:

- You want to switch between automatic escalation and manual confirmation
- You're in a context where you need explicit control
- You want hands-off operation after a manual override

**Example**:

```
You: /route-model auto
route-model: auto-switch OFF — will ask before switching
```

Next alert will show a dialog instead of auto-switching.

```
You: /route-model auto
route-model: auto-switch ON — will switch automatically
```

Next alert will automatically escalate without confirmation.

**Current state**: Display-only in default behavior

- Toggle is persistent only during session
- Restart Pi to revert to config value

### `/route-model` (no args)

**Description**: Show status and settings

**When to use**:

- You want to see current model, turn count, struggle status
- You want to verify auto-mode setting
- Debugging: checking why an alert did/didn't trigger

**Example output**:

```
🔧 route-model status

Model:     🟡 Local (monitoring ON)
Auto-mode: ✅ ON (switches automatically)
Threshold: 5 turns
Tool fail threshold: 3 consecutive
Struggling turns: 0 consecutive
Tool failures:  2 consecutive
Turns this task: 3
✅ No alert yet

'/route-model switch' — toggle model
'/route-model auto'   — toggle auto-switch
```

**Status meanings**:

- 🟡 Local = monitoring is active
- 🟢 Cloud = monitoring is off (cloud assumed to handle it)
- Struggling turns = count of consecutive turns with struggle phrases
- Tool failures = consecutive tool execution failures
- Turns this task = reset on each new user prompt

## Natural Language Shortcuts

route-model intercepts common phrases and converts them to commands.

### Model Switching Phrases

Trigger automatic cloud switch without typing `/route-model switch`:

```
You: switch to cloud
→ Internally: /route-model switch

You: use cloud
→ Internally: /route-model switch

You: cloud please
→ Internally: /route-model switch

You: use the big model
→ Internally: /route-model switch

You: please switch to cloud
→ Internally: /route-model switch
```

**Works when**: You're on local model
**Result**: Immediately switches to cloud, sets flag to false (user-initiated)

### Struggle Status Queries

Ask route-model if it thinks you're struggling:

```
You: are you struggling?
→ route-model reports: "no — 3 turn(s) so far this task, seems on track"

You: do you think we're stuck?
→ route-model reports: "yes — 2 consecutive struggling turn(s) this task"

You: is it having trouble?
→ route-model reports: "no — task just started"
```

**Pattern**: Must contain a form of "are/do/is + subject" AND "struggle/stuck/trouble/can't handle/out of depth"

**Works when**: You're on local model
**Result**: Shows current assessment without triggering any action
**Use case**: Check if route-model agrees with your intuition before asking for manual escalation

## Session Notifications

### On Session Start

```
🔧 route-model: watching local model performance
```

Monitoring is active on local model.

```
☁️ route-model: using cloud model — monitoring off
```

On cloud, no monitoring (cloud assumed to have sufficient capability).

### On Model Switch (Automatic)

```
🔧 route-model: detected struggle (5 turns) — switching to cloud
```

Auto-mode escalation in progress. (Only shown if `autoMode: true`)

```
⚠️ route-model: switched to local model — monitoring for struggle
```

Successfully switched to local. Monitoring resumes.

```
✅ route-model: on cloud — monitoring off
```

Successfully switched to cloud. Monitoring paused.

### On Alert (Manual Mode)

```
🔧 **route-model**: Agent may be struggling…

⏱️ 5 turns burned this task (threshold: 5)
Detected uncertainty: "i'm not sure"

Switch to cloud to continue with more capability?

[Yes] [No]
```

**Yes**: Sets flag, escalates to cloud
**No**: Continues monitoring, message displayed: "will keep monitoring. Run '/route-model switch' anytime."

### On Task Boundary (After Cloud Escalation)

If `cloudSwitchWasFromStruggle == true`:

**Auto-mode**:

```
route-model: new task, switching back to local
```

Automatically restores to local.

**Manual-mode**:

```
route-model: New task starting — switch back to local model?

[Yes] [No]
```

## Workflow Examples

### Example 1: Auto-Mode, Automatic Escalation & Restoration

```
You: Solve this puzzle...
[Local model thinks for 5 turns, shows "I'm not sure"]

route-model: detected struggle (5 turns) — switching to cloud
route-model: switched to cloud — monitoring off

[Cloud model solves it]

You: Next task...
route-model: new task, switching back to local
[Local model handles next task]
```

### Example 2: Manual-Mode, User Confirms Escalation

```
You: Solve this puzzle...
[Local model turns 5, shows "let me try again"]

route-model: **Agent may be struggling…**
⏱️ 5 turns burned this task (threshold: 5)
Detected uncertainty: "let me try again"
Switch to cloud? [Yes] [No]

You: Yes

route-model: switched to cloud — monitoring off
[Cloud model solves it]

You: Next task...

route-model: New task starting — switch back to local model?
[Yes] [No]

You: Yes

route-model: switched back to local
```

### Example 3: Manual Cloud Switch (User Intent)

```
You: /route-model switch
route-model: switched to cloud — monitoring off

[Cloud model works on task]

You: Let me stay on cloud for a bit...
You: Another task on cloud...

route-model: [no restore offer - user chose cloud]

You: /route-model switch
route-model: switched back to local — monitoring for struggle
```

### Example 4: Natural Language Escalation

```
You: I think we should try the cloud model for this one
route-model: [detects you're on local, listens for model switch phrases]

You: use cloud
route-model: [internally: /route-model switch]
route-model: switched to cloud — monitoring off
```

### Example 5: Checking Status

```
You: are you struggling?
route-model assessment: no — 2 turn(s) so far this task, seems on track

[Keep working on local...]

You: /route-model
[Shows full status with turn count, thresholds, failure count]
```

## Error Handling in Commands

### If cloud model is unavailable

```
You: /route-model switch
route-model: no cloud model found. Add one via /model first.
```

**Fix**: Run `/model add claude-sonnet-4-5` to register Anthropic

### If local model is unavailable

```
You: /route-model switch
route-model: no local model found. Add one via /model first.
```

**Fix**: Run `/model add` to search and add a local model (Ollama, LM Studio, etc.)

### If Anthropic API key is missing

```
route-model: no API key for the cloud model. Check your config.
```

**Fix**: Ensure Anthropic API key is set in Pi configuration

## Command Autocomplete

When typing `/route-model`, tab-complete shows:

```
/route-model switch  — Toggle between local and cloud
/route-model auto    — Toggle auto-switch mode on/off
```

Use arrow keys to navigate, Enter to select.

## Integration with `/model` Command

route-model respects Pi's global `/model` command:

```
You: /model list
[Shows available local and cloud models]

You: /model set claude-sonnet-4-5
[Sets cloud preference; route-model notices and uses it]

You: /model set ollama/llama2
[Sets local preference; route-model notices and uses it]
```

route-model doesn't override `/model` selections; it orchestrates switching based on struggle detection, using whatever models are registered.
