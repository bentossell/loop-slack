# Loop Slack

Slack bot for running autonomous agent loops on GitHub repos. Create tasks, start loops, approve PRs - all from Slack.

## What It Does

1. **Create tasks** → GitHub Issues from Slack
2. **Start loops** → Droid picks up issues, writes code, creates PRs
3. **Monitor progress** → Threaded updates in Slack
4. **Approve or skip** → Review PRs with buttons (approval mode)

## Quick Start

### 1. Create a Slack App

Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app:

**Socket Mode:**
- Enable Socket Mode (Settings → Socket Mode)
- Create an App-Level Token with `connections:write` scope → save as `app_token`

**Bot Token Scopes** (OAuth & Permissions):
- `chat:write` - send messages
- `commands` - slash commands
- `users:read` - get user info

**Slash Commands:**
- `/loop` - Start, stop, status
- `/task` - Create tasks

Install to workspace → save Bot Token as `bot_token`

### 2. Configure

```bash
cp config.example.yaml config.yaml
```

Edit `config.yaml`:
```yaml
slack:
  app_token: xapp-1-...
  bot_token: xoxb-...

github:
  token: ghp_...

auth:
  admins:
    - U12345678  # Your Slack user ID

repos:
  - owner: yourusername
    name: your-repo

user_keys:
  U12345678: fac_...  # Factory API key
```

### 3. Run

```bash
bun install
bun run start
```

## Commands

### `/loop`
```
/loop              # Show status
/loop start        # Open modal to start a loop
/loop stop         # Stop active loop
/loop stop <id>    # Stop specific loop
```

### `/task`
```
/task                           # Open modal
/task Add dark mode             # Quick create (single repo)
/task owner/repo Add dark mode  # Specify repo
```

## Modes

**Auto Mode** (default)
- Runs until all issues done or max iterations reached
- PRs are created but not auto-merged

**Approval Mode**
- Pauses after each task
- Shows PR with Approve/Skip/Stop buttons
- Approve merges PR and continues

## Authorization

Three roles in `config.yaml`:

| Role | Can do |
|------|--------|
| Admin | Everything - config, manage users, all repos |
| Operator | Start/stop loops, create tasks |
| Viewer | See status (default for everyone else) |

Get your Slack User ID: Click your profile → ⋮ → Copy member ID

## Hosting

**Local (Mac/Linux):**
```bash
bun run start  # or use pm2/systemd
```

**Fly.io:**
```bash
fly launch
fly secrets set SLACK_APP_TOKEN=xapp-...
fly secrets set SLACK_BOT_TOKEN=xoxb-...
# etc
```

**VPS:**
```bash
git clone ...
bun install
# Create config.yaml
pm2 start "bun run start" --name loop-slack
```

## How It Works

```
┌─────────┐      ┌───────────┐      ┌─────────┐
│  Slack  │ ←──→ │ loop-slack │ ←──→ │ GitHub  │
└─────────┘      └───────────┘      └─────────┘
                       │
                       ↓
                 ┌───────────┐
                 │   Droid   │ (runs in workspace)
                 └───────────┘
```

1. User runs `/loop start` or `/task`
2. Bot creates GitHub issue (if needed)
3. Bot clones/pulls repo to local workspace
4. Bot runs `droid exec` with the loop prompt
5. Droid picks up issue, makes changes, creates PR
6. Bot posts updates to Slack thread
7. In approval mode: waits for user to approve
8. Repeat until done

## Files

```
loop-slack/
├── src/
│   ├── index.ts      # Slack app, commands, actions
│   ├── config.ts     # Config loading
│   ├── db.ts         # SQLite state
│   ├── auth.ts       # Authorization
│   ├── github.ts     # GitHub API
│   ├── loop.ts       # Loop execution
│   └── views.ts      # Slack messages/modals
├── config.yaml       # Your config (gitignored)
├── config.example.yaml
├── loop-slack.db     # State (gitignored)
└── workspaces/       # Cloned repos (gitignored)
```

## Environment Variables

Alternative to config.yaml (useful for deployment):

```bash
SLACK_APP_TOKEN=xapp-...
SLACK_BOT_TOKEN=xoxb-...
GITHUB_TOKEN=ghp_...
# etc - see config.example.yaml for all options
```

## License

MIT
