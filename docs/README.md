# route-model Documentation Index

This directory contains comprehensive documentation for the **route-model** Pi extension. Read these guides in order of your need:

## Quick Start

**New to route-model?** Start here:

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** — Understand what route-model does and how it works
2. **[CONFIGURATION.md](CONFIGURATION.md)** — Set up your config and choose thresholds

## Detailed Guides

### For Understanding the Design

- **[ARCHITECTURE.md](ARCHITECTURE.md)**
  - What route-model is and why it exists
  - Key state tracking mechanisms
  - Three struggle detection signals
  - The state machine: local → cloud → local
  - Event lifecycle and config integration
  - Design decisions explained

### For Setting Up and Tuning

- **[CONFIGURATION.md](CONFIGURATION.md)**
  - Getting started (copy config file)
  - All configuration options explained
  - Environment setup (API keys, models)
  - Troubleshooting config issues
  - Example configurations for different use cases

### For Understanding Escalation & Restoration

- **[ESCALATION_LOGIC.md](ESCALATION_LOGIC.md)** (Advanced)
  - Deep dive into the `cloudSwitchWasFromStruggle` flag
  - How struggle detection triggers escalation
  - The restoration decision logic
  - How user intent is preserved
  - Edge cases and multi-escalation scenarios

### For Using the Extension

- **[COMMANDS.md](COMMANDS.md)**
  - `/route-model switch` — toggle between local and cloud
  - `/route-model auto` — toggle auto-mode
  - `/route-model` — show status
  - Natural language shortcuts (e.g., "use cloud")
  - Workflow examples and integration with `/model`

### For Fixing Problems

- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**
  - Diagnostic steps (status commands)
  - Common issues and solutions
  - Config doesn't load
  - Extension never detects struggle
  - Extension escalates too easily
  - API key and model availability issues
  - Flag state issues
  - Debug techniques

## Document Structure

### ARCHITECTURE.md (Conceptual)

- What the extension does
- Key state variables and their scope
- Three struggle signals explained
- State machine rules
- Event lifecycle
- Design decisions

**When to read**: You want to understand the design and how pieces fit together

### CONFIGURATION.md (Practical)

- Setup steps
- All config keys explained
- Examples for different use cases
- Environment requirements (API keys, models)
- Troubleshooting config-specific issues

**When to read**: Setting up or tuning the extension

### ESCALATION_LOGIC.md (Advanced)

- Detailed flow of escalation and restoration
- The critical `cloudSwitchWasFromStruggle` flag
- How the extension distinguishes escalation from user intent
- Edge cases (multiple escalations, manual overrides, etc.)
- Examples of state transitions

**When to read**: You want to understand why it made a decision, or you're debugging flag state

### COMMANDS.md (Reference)

- All user commands documented
- Natural language shortcuts
- Autocomplete options
- Session notifications and what they mean
- Workflow examples
- Error messages and fixes

**When to read**: Using the extension, or learning what commands are available

### TROUBLESHOOTING.md (Problem-Solving)

- Diagnosis commands to gather info
- Common issues with symptoms and causes
- Fixes for each issue
- Configuration-specific problems
- Debug techniques

**When to read**: Something isn't working as expected

## Decision Trees

### "I'm setting up route-model"

1. Read [ARCHITECTURE.md](ARCHITECTURE.md) → understand what it does
2. Read [CONFIGURATION.md](CONFIGURATION.md) → follow setup steps
3. Test with `/route-model status` → verify it's working

### "It's not detecting my struggles"

1. Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md) → "Extension never detects struggle"
2. Look at [CONFIGURATION.md](CONFIGURATION.md) → adjust patterns or thresholds
3. Check [COMMANDS.md](COMMANDS.md) → `/route-model` status after each turn

### "Why did it make that decision?"

1. Read [ESCALATION_LOGIC.md](ESCALATION_LOGIC.md) → understand the state machine
2. Check [COMMANDS.md](COMMANDS.md) → `/route-model` shows current state
3. Look at [TROUBLESHOOTING.md](TROUBLESHOOTING.md) → "Debug: Checking Internal State"

### "I want to prevent false positives"

1. Read [CONFIGURATION.md](CONFIGURATION.md) → "Troubleshooting" section
2. Edit struggle patterns in `config.json`
3. Increase `turnThreshold` or `toolFailureThreshold`

### "It keeps offering to restore to local when I want to stay on cloud"

1. Read [ESCALATION_LOGIC.md](ESCALATION_LOGIC.md) → "User Intent Handling"
2. Use `/route-model switch` to toggle to cloud (clears the flag)
3. Check [COMMANDS.md](COMMANDS.md) → manual switch behavior

## Key Concepts

### `cloudSwitchWasFromStruggle` Flag

- The single source of truth for whether a cloud switch was extension-initiated
- `true` = extension escalated → offer to restore at task boundary
- `false` = user switched or never switched → respect cloud choice
- See [ESCALATION_LOGIC.md](ESCALATION_LOGIC.md) for full details

### Per-Task State

- Resets on every new user prompt
- Includes: turn count, struggle counters, failure streaks
- Enables independent monitoring of multiple unrelated tasks
- See [ARCHITECTURE.md](ARCHITECTURE.md) for state variables

### Three Struggle Signals

1. Turn count (how many turns on this task)
2. Struggle phrases ("I'm not sure", etc.)
3. Tool failure streaks (same tool failing consecutively)

- All signals combined determine escalation
- See [ARCHITECTURE.md](ARCHITECTURE.md) for details

### Local → Cloud → Local Cycle

- Monitor on local
- Escalate when struggling
- Offer to restore at task boundary
- User can override at any point
- See [ESCALATION_LOGIC.md](ESCALATION_LOGIC.md) for full flow

## Configuration Quick Reference

| Setting | Default | Tuning |
| --- | --- | --- |
| `turnThreshold` | 5 | Lower to escalate sooner, higher to wait longer |
| `toolFailureThreshold` | 3 | Lower to catch failures faster |
| `autoMode` | true | Set to false for manual confirmation dialogs |
| `cloudModelId` | claude-sonnet-4-5 | Choose your preferred cloud model |
| `strugglePatterns` | 13 patterns | Add/remove patterns matching your model |

See [CONFIGURATION.md](CONFIGURATION.md) for full details.

## Commands Quick Reference

| Command | Purpose |
| --- | --- |
| `/route-model switch` | Toggle between local and cloud |
| `/route-model auto` | Toggle auto-switch mode |
| `/route-model` | Show current status |
| "use cloud" | Natural language switch to cloud |
| "are you struggling?" | Natural language status check |

See [COMMANDS.md](COMMANDS.md) for full reference.

## Workflow Examples

### Hands-Off (Auto-Mode)

```
Local task → struggle detected → auto-escalate to cloud → cloud solves → auto-restore to local
```

### Controlled (Manual Mode)

```
Local task → struggle detected → ask user → user confirms → escalate to cloud → cloud solves
→ new task → ask user → user confirms → restore to local
```

### All-Cloud (Power User)

```
Manually switch to cloud with /route-model switch → works on cloud → manually switch back when done
```

See [COMMANDS.md](COMMANDS.md) for complete workflow examples.

## When to Read Each Document

| Situation | Read |
| --- | --- |
| "I'm setting up route-model" | [CONFIGURATION.md](CONFIGURATION.md) |
| "I want to understand how it works" | [ARCHITECTURE.md](ARCHITECTURE.md) |
| "Why did it do that?" | [ESCALATION_LOGIC.md](ESCALATION_LOGIC.md) |
| "How do I use it?" | [COMMANDS.md](COMMANDS.md) |
| "Something's broken" | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

---

**Questions?** Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md) first. Most common issues are documented there.

**Ready to dive in?** Start with [ARCHITECTURE.md](ARCHITECTURE.md), then [CONFIGURATION.md](CONFIGURATION.md).
