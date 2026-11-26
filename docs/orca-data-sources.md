# Orca data sources

What Agent Board needs, and where Orca exposes it. Checked against Orca 1.4.278 (plugin host API 1.10).

## What the board shows

| Data | Orca CLI | Plugin host API |
| --- | --- | --- |
| Workspaces on every host | `worktree ps --environment <env>` per host (`environment list` names the paired servers) | `workspace.list` (with `includeStatus`): this computer's worktrees and folder workspaces (`local`, `ssh:…`), at most 500. **Paired Orca servers are left out** (see Hosts) |
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

Hosts: Orca names a paired Orca server `runtime:<environment id>`, where `<environment id>` is the
`id` that `environment list --json` gives for that server. But the host API's `workspace.list` is built
from the local runtime's `worktree.list`, and that answer's `hostScope` lists the paired servers under
`omittedHostIds` (`runtime:<id>`, with `omittedHostSelectors` such as `--environment <name>`): their
workspaces are never in `workspace.list` (checked in Orca 1.4.278's code and with the CLI, e.g.
`terminal list --json` shows the same `hostScope`). This computer's rows are `local`, and a CLI row on
this computer maps to its `workspace.list` row by id (`identity:<key>` or the worktree id), else by path.

## Opening an agent

Only this computer's workspaces can be shown in the window you are using. A paired Orca server's workspace
cannot: see the CLI notes below.

- Plugin API: `workspace.open` with the `workspace.list` id shows a workspace here; a paired server's
  workspace has no row, so it cannot be opened this way. `terminal.focus` focuses a terminal (ids from `agents.list` on
  that row, or `agent.status.changed`). `commands.run({ action: 'floatingWorkspace.maximize' })` shows
  the floating workspace, but only while it is open: when it is closed Orca answers
  "floatingWorkspace.maximize cannot run in this view", and the action that opens it
  (`floatingTerminal.toggle`, ⌘⌥A / Ctrl+Alt+A) is not available to plugins.
- CLI: `terminal switch --environment <env> --terminal <handle>` navigates **that host's** Orca window to the
  terminal's workspace (`result.focus.navigated: true` is about that window). For a paired server that runs
  the desktop app, its own window moves and this computer's does not (checked by hand on Orca 1.4.278; the
  command's help text suggests otherwise); a terminal agent's `address` in
  `worktree ps` is its handle (`term_…`), and `terminal list --environment <env> --worktree <selector>`
  lists a workspace's terminals (`handle`, `connected`, `agentIdentity`). Chats are not terminals.
- CLI, a workspace with only chats on a paired server: `terminal create --environment <env> --worktree
  <selector> --title "Agent Board"` (no `--focus`) gives `result.terminal.handle`; `terminal switch` to
  it moves that server's window there, not this one; `terminal close --environment <env> --terminal <handle>` removes it
  again (`result.close.ptyKilled: true`). Checked by hand against a paired server's chat-only workspace.
- CLI: `worktree activate --worktree <selector> --environment <env>` opens the workspace in **that host's
  own window**: the board uses it only for this computer (`--environment local`), as a fallback.
- The board's order, by host kind:
  - **This computer** (`--environment local`): `terminal.focus` for a terminal agent, else
    `workspace.open` with the `workspace.list` row, else `worktree activate`.
  - **A paired Orca server** (`env` other than `local` in the CLI snapshot): `terminal list` for the
    workspace; `terminal switch` to the agent's own terminal when it is live there, else to one of the
    workspace's connected terminals (an agent's first); with none, a temporary terminal: create, switch,
    then close it in a `finally`, so it is closed also when the switch fails. Only the handle the board
    created is ever closed. Success only when `navigated` is true; otherwise the panel's notice says why.
    Never `worktree activate`. Either way, what moves is the server's own window (when it has one), not
    this one: a known limit, see the README.
  - **No CLI** (host API snapshot): only this computer's workspaces are listed, opened as above.
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
3. Paired servers in the host API: `workspace.list` (and so `workspace.open`) leaves them out
   (`hostScope.omittedHostIds`), and the CLI's `--environment <server>` commands move that server's window,
   so nothing can show a paired server's workspace in the window you are using. A host API call (or CLI
   flag) to show one here is needed.
4. A way to list the floating workspace's chats.
5. A host API (and CLI) call to focus a chat tab by session id, and one to show a plugin's own panel.
6. Expose `floatingTerminal.toggle` (or a "show the floating workspace" action that opens it when
   closed) to `commands.run`: `floatingWorkspace.maximize` fails while it is closed.
