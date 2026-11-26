# Orca data sources

What Agent Board needs, and where Orca exposes it. Checked against Orca 1.4.277 (plugin host API 1.10).

## What the board shows

| Data | Orca CLI | Plugin host API |
| --- | --- | --- |
| Workspaces on every host | `worktree ps --environment <env>` per host (`environment list` names the paired servers) | `workspace.list` (with `includeStatus`): worktrees and folder workspaces with their host (`local`, `ssh:…`, `runtime:…`), at most 500 |
| Agents and their state (`working`, `waiting`, `blocked`, `done`), title, last prompt and reply | `worktree ps` (`agents[]`), `agent list`, `agent show <id>` | `agents.list({ workspaceId })` (state, title, terminal, session; no prompt or reply), `agent.status.changed` event |
| Unread (finished turn not seen) | `worktree ps`: `unread`, `agents[].activity.unread` | `workspace.list` status `unread` (per workspace) |
| Last turn outcome (`success`, `failure`, `interruption`…) | `agents[].mainAgent.outcome`, `interrupted` | `agent.status.changed` `mainAgent.outcome` (only as it changes) |
| Parent / child workspaces | `worktree ps`: `parent`, `parentWorktreeId`, `childWorktreeIds` (also across hosts) | **missing** |
| Project identity (Git remote), display name | `repo list`: `gitRemoteIdentity.canonicalKey`, `displayName` | `project.list` (no remote) |
| Linked PRs and issues | `worktree ps`: `linkedItems` | **missing** |
| Floating workspace chats | **not listed**; `agent show <id>` works once the id is known | **not listed** (`workspace.list` is worktrees and folder workspaces only) |
| Message counts, model | `search` hits (`messageCount`), this host only | `agent.listSessions` (this computer only) |

Ids: a `workspace.list` id is `identity:<identity.key>` for a worktree that has an identity key (the
CLI's `worktree ps` gives `identity.key`), else the worktree id.

## Opening an agent

- `worktree activate --worktree <selector> [--environment <env>]` shows a workspace in the desktop app.
- `terminal switch --terminal <handle>` brings a terminal tab forward; a terminal agent's `address` in
  `worktree ps` is its handle (`term_…`). Chats are not terminals.
- Plugin API: `workspace.open`, `terminal.focus` (terminal ids from `agents.list` or
  `agent.status.changed`), `commands.run({ action: 'floatingWorkspace.maximize' })`.
- Nothing focuses a specific **chat tab** yet: the board opens the agent's workspace.
- Nothing in the host API shows a plugin's own panel: the status bar command uses `orca plugin open`.

## The plugin worker's environment

- Orca starts the worker with `child_process.fork` and no Node permission flags, so the worker can spawn
  processes (`node:child_process`), but with a short environment allowlist (`PATH`, `HOME`,
  `USERPROFILE`, `LANG`, `TMPDIR`, `XDG_RUNTIME_DIR`, …). `ORCA_CLI_COMMAND` is not passed.
- The worker runs inside Orca's own executable (`process.execPath`), so the CLI launcher Orca ships is at
  `<resources>/bin/orca` (macOS, `Contents/Resources`), `<resources>/bin/orca-ide` (Linux) or
  `<resources>\bin\orca.exe` (Windows), next to it.
- Orca's user data folder: `~/Library/Application Support/orca` (macOS), `$XDG_CONFIG_HOME/orca` or
  `~/.config/orca` (Linux), `%APPDATA%\orca` (Windows).

## Rules the board follows

- A project is a Git remote (`canonicalKey`); repositories without one stay per host.
- A display name set in Orca (one that differs from the folder name) wins over folder names on any host.
- Children of a workspace are all its descendants, through parent links across hosts and projects. Their
  states count on the workspace's most recent chat, the one that shows the children summary.
- Filters match single agents, not workspaces.

## Gaps to raise with Orca

1. Parent links, Git remote identity and linked PRs in `workspace.list` / `project.list`.
2. Per-agent unread, outcome, last prompt and last reply in `agents.list`.
3. A host id ↔ paired environment name mapping, so a plugin can label hosts and open other servers' workspaces with `workspace.open`.
4. A way to list the floating workspace's chats.
5. A host API (and CLI) call to focus a chat tab by session id, and one to show a plugin's own panel.
