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

Hosts: `workspace.list` (and `project.list`) name a paired Orca server's rows `hostId` =
`runtime:<environment id>`, where `<environment id>` is the `id` that `environment list --json` gives
for that server (checked: the paired server's environment id equals the id in `runtime:<id>`). This
computer's rows are `local`. So a CLI row maps to its `workspace.list` row by host (environment name →
environment id → `runtime:<id>`) and then by id (`identity:<key>` or the worktree id), else by path.

## Opening an agent

Everything opens in **this computer's** Orca window, whatever host the agent runs on.

- Plugin API: `workspace.open` with the `workspace.list` id shows any host's workspace here, a paired
  server's included (the mapping above). `terminal.focus` focuses a terminal (ids from `agents.list` on
  that row, or `agent.status.changed`). `commands.run({ action: 'floatingWorkspace.maximize' })` shows
  the floating workspace, but only while it is open: when it is closed Orca answers
  "floatingWorkspace.maximize cannot run in this view", and the action that opens it
  (`floatingTerminal.toggle`, ⌘⌥A / Ctrl+Alt+A) is not available to plugins.
- CLI: `terminal switch --environment <env> --terminal <handle>` navigates this computer's window to that
  terminal, on any host (`navigated: true`); a terminal agent's `address` in `worktree ps` is its handle
  (`term_…`). Chats are not terminals.
- CLI: `worktree activate --worktree <selector> --environment <env>` opens the workspace in **that host's
  own window**: the board uses it only for this computer (`--environment local`), as a fallback.
- The board's order: on this computer, `terminal.focus` for a terminal agent, else `workspace.open`, else
  `worktree activate`. On another host, `terminal.focus` for a terminal agent when `agents.list` gives
  its terminal, else `terminal switch`; for a chat, `workspace.open` with the `runtime:` row; with no
  row, `terminal switch` to one of its terminals; otherwise the panel says it cannot be shown here.
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
3. Host names in the host API: `workspace.list` names a paired server `runtime:<environment id>` but
   not its name, so a plugin without the CLI cannot label it (opening it works, see above).
4. A way to list the floating workspace's chats.
5. A host API (and CLI) call to focus a chat tab by session id, and one to show a plugin's own panel.
6. Expose `floatingTerminal.toggle` (or a "show the floating workspace" action that opens it when
   closed) to `commands.run`: `floatingWorkspace.maximize` fails while it is closed.
