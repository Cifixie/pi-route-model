# pi-route-model

A [pi](https://pi.us) extension that watches your local model struggle and switches to Claude when a task outgrows what the model on your machine can handle — and back again when you're done.

## How it works

Two simple signals, both observable at runtime — **no keyword guessing**, scoped to the **current task** (reset on every new user prompt, not cumulative for the whole session):

1. **Turn count** — how many turns the agent burns on this task
2. **Struggle phrases** — the assistant saying "I'm not sure", "let me try again", etc.

When the current task exceeds your configured turn threshold AND shows at least one struggle signal, you get a prompt to switch to Claude. The switch happens **in-session** — no new session is created, Claude picks up with full history intact.

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
|-----|---------|-------------|
| `claudeModelId` | `claude-sonnet-4-5` | Claude model to switch to. Falls back to the first available Anthropic model if not found. |
| `turnThreshold` | `5` | Turns before the alert can fire for a task. |
| `struggleConsecutive` | `2` | Consecutive struggling turns required (currently informational). |
| `autoMode` | `false` | `true` = switch automatically without asking. `false` = show a confirm prompt. |
| `strugglePatterns` | (see example) | Lowercase phrases to watch for in assistant responses. |

## Commands

| Command | Description |
|---------|-------------|
| `/route-model` | Show current status (model, turns, struggles) |
| `/route-model switch` | Toggle between local and Claude |
| `switch to claude` / `use claude` | Same as above, typed as a message |
| `are you struggling?` | Get a real-time assessment |

## Alert triggers

- Agent has made ≥ `turnThreshold` turns on **this task**, AND
- At least 1 struggle phrase detected (or the task has burned ≥ 2× the threshold regardless)

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

- Struggle detection is phrase-based — it can miss struggle not expressed in words, and can rarely false-positive on assistant messages that happen to contain a matching phrase.
- Only local→Claude switching is monitored automatically. Claude→local is always manual (`/route-model switch`).
