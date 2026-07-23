# pi-route-model

A [pi](https://pi.dev/) extension that watches your local model struggle and switches to the cloud when a task outgrows what the model on your machine can handle — and back again when you're done.

## How it works

Three simple signals, all observable at runtime — **no keyword guessing**, scoped to the **current task** (reset on every new user prompt, not cumulative for the whole session):

1. **Turn count** — how many turns the agent burns on this task
2. **Struggle phrases** — the assistant saying "I'm not sure", "let me try again", etc.
3. **Tool failure streak** — the same tool failing 2+ consecutive times (restarts when any tool succeeds). Catches struggle the model never verbalises: an edit tool that keeps failing, a grep that returns nothing repeatedly, etc.

When the current task exceeds your configured turn threshold AND shows at least one struggle signal, you get a prompt to switch to the cloud. The switch happens **in-session** — no new session is created, the cloud model picks up with full history intact.

## Install

```sh
# Clone into pi's user extension directory
git clone https://github.com/Cifixie/pi-route-model ~/.pi/agent/extensions/route-model

# Copy the example config and edit to taste
cp ~/.pi/agent/extensions/route-model/config/config.example.json \
   ~/.pi/agent/extensions/route-model/config/config.json
```

Then reload pi or start a new session.

## Config

Edit `config/config.json` (gitignored — your personal settings stay local):

| Key | Default | Description |
| ----- | --------- | ------------- |
| `cloudProvider` | `anthropic` | Provider to treat as "cloud". Any other registered provider is treated as "local". |
| `cloudModelId` | `claude-sonnet-4-5` | Cloud model to switch to. Falls back to the first available model from `cloudProvider` if not found. |
| `localModelIds` | _(none)_ | Preferred local model IDs, tried in order. Falls back to the first available non-cloud-provider model if unset/unmatched. |
| `turnThreshold` | `5` | Turns before the alert can fire for a task. |
| `struggleConsecutive` | `2` | Consecutive struggling turns required (currently informational). |
| `toolFailureThreshold` | `3` | Same tool failing consecutively before alert triggers. |
| `autoMode` | `true` | `true` = switch automatically (both ways). `false` = show a confirm prompt before each switch. |
| `strugglePatterns` | (see example) | Lowercase phrases to watch for in assistant responses. |

## Commands

| Command | Description |
| --------- | ------------- |
| `/route-model` | Show current status (model, turns, struggles) |
| `/route-model switch` | Toggle between local and cloud |
| `switch to cloud` / `use cloud` | Same as above, typed as a message |
| `are you struggling?` | Get a real-time assessment |

## Alert triggers

- Agent has made ≥ `turnThreshold` turns on **this task**, AND
- At least one of:
  - 1+ struggle phrase detected in the latest assistant message
  - ≥ `toolFailureThreshold` (default 3) consecutive tool failures from the same tool
  - ≥ 2× `turnThreshold` turns regardless of signals (catches long silent struggles)

The alert fires at most once per task. After switching, monitoring resets automatically on the next task.

## Structure

```
pi-route-model/
├── src/
│   └── index.ts          # Extension entry point (pi loads this)
├── config/
│   ├── config.example.json   # Committed template — copy to config.json
│   └── config.json           # Your settings (gitignored)
└── README.md
```

## Known limitations

- Struggle detection is now multi-signal (phrases + tool failures), reducing blind spots but still missing edge cases such as tools that silently fail without raising `isError`.
