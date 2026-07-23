# route-model Configuration

## Getting Started

1. Copy `config/config.example.json` to `config/config.json`:

   ```bash
   cp config/config.example.json config/config.json
   ```

2. Edit `config/config.json` to suit your setup

3. Reload Pi or restart the session for changes to take effect

## Configuration Reference

### `cloudProvider` (string, optional)

The name of the cloud provider to use for escalation.

**Default**: `"anthropic"`

**Examples**:

- `"anthropic"` — use Anthropic Claude models
- `"openai"` — use OpenAI models (GPT-4, etc.)
- `"deepseek"` — use DeepSeek models
- Any provider supported by Pi's model registry

**Notes**:

- This determines which provider is considered the "cloud" provider
- All other providers are treated as "local" for escalation purposes
- The extension will try to find a model from this provider when escalating
- If omitted, defaults to "anthropic" for backward compatibility

### `cloudModelId` (string, required)

The preferred cloud model to escalate to when local model struggles.

**Default**: `"claude-sonnet-4-5"`

**Notes**:

- Must be a model ID belonging to your configured `cloudProvider` (default: Anthropic, e.g. `claude-opus-4-5`, `claude-sonnet-4-5`)
- If the specified model ID isn't found, route-model falls back to the first available model from `cloudProvider`
- Requires a valid API key for `cloudProvider` in Pi configuration

### `localModelIds` (string[], optional)

Preferred local models to use when monitoring is active or after restoration from cloud.

**Default**: `undefined` (uses first available local model)

**Example**:

```json
"localModelIds": [
  "ollama/mistral",
  "ollama/llama2",
  "lmstudio/my-model"
]
```

**Behavior**:

- route-model tries each model ID in order
- Uses the first one available in your Pi model registry
- If none are available, falls back to searching by known local-provider names (Ollama, LM Studio, OMLX) — excluding whichever one is currently your configured `cloudProvider`
- Finally, uses any model that isn't from `cloudProvider` as a last resort

**Use case**:

- You have multiple local models and want a specific one preferred
- You want fallback models if your primary is offline
- You want deterministic model selection instead of "first available"

**How to find your model IDs**:

```bash
/model list  # Shows registered models and their IDs
```

**Notes**:

- IDs are usually in format `provider/model-name` (e.g., `ollama/mistral`)
- Empty array `[]` is treated as undefined (uses defaults)
- Order matters: earlier models are tried first

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

**Note**: toggling this at runtime via `/route-model auto` writes the change back to `config/config.json` immediately — it's not lost on the next restart.

### `struggleConsecutive` (number, optional)

Minimum number of consecutive struggling turns required before the struggle-phrase signal counts toward the alert. Set to `1` to alert on the very first struggle phrase.

**Default**: `2`

**Notes**:

- Only gates the struggle-*phrase* signal — tool-failure streaks and the double-turn-threshold backstop are unaffected
- Falls back to the default if omitted or not a number

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

route-model requires a valid API key for your configured `cloudProvider` (default: Anthropic) in your Pi configuration for cloud escalation to work.

Set the key via Pi, e.g. for the default Anthropic provider:

```bash
/model add claude-sonnet-4-5
```

If you set `cloudProvider` to something else (e.g. `"openai"`), register a model from that provider instead:

```bash
/model add gpt-4  # example for cloudProvider: "openai"
```

### Local Model Setup

For monitoring to be active, you need at least one model registered from a provider **other than** your configured `cloudProvider`:

- **Ollama**, **LM Studio**, **OMLX**, or any other provider in Pi's model registry that isn't `cloudProvider`

If no local model is configured, route-model will show a warning at startup but won't crash.

### Multi-Provider Setup

route-model works with any providers registered in Pi:

- **Local providers**: anything that is NOT the configured `cloudProvider` — Ollama, LM Studio, OMLX, a self-hosted OpenAI-compatible server, etc.
- **Cloud provider**: whatever you set `cloudProvider` to (default: Anthropic / Claude models)

**Note**: the `findLocalModel()` fallback-by-provider-name search only tries `ollama`, `lmstudio`, and `omlx` by name (excluding your `cloudProvider` if it happens to collide). It intentionally does **not** treat `"openai"` as inherently local, since `openai` is just as often a *cloud* provider — if your only local setup is an OpenAI-compatible server, pin it explicitly via `localModelIds` instead of relying on the fallback.

The extension determines local vs. cloud by comparing `model.provider` against the configured `cloudProvider` (case-insensitive **exact** match — not a substring match, so a local OpenAI-compatible server won't be misclassified as cloud just because its provider name contains "openai"). See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

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

1. Cloud model ID in config doesn't exist for your configured `cloudProvider`
2. API key for `cloudProvider` is missing or invalid
3. No model from `cloudProvider` is registered at all

**Fix**:

- Verify `cloudModelId` matches a real model for your `cloudProvider`
- Run `/model add <model-id>` to register a model from that provider
- Check your API key for `cloudProvider` is valid in Pi config

### "no local model found"

**Symptom**: When on cloud and trying to restore to local

**Cause**: No model from a provider other than `cloudProvider` is registered in Pi

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
