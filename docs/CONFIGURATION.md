# route-model Configuration

## Getting Started

1. Copy `config/config.example.json` to `config/config.json`:

   ```bash
   cp config/config.example.json config/config.json
   ```

2. Edit `config/config.json` to suit your setup

3. Reload Pi or restart the session for changes to take effect

## Configuration Reference

### `cloudModelId` (string, required)

The preferred cloud model to escalate to when local model struggles.

**Default**: `"claude-sonnet-4-5"`

**Notes**:

- Must be an Anthropic model (e.g., `claude-opus-4-5`, `claude-sonnet-4-5`)
- If the specified model is unavailable, route-model tries fallback models in this order:
  1. `claude-sonnet-4-5`
  2. `claude-sonnet-5`
  3. `claude-sonnet-4-6`
  4. `claude-opus-4-5`
  5. First available Anthropic model
- Requires valid Anthropic API key in Pi configuration

### `turnThreshold` (number, required)

Number of turns before the extension considers triggering an alert.

**Default**: `5`

**Notes**:

- Alert only triggers if threshold is **exceeded** AND at least one struggle signal is present
- Prevents false alarms on fast, legitimate multi-turn tasks
- Scoped to current task (resets on new user prompt)

### `toolFailureThreshold` (number, required)

Maximum consecutive tool failures before triggering an alert.

**Default**: `3`

**Notes**:

- Tracks the same tool failing in a row
- Resets when any tool succeeds
- Useful for catching silent failures (e.g., `read` command returning empty, `edit` failing repeatedly)

### `autoMode` (boolean, required)

Controls whether escalation happens automatically or with user confirmation.

**Default**: `true`

**Behavior**:

- `true` — when struggle is detected, automatically switch to cloud without asking
- `false` — show a dialog asking user to confirm cloud switch

**Recommendation**:

- Set to `true` if you trust the heuristics and want hands-off operation
- Set to `false` if you prefer control and want to review alerts before escalating

### `struggleConsecutive` (number, optional, unused)

Currently unused. Reserved for future refinement of consecutive-struggle detection logic.

**Default**: `2`

### `strugglePatterns` (string[], required)

Array of phrases (case-insensitive) that signal the model is uncertain or struggling.

**Default**:

```json
[
  "i'm not sure",
  "i'm not able",
  "i don't know",
  "could you clarify",
  "it might be",
  "let me try again",
  "let me attempt",
  "sorry i can't",
  "this is difficult",
  "i cannot determine",
  "i am unable",
  "perhaps",
  "i think you need"
]
```

**Notes**:

- Substring matches (case-insensitive) against assistant message content
- Multiple matches in one message all contribute to the alert
- Add patterns that are common in your use case
- Remove patterns that generate false positives

**Examples of patterns to add**:

- `"need more context"` — if your model says this often
- `"unclear requirements"` — if you see this flag incorrect escalations
- `"uncertain"` — direct synonym for struggle

## Environment & Integration

### API Keys

route-model requires an Anthropic API key in your Pi configuration for cloud escalation to work.

Set the key via Pi:

```bash
/model add claude-sonnet-4-5
```

### Local Model Setup

For monitoring to be active, you need a local model registered:

- **Ollama**, **LM Studio**, **OMLX**, or any non-Anthropic provider in Pi's model registry

If no local model is configured, route-model will show a warning at startup but won't crash.

### Multi-Provider Setup

route-model works with:

- **Local providers**: Ollama, LM Studio, OMLX, OpenAI (treated as local if non-Anthropic)
- **Cloud provider**: Anthropic (Claude models)

The extension automatically detects provider from `model.provider` field.

## Troubleshooting

### "config.json missing"

**Symptom**: Message appears on session start

```
route-model: config.json missing — copy config/config.example.json to config/config.json.
```

**Fix**:

```bash
cp config/config.example.json config/config.json
```

Then reload/restart your Pi session.

### "no cloud model found"

**Symptom**: Alert shows when trying to escalate to cloud

**Causes**:

1. Cloud model ID in config doesn't exist
2. Anthropic API key is missing or invalid
3. Fallback models aren't available

**Fix**:

- Verify `cloudModelId` matches a real Claude model
- Run `/model add claude-sonnet-4-5` to set up Anthropic
- Check your Anthropic API key is valid in Pi config

### "no local model found"

**Symptom**: When on cloud and trying to restore to local

**Cause**: No non-Anthropic model is registered in Pi

**Fix**:

```bash
/model add  # or search for your local provider (ollama, lm-studio, etc.)
```

### Too many false alerts

**Symptom**: Escalating to cloud too often on normal tasks

**Fix** (in order):

1. Increase `turnThreshold` (e.g., 5 → 8)
2. Remove over-sensitive patterns from `strugglePatterns`
   - Remove patterns like `"perhaps"` that appear in normal reasoning
3. Set `autoMode: false` to review each alert before escalating

### Never detects struggles

**Symptom**: Local model stuck for 20+ turns, no alert

**Possible causes**:

1. Struggle phrases don't match your model's output
2. Model fails tools silently without struggle phrases
3. `turnThreshold` is too high

**Fix**:

1. Add custom patterns to `strugglePatterns` that match your model's actual output
2. Lower `toolFailureThreshold` if you see repeated tool failures
3. Lower `turnThreshold` if you want earlier escalation

## Example Configurations

### Conservative (High Threshold, Explicit Approval)

```json
{
  "cloudModelId": "claude-opus-4-5",
  "turnThreshold": 10,
  "toolFailureThreshold": 5,
  "autoMode": false,
  "strugglePatterns": [
    "i'm not sure",
    "i cannot determine",
    "let me try again"
  ]
}
```

**Use case**: You trust your local model and only want cloud for truly stuck situations

### Aggressive (Low Threshold, Auto-Switch)

```json
{
  "cloudModelId": "claude-sonnet-4-5",
  "turnThreshold": 3,
  "toolFailureThreshold": 2,
  "autoMode": true,
  "strugglePatterns": [
    "i'm not sure",
    "i'm not able",
    "i don't know",
    "could you clarify",
    "it might be",
    "let me try again",
    "let me attempt",
    "sorry i can't",
    "this is difficult",
    "i cannot determine",
    "i am unable",
    "perhaps",
    "i think you need"
  ]
}
```

**Use case**: You want maximum capability, minimal manual intervention

### Balanced (Default)

```json
{
  "cloudModelId": "claude-sonnet-4-5",
  "turnThreshold": 5,
  "toolFailureThreshold": 3,
  "autoMode": true,
  "strugglePatterns": [
    "i'm not sure",
    "i'm not able",
    "i don't know",
    "could you clarify",
    "it might be",
    "let me try again",
    "let me attempt",
    "sorry i can't",
    "this is difficult",
    "i cannot determine",
    "i am unable",
    "perhaps",
    "i think you need"
  ]
}
```

**Use case**: Sensible defaults for most workflows
