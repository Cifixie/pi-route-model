# route-model Troubleshooting Guide

## Diagnosis: Using Status Commands

Before troubleshooting, gather information:

```bash
/route-model          # Shows current state, turn count, struggle status
/route-model auto     # Shows current auto-mode setting
/model list           # Shows registered models (local and cloud)
```

## Common Issues

### Extension Doesn't Load or Disable Warning

**Symptom**:

```
route-model: config.json missing — copy config/config.example.json to config/config.json.
```

**Cause**: Configuration file is missing

**Fix**:

```bash
cd /Users/tommi/.pi/agent/extensions/route-model
cp config/config.example.json config/config.json
```

Then restart Pi or reload the session.

**Verify**: Run `/route-model` — should show status instead of warning

---

### Extension Loads but Never Detects Struggle

**Symptoms**:

- Model works for 10+ turns on a hard task
- No alert appears
- Status shows `Turns this task: 10+` but `Struggling turns: 0`

**Causes** (in order of likelihood):

1. **Struggle patterns don't match your model's output**
   - Your model doesn't say "I'm not sure", it says "Hmm, this is tricky"
   - Tool failures are happening but not together

2. **Turn threshold is too high**
   - Default is 5, but complex tasks can legitimately need 10+ turns

3. **autoMode is off and you're not seeing dialogs**
   - Manual mode requires model to show struggle phrase first

**Diagnosis**:

1. Enable debug mode: check `/route-model` status after each turn
2. Look at what your model actually says when it's stuck
3. Check tool failure count — if it's high, lower `toolFailureThreshold`

**Fixes** (in order):

**Option A: Add custom struggle patterns**

Edit `config/config.json`, add patterns matching your model:

```json
"strugglePatterns": [
  "this is tricky",
  "hmm",
  "not sure how to",
  "need to think about this"
]
```

**Option B: Lower thresholds**

```json
{
  "turnThreshold": 3,           // from 5
  "toolFailureThreshold": 2      // from 3
}
```

**Option C: Check tool failures**

Run `/route-model` after a failed tool call. If `Tool failures: 2+`, the extension is detecting struggles but not escalating because turn threshold isn't reached. Increase `turnThreshold` to trigger at fewer turns:

```json
"turnThreshold": 3
```

---

### Extensions Escalates Too Easily (False Positives)

**Symptoms**:

- Every task escalates to cloud
- Phrases like "perhaps" are triggering alerts on normal reasoning
- Cloud model not needed for legitimate fast tasks

**Cause**: Struggle patterns are too broad, or thresholds too low

**Fixes**:

**Option A: Remove over-sensitive patterns**

Edit `config.json`. Remove patterns like:

- `"perhaps"` — appears in normal reasoning
- `"might"` — common in conditional statements
- `"could"` — appears in suggestions

Keep only high-confidence patterns:

```json
"strugglePatterns": [
  "i'm not sure",
  "i'm not able",
  "i don't know",
  "let me try again",
  "i cannot determine"
]
```

**Option B: Increase turn threshold**

```json
"turnThreshold": 8  // from 5 — wait longer before escalating
```

**Option C: Increase tool failure threshold**

```json
"toolFailureThreshold": 5  // from 3 — need more consecutive failures
```

**Option D: Disable auto-mode**

```json
"autoMode": false
```

Now you'll see dialogs and can reject false positive alerts.

---

### Cloud Model Not Available (Escalation Fails)

**Symptom**:

```
route-model: no cloud model found. Add one via /model first.
```

**Cause**: Anthropic model not registered in Pi

**Fix**:

```bash
/model add claude-sonnet-4-5
# Follow prompts to add your Anthropic API key
```

**Verify**:

```bash
/model list
# Should show at least one "claude-" model available
```

Then try `/route-model switch` manually to test.

---

### API Key Error During Escalation

**Symptom**:

```
route-model: no API key for the cloud model. Check your config.
```

**Cause**: Anthropic API key is missing or expired

**Check**:

```bash
/model list  # Does Anthropic model show? (might not validate key)
```

**Fix**:

1. Verify your Anthropic API key is valid at <https://console.anthropic.com>
2. In Pi, re-add the model:

   ```bash
   /model add claude-sonnet-4-5
   # Re-enter your API key
   ```

**Test**: Try `/route-model switch` to see if connection works

---

### Local Model Not Available (Restoration Fails)

**Symptom** (after cloud switch):

```
route-model: no local model found. Add one via /model first.
```

**Cause**: No local (non-Anthropic) model is registered

**Fix**:

```bash
/model add
# Search for "ollama", "lmstudio", or another local provider
# Follow prompts to register a local model
```

**Common local providers**:

- **Ollama**: `ollama/mistral`, `ollama/llama2`
- **LM Studio**: Usually auto-detected as `lmstudio/model-name`
- **OMLX**: Apple on-device models

**Verify**:

```bash
/model list  # Should show a local model (non-Anthropic provider)
```

---

### Never Offered Restoration After Cloud Switch

**Symptoms**:

- Escalated to cloud, completed task
- New user prompt, but no restoration offer
- Still on cloud

**Cause**: `cloudSwitchWasFromStruggle` flag is false (manual switch)

**Explanation**: You manually switched to cloud (e.g., `/route-model switch`), so route-model treats that as user intent and doesn't auto-restore.

**Fix**: Manually switch back:

```bash
/route-model switch
# Or: /model set your-local-model-name
```

**Note**: This is by design. If route-model switched you due to struggle, next task will offer restoration. If *you* switched to cloud, you stay there until *you* switch back.

---

### Keeps Offering Restoration After Declining

**Symptom**:

- Escalated to cloud due to struggle
- Declined restoration offer
- Next task, offered again
- Next task, offered again
- etc.

**Cause**: You said "No" to restoration, but flag is still `true`

**Expected behavior**: Yes, this is correct. The extension keeps offering until you either:

1. Accept and switch back to local
2. Manually switch to local yourself
3. Use `/route-model switch` to toggle

**Fix** (if you want to stay on cloud):

```bash
/route-model switch
# This clears the flag and gives you a fresh cloud session
# Next tasks won't offer restoration
```

Or accept the offer once and stick with local monitoring.

---

### Turn Count Doesn't Reset Between Tasks

**Symptom**:

```
Turn 5: /route-model → Turns this task: 5
You: New task...
Turn 1: /route-model → Turns this task: 6 or 7 (didn't reset)
```

**Cause**: `before_agent_start` handler didn't fire, or turn count wasn't cleared

**This shouldn't happen**, but if it does:

**Check**:

1. Verify you're on local (not cloud) when new task starts
2. Run `/route-model` to see if turn count is stuck

**Workaround**: Manually reset by switching models:

```bash
/route-model switch  # Go to cloud
/route-model switch  # Back to local — triggers reset
```

**Report**: If this persists, check Pi logs for `before_agent_start` events firing.

---

### Status Shows Tool Failures But No Alert

**Symptom**:

```
/route-model
Tool failures: 3 consecutive
Turns this task: 2
✅ No alert yet
```

**Cause**: Tool failures exceeded threshold (3), but turn count (2) hasn't reached threshold (5)

**Explanation**: Turn threshold is a **gating condition**. You need BOTH:

- `turnIndex >= turnThreshold` (default 5)
- AND at least one of: struggle phrases, tool failures ≥ threshold, or double the turn threshold

**Fix**: Either wait for more turns, or:

1. Lower `turnThreshold` in config:

   ```json
   "turnThreshold": 1  // or 2
   ```

2. Or manually escalate:

   ```bash
   /route-model switch
   ```

---

### Config Changes Not Taking Effect

**Symptom**:

- Edited `config.json`
- Settings don't change
- Still using old thresholds

**Cause**: Config is cached in memory, not reloaded

**Fix**: Reload the extension:

```bash
# Restart Pi completely, or
# Switch models to trigger a reload:
/route-model switch  # This reloads config on next check
```

**Verify**:

```bash
/route-model  # Check if new settings appear
```

---

### Mismatched Local/Cloud Performance

**Symptom**:

- Local model solves tasks fine
- Cloud model is slower/overkill
- Escalation is a waste

**Cause**: Struggle thresholds are too aggressive for your setup

**Fix**: Increase thresholds significantly:

```json
{
  "turnThreshold": 15,           // Wait longer
  "toolFailureThreshold": 10,     // Need many failures
  "autoMode": false              // Confirm manually
}
```

Or just disable the extension if you're happy on local:

- Rename config file or set all thresholds to infinity
- The extension won't interfere

---

### Opposite: Local Model Always Stuck, Need More Cloud

**Symptom**:

- Local model struggles on most tasks
- You want to use cloud most of the time
- Manual escalation is tedious

**Fix**: Make escalation very aggressive:

```json
{
  "turnThreshold": 2,              // Escalate early
  "toolFailureThreshold": 1,        // Any failure counts
  "autoMode": true,                 // Auto-switch
  "strugglePatterns": ["perhaps", "might", "could", "i think"]
}
```

Then enjoy mostly-cloud operation with local as fallback.

---

## Debug: Checking Internal State

If you need to see what's happening, use these checks:

**1. Check current model**:

```bash
/model current  # or /model list
```

**2. Check monitoring state**:

```bash
/route-model  # Full status
```

**3. Check session history**:
Look at recent messages for:

- `🔧 route-model: watching local model performance` (startup)
- `⏱️ 5 turns burned` (alert shown)
- `route-model: detected struggle` (escalation)

**4. Manually test escalation**:

```bash
/route-model switch  # Should switch to cloud if on local
```

If it fails, check error message for missing model or API key.

---

## Getting Help

If you can't solve it with this guide:

1. **Gather diagnostics**:

   ```bash
   /route-model                # Status
   /model list                 # Models available
   cat config/config.json      # Current config
   ```

2. **Check extension logs**: Look for `route-model` error messages in Pi's console

3. **Test manually**:

   ```bash
   /route-model switch  # Can you toggle models?
   /route-model auto    # Can you toggle auto-mode?
   ```

4. **Check file permissions**:

   ```bash
   ls -la config/config.json  # Should be readable
   ```

If all else fails, reset to defaults:

```bash
cp config/config.example.json config/config.json
# Restart Pi
```
