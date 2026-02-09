# Claude Butler

Personal AI butler you can text to run Claude agents, execute skills, deploy projects, check email, and more.

Text a command to your Telegram bot → it spawns a Claude CLI agent → sends you the result.

## Quick Start

```bash
git clone https://github.com/YOUR_USER/claude-butler.git
cd claude-butler
npm run setup    # Interactive wizard - asks for your keys
npm install
npm start
```

Then message your Telegram bot. That's it.

## Prerequisites

- **Node.js 18+**
- **Claude CLI** installed and authenticated (`claude` command available in PATH)
- **Telegram account** (for the bot)

## Setup

Run `npm run setup` and it will walk you through:

1. **Telegram Bot Token** - Message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`
2. **Your User ID** - Message [@userinfobot](https://t.me/userinfobot) to get your numeric ID
3. **Agent settings** - Concurrency limits, timeouts, rate limits
4. **Email** (optional) - Gmail address + App Password for email skills

## Usage

### Built-in Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help and available skills |
| `/status` | System status, queue, rate limits |
| `/skills` | List all installed skills |
| `/jobs` | List scheduled/recurring jobs |
| `/queue` | Show running and queued agents |

### Freeform

Send any message and it spawns a Claude agent to handle it:

```
"What's the weather like in NYC?"
"Write me a bash script that backs up my database"
"Explain the difference between TCP and UDP"
```

### Skills

Skills are triggered by keywords in your message:

```
"check my email"          → check-email skill (haiku - fast)
"deploy battlecard"       → deploy skill (opus - thorough)
"git status"              → git-status skill (haiku - fast)
"daily summary"           → daily-summary skill (sonnet - balanced)
```

## Smart Model Selection

The butler automatically picks the best Claude model for each task:

| Task Type | Model | Why |
|-----------|-------|-----|
| Email, status checks, summaries | **Haiku** | Fast, cheap, good enough |
| General coding, file ops | **Sonnet** | Balanced |
| Deploys, complex builds, debugging | **Opus** | Thorough, multi-step |

Skills can override this with an explicit `model` field in their `skill.json`.

## Creating Skills

Create a directory in `skills/` with at minimum a `skill.json`:

```
skills/
  my-skill/
    skill.json      # Required: name, triggers, prompt template
    CLAUDE.md       # Optional: context for the agent
    schedule.json   # Optional: cron schedule for recurring execution
```

### skill.json

```json
{
  "name": "my-skill",
  "description": "What this skill does",
  "triggers": ["keyword1", "keyword2"],
  "prompt_template": "Do this task: {{message}}",
  "cwd": "/path/to/working/directory",
  "max_turns": 25,
  "model": "sonnet"
}
```

### schedule.json (for recurring agents)

```json
{
  "cron": "0 9 * * 1-5",
  "description": "Runs weekday mornings at 9am",
  "prompt": "Check my todo list and summarize what's due today."
}
```

Cron format: `minute hour day-of-month month day-of-week`

## Architecture

```
Telegram Message
    ↓
Auth + Rate Limit Check
    ↓
Command Router
    ├── Built-in command (/help, /status, etc.)
    ├── Skill match (keyword triggers)
    │   └── Model resolved (skill override or auto-detect)
    └── Freeform (auto model selection)
    ↓
Agent Queue (p-queue, max concurrent)
    ↓
Claude CLI Spawn (claude --print -p "prompt")
    ↓
Result sent back via Telegram
```

### Key Components

- **Spawner** (`src/spawner.js`) - Manages a queue of Claude CLI processes with concurrency limits, timeouts, and output capping
- **Router** (`src/router.js`) - Parses messages, matches skills, dispatches to agents
- **Model Picker** (`src/model-picker.js`) - Auto-selects haiku/sonnet/opus based on task complexity
- **Scheduler** (`src/scheduler.js`) - Cron-based recurring agent execution
- **Auth** (`src/auth.js`) - User allowlist + sliding-window rate limiter
- **Telegram** (`src/channels/telegram.js`) - Bot adapter with message splitting and Markdown fallback

## Configuration

All config is via `.env` (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | required | From @BotFather |
| `ALLOWED_USER_IDS` | required | Comma-separated Telegram user IDs |
| `MAX_CONCURRENT_AGENTS` | `2` | Max simultaneous Claude processes |
| `RATE_LIMIT_PER_MINUTE` | `10` | Messages per user per minute |
| `AGENT_TIMEOUT_SECONDS` | `300` | Kill agent after this many seconds |
| `CLAUDE_CLI_PATH` | `claude` | Path to Claude CLI binary |
| `DEFAULT_CWD` | project root | Default working directory for agents |

## Error Handling

- **Agent timeouts**: Killed after configurable timeout, partial output returned
- **Output capping**: Truncated at 100KB to prevent memory issues
- **Rate limiting**: Sliding window per-user, returns cooldown time
- **Telegram message limits**: Auto-splits messages >4000 chars
- **Markdown failures**: Falls back to plain text
- **Polling conflicts**: Detects and exits if another instance is running
- **Graceful shutdown**: SIGINT/SIGTERM stops jobs and bot cleanly
- **Unhandled errors**: Caught and logged without crashing

## Running as a Service

### systemd (Linux)

```ini
[Unit]
Description=Claude Butler
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/claude-butler
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Windows (Task Scheduler or PM2)

```bash
npm install -g pm2
pm2 start src/index.js --name claude-butler
pm2 save
pm2 startup
```

## License

MIT
