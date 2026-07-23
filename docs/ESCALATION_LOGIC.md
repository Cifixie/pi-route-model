# Escalation & Restoration Logic

## Overview

route-model's core function is to detect when a local model is struggling and automatically escalate to a more capable cloud model, then restore the local model once the task completes. This document explains the detailed flow and key design decisions.

## The Core Problem

Local models (Ollama, LM Studio, etc.) are fast but limited. Cloud models (Claude) are slower but more capable. Users want:

- **Efficiency**: run locally when the task is solvable locally
- **Capability**: seamlessly escalate to cloud when stuck
- **Control**: manual overrides should always be respected

route-model solves this by monitoring for struggle and automating the decision.

## Struggle Detection Flow

### Turn-End Event: Struggle Check

On every `turn_end` (after the assistant completes a turn):

```
1. Is model local? If no → skip monitoring
2. Get latest assistant message from session
3. Search for struggle patterns in message text
4. Count consecutive turns showing struggle
5. Check if alert threshold exceeded
6. If threshold exceeded and not already alerted → prompt to switch
```

### Three Signals Combined

#### Signal 1: Struggle Phrases

```typescript
detectStruggle(message, cfg) → string[]
```

- Scans message for patterns like "i'm not sure", "let me try again", etc.
- Returns array of matched patterns
- Case-insensitive substring matching
- Multiple patterns in one message all count

**Strength**: Direct signal from the model itself
**Weakness**: Some models don't verbalize struggle; some say "perhaps" in normal reasoning

#### Signal 2: Consecutive Tool Failures

```typescript
tool_execution_end event:
  if (event.isError) {
    currentTag = failureTag(event)
    if (currentTag === lastFailureTag) {
      consecutiveToolFailures++
    } else {
      consecutiveToolFailures = 1
      lastFailureTag = currentTag
    }
  } else {
    consecutiveToolFailures = 0
  }
```

- Tracks same tool failing in a row
- Different tools reset the streak
- Catches silent struggles (read returns empty, edit fails repeatedly)

**Strength**: Objective signal, not affected by verbalization
**Weakness**: Some tools might fail legitimately (e.g., file not found)

#### Signal 3: Turn Count

```typescript
if (turnIndex >= cfg.turnThreshold && 
    (consecutiveStruggling >= 1 || 
     consecutiveToolFailures >= threshold ||
     turnIndex >= cfg.turnThreshold * 2)) {
  // Alert triggered
}
```

- Backstop: if agent is spinning for too long, escalate
- Double threshold forces escalation even without other signals
- Prevents infinite loops

**Strength**: Simple, predictable
**Weakness**: May escalate on legitimately complex tasks

### Alert Logic

Alert triggers when:

```
(turnIndex >= turnThreshold)
  AND
(consecutiveStruggling >= 1
  OR consecutiveToolFailures >= toolFailureThreshold
  OR turnIndex >= turnThreshold * 2)
  AND
!hasAlerted (only once per task)
```

**Key**: NOT OR-ed together. Turn threshold is **gating condition**. You can't trigger on struggle alone; you need to hit the turn threshold first.

## Escalation: Local → Cloud

### Scenario: Auto-Mode

```
turn_end event:
  → detectStruggle() → struggle phrases found
  → consecutiveStruggling incremented
  → shouldAlert condition → TRUE

promptToSwitchTurn(ctx, cfg, turnState):
  if (cfg.autoMode) {
    notify "route-model: detected struggle (N turns) — switching to cloud"
    cloudSwitchWasFromStruggle = true  ← CRITICAL
    sendUserMessage("/route-model switch")
```

The flag `cloudSwitchWasFromStruggle = true` is **critical**. It tells `before_agent_start` that the cloud switch came from escalation, not user intent.

### Scenario: Manual-Mode

```
promptToSwitchTurn():
  if (!cfg.autoMode) {
    message = "Agent may be struggling… Switch to cloud?"
    choice = confirm(message)
    
    if (choice) {
      cloudSwitchWasFromStruggle = true  ← CRITICAL
      sendUserMessage("/route-model switch")
    } else {
      notify "keeping monitoring, run /route-model switch anytime"
```

User approval is required, but the same flag is set.

### The Switch Itself

```
sendUserMessage("/route-model switch")
  → doToggleModel() is called
  
doToggleModel():
  isCurrentlyLocal = isLocalModel(ctx.model)  // true
  cloudModel = findCloudModel(...)
  pi.setModel(cloudModel)
  
  → model_select event fires
  → handler: resetTaskState()
  → notify "switched to cloud — monitoring off"
```

Once on cloud, monitoring stops (the guard at `turn_end` checks `if (!isLocalModel(ctx.model)) return`).

## Key Design: Struggle Flag

The flag `cloudSwitchWasFromStruggle` is **the single source of truth** for whether a cloud switch was extension-initiated.

```typescript
cloudSwitchWasFromStruggle = false  // default, persistent

// Set to true when:
// 1. Extension detects struggle and auto-switches
// 2. Extension shows dialog and user confirms

// Set to false when:
// 1. User manually switches back to local
// 2. switchToLocal() completes
// 3. model_select event fires (cloud → local)
```

This allows the state machine to distinguish:

- **Extension escalation**: flag = true → offer to restore at task boundary
- **User intent**: flag = false → respect cloud choice, don't interfere

## Restoration: Cloud → Local

### Scenario: Next Task Starts (before_agent_start)

```
before_agent_start event (new user prompt):
  if (!isLocalModel(ctx.model)) {
    // We're on cloud
    
    if (cloudSwitchWasFromStruggle) {
      // Extension put us here, offer to go back
      if (cfg.autoMode) {
        notify "new task, switching back to local"
        switchToLocal()
      } else {
        choice = confirm("New task — switch back to local?")
        if (choice) switchToLocal()
      }
    } else {
      // User manually chose cloud, respect that
      return  // stay on cloud
    }
  } else if (isLocalModel(ctx.model)) {
    // On local, reset task state and keep monitoring
    resetTaskState()
  }
```

**Critical behavior**: If `cloudSwitchWasFromStruggle == false` and user is on cloud, we return early and **never try to switch back**. Cloud is treated as intentional.

### What switchToLocal() Does

```typescript
switchToLocal():
  localModel = findLocalModel()
  pi.setModel(localModel)
  
  // Clear the flag BEFORE model_select fires
  cloudSwitchWasFromStruggle = false
  
  resetTaskState()
  notify "switched back to local"
```

The flag is cleared here, so if we get another escalation later, it starts fresh.

## User Intent Handling

### Case 1: Manual Cloud Switch (User-Initiated)

```
User: "/route-model switch"
→ doToggleModel() → pi.setModel(cloudModel)
→ model_select fires with (wasCloud: false, isCloud: true)
→ handler resets task state
→ cloudSwitchWasFromStruggle stays FALSE (never touched)

Next task:
→ before_agent_start sees (cloud, flag=false)
→ Returns early → STAYS ON CLOUD
```

Result: Cloud is treated as user intent. No switch back offered.

### Case 2: Extension Escalates, User Manually Restores

```
Extension: struggle detected → setFlag(true) → switch to cloud
→ model_select fires

User: "/route-model switch" (while on cloud)
→ doToggleModel() → switchToLocal()
→ switchToLocal() clears flag → setFlag(false)
→ model_select fires (cloud → local)

Next task:
→ before_agent_start sees (local) → resetTaskState()
```

Result: Back to normal local monitoring. The extension-driven detour is complete.

### Case 3: User on Cloud, Wants to Try Local

```
User is on cloud (manually or from escalation)
User: "/route-model switch"
→ If flag is true (escalation) → switchToLocal() clears flag
→ If flag is false (user manual) → switchToLocal() clears flag anyway
```

Result: Either way, going back to local clears the flag. Future tasks start on local with normal monitoring.

## Edge Cases

### Manual Escalation (User Force-Switches to Cloud)

```
User on local: "/route-model switch"
→ doToggleModel() → switch to cloud
→ cloudSwitchWasFromStruggle NOT SET (stays false)

Task completes:
→ before_agent_start sees (cloud, flag=false)
→ Stays on cloud (respects user's manual choice)

Next task:
→ Still on cloud, still flag=false
→ Can work indefinitely on cloud without being "pulled back"
```

**Decision**: User intent is final. If they manually picked cloud, they own that choice until they switch back.

### Multiple Escalations in One Session

```
Task 1: Local → struggle detected → escalate → flag=true
→ Task 1 completes, flag=true → offer to restore
→ User says yes → restore to local, flag=false

Task 2: Local → different struggle → escalate again → flag=true
→ Task 2 completes, flag=true → offer to restore again
```

**Works correctly**: Each escalation is independent. Flag is set/cleared per escalation cycle.

### User Ignores Restoration Offer

```
Task 1: Escalate → flag=true
→ Task complete, before_agent_start offers to restore
→ User says no (in manual mode)
→ Stays on cloud, flag=true

Task 2: User sends prompt
→ before_agent_start sees (cloud, flag=true)
→ Offers to restore again
```

**Behavior**: User is re-offered restoration on every new task while flag is true. No "stuck" state; user can always say yes or use commands to override.

## Relationship to Config

- `autoMode` controls whether restoration offer is automatic or manual
- `turnThreshold` gates the struggle signals
- `toolFailureThreshold` defines tool failure sensitivity
- `strugglePatterns` determines what counts as struggle

All interact with the escalation heuristic, but the flag state machine is independent of config.

## Summary

The escalation/restoration cycle is controlled by **one boolean flag** that tracks origin of the cloud switch:

| State | Action |
| --- | --- |
| Local + flag = false | Monitor, escalate if struggling |
| Cloud + flag = true | Restore to local at task boundary |
| Cloud + flag = false | Respect user intent, stay on cloud |

This simple model respects user intent while still automating the efficiency/capability tradeoff.
