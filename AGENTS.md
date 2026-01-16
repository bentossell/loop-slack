# AGENTS.md

Slack bot for running agent loops. TypeScript + Bun.

## Structure

```
src/
├── index.ts      # Entry point, Slack app setup, commands, actions
├── config.ts     # YAML config loading with Zod validation
├── db.ts         # SQLite state (loops, tasks, logs)
├── auth.ts       # Role-based authorization (admin/operator/viewer)
├── github.ts     # Octokit wrapper for issues/PRs
├── loop.ts       # Loop execution engine (spawns droid)
└── views.ts      # Slack Block Kit messages and modals
```

## Key Concepts

- **Loop**: A run against a repo. Has iterations, mode (auto/approval), status.
- **Task**: A GitHub issue being worked on within a loop.
- **Workspace**: Local clone of repo where droid runs.

## Commands

- `/loop` - status, start, stop
- `/task` - create GitHub issues

## Running

```bash
bun run dev    # Watch mode
bun run start  # Production
```

## Testing Locally

1. Create `config.yaml` from example
2. Set up Slack app with Socket Mode
3. Run `bun run dev`
4. Use `/loop status` in Slack

## Adding Features

**New slash command**: Add handler in `index.ts` → `app.command(...)`
**New button action**: Add handler in `index.ts` → `app.action(...)`
**New modal**: Add view builder in `views.ts`, handler in `index.ts` → `app.view(...)`
