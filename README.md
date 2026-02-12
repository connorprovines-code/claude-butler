# Claude Butler

Personal AI butler you can text to run Claude agents, execute skills, deploy projects, check email, and more.

Text a command to your Telegram bot → it spawns a Claude CLI agent → sends you the result. Follow-up messages resume the same conversation within a configurable time window.

## Quick Start

```bash
git clone https://github.com/YOUR_USER/claude-butler.git
cd claude-butler
cp .env.example .env     # Fill in your Telegram token + user ID
cp .mcp.json.example .mcp.json  # Optional: configure MCP servers
npm install
npm start
```

Then message your Telegram bot. That's it.

## Prerequisites

- **Node.js 18+**
- **Claude CLI** installed and authenticated (`claude` command available in PATH)
- **Telegram account** (for the bot)

## Setup

### Required

1. **Telegram Bot Token** - Message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`
2. **Your User ID** - Message [@userinfobot](https://t.me/userinfobot) to get your numeric ID
3. Copy `.env.example` to `.env` and fill in the values

### Optional Integrations

| Integration | Setup |
|---|---|
| **GitHub** | [Create a classic PAT](https://github.com/settings/tokens) with `repo` scope, set `GH_TOKEN` in `.env` |
| **Gmail** | [Create an app password](https://myaccount.google.com/apppasswords), set `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` |
| **Notion** | [Create integration](https://www.notion.so/profile/integrations), configure `.mcp.json` (see `.mcp.json.example`) |
| **Google Calendar** | Install gcalcli in a venv, run OAuth flow (see below) |

#### Google Calendar Setup

```bash
python3 -m venv .venv
.venv/bin/pip install gcalcli
.venv/bin/gcalcli --client-id=YOUR_ID --client-secret=YOUR_SECRET list
# Follow the browser OAuth flow, then set GCALCLI_* vars in .env
```

#### Notion MCP Setup

```bash
npm install -g @notionhq/notion-mcp-server
cp .mcp.json.example .mcp.json
# Edit .mcp.json with your NOTION_TOKEN
# Use absolute path to notion-mcp-server binary for systemd compatibility
```

Remember to share pages/databases with your integration in Notion (... menu → Connections).

## Usage

### Built-in Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help and available skills |
| `/status` | System status, queue, session info |
| `/skills` | List all installed skills |
| `/jobs` | List scheduled/recurring jobs |
| `/queue` | Show running and queued agents |
| `/new` | Kill current session, start fresh |

### Session Management

Messages within the TTL window (default 30 min) resume the same conversation — Claude remembers context from earlier messages. After the window expires, the next message starts a fresh session.

Say **"new session"**, **"fresh start"**, **"reset session"**, or send `/new` to manually clear context.

### Freeform

Send any message and it spawns a Claude agent to handle it:

```
"What's the weather like in NYC?"
"Create a new page in Notion called Project Ideas"
"Check my email for anything from Jake"
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
    ├── Built-in command (/help, /status, /new, etc.)
    ├── Session reset ("new session", "fresh start")
    ├── Skill match (keyword triggers)
    │   └── Model resolved (skill override or auto-detect)
    └── Freeform (auto model selection)
    ↓
Session Lookup (resume existing or start fresh)
    ↓
Agent Queue (p-queue, max concurrent)
    ↓
Claude CLI Spawn (claude --print --output-format json --resume <id>)
    ↓
Parse result + save session ID
    ↓
Result sent back via Telegram
```

### Key Components

- **Spawner** (`src/spawner.js`) - Manages a queue of Claude CLI processes with concurrency limits, timeouts, process group kills, and JSON output parsing
- **Sessions** (`src/sessions.js`) - In-memory session store with configurable TTL for conversation continuity
- **Router** (`src/router.js`) - Parses messages, matches skills, manages sessions, dispatches to agents
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
| `SESSION_TTL_MINUTES` | `30` | Session inactivity timeout |
| `CLAUDE_CLI_PATH` | `claude` | Path to Claude CLI binary |
| `GH_TOKEN` | - | GitHub Personal Access Token |
| `GMAIL_ADDRESS` | - | Gmail address for email skills |
| `GMAIL_APP_PASSWORD` | - | Gmail app password |
| `NOTION_API_KEY` | - | Notion integration token |
| `GCALCLI_PATH` | - | Path to gcalcli binary |
| `GCALCLI_CLIENT_ID` | - | Google OAuth client ID |
| `GCALCLI_CLIENT_SECRET` | - | Google OAuth client secret |

MCP servers are configured in `.mcp.json` (see `.mcp.json.example`).

## Error Handling

- **Agent timeouts**: Process group killed after configurable timeout, partial output returned
- **Process group kills**: Uses `kill(-pid)` to terminate the entire process tree, preventing orphans
- **Output capping**: Truncated at 100KB to prevent memory issues
- **Rate limiting**: Sliding window per-user, returns cooldown time
- **Telegram message limits**: Auto-splits messages >4000 chars
- **Markdown failures**: Falls back to plain text
- **Polling conflicts**: Detects and exits if another instance is running
- **Graceful shutdown**: SIGINT/SIGTERM stops jobs and bot cleanly
- **Unhandled errors**: Caught and logged without crashing

## Running as a Service

### systemd (Linux, recommended)

Create `~/.config/systemd/user/claude-butler.service`:

```ini
[Unit]
Description=Claude Butler - Personal AI Agent Dispatcher
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/claude-butler
ExecStartPre=/path/to/claude-butler/scripts/update-claude-symlink.sh
ExecStart=/path/to/node src/index.js
Restart=always
RestartSec=10
Environment=PATH=/your/.local/bin:/path/to/node/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable claude-butler
systemctl --user start claude-butler
loginctl enable-linger $USER  # Keeps service running without active login
```

### PM2 (cross-platform)

```bash
npm install -g pm2
pm2 start src/index.js --name claude-butler
pm2 save
pm2 startup
```

## License

MIT
