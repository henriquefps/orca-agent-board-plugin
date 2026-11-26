# Orca data sources

What Agent Board needs, and where Orca exposes it. Checked against Orca 1.4.278 (plugin host API 1.10).

## What the board shows

| Data | Orca CLI | Plugin host API |
| --- | --- | --- |
| Workspaces on every host | `worktree ps --environment <env>` per host (`environment list` names the paired servers) | `workspace.list` (every host Orca reaches, with `includeStatus`) |
| Agents and their state (`working`, `waiting`, `blocked`, `done`), title, last prompt and reply | `worktree ps` (`agents[]`), `agent list`, `agent show <id>` | `agents.list({ workspaceId })`, `agent.status.changed` event |
| Unread (finished turn not seen) | `worktree ps`: `unread`, `agents[].activity.unread` | `workspace.list` status `unread` |
| Last turn outcome (`success`, `failure`, `interruption`…) | `agents[].mainAgent.outcome`, `interrupted` | `agent.status.changed` `mainAgent.outcome` |
| Parent / child workspaces | `worktree ps`: `parent`, `parentWorktreeId`, `childWorktreeIds` (also across hosts) | **missing** |
| Project identity (Git remote), display name | `repo list`: `gitRemoteIdentity.canonicalKey`, `displayName` | `project.list` (no remote) |
| Linked PRs and issues | `worktree ps`: `linkedItems` | **missing** |
| Floating workspace chats | **not listed**; `agent show <id>` works once the id is known | not known yet |
| Message counts, model | `search` hits (`messageCount`), this host only | `agent.listSessions` (this computer only) |

## Opening an agent

- `worktree activate --worktree <selector> [--environment <env>]` shows a workspace in the desktop app.
- `terminal switch --terminal <handle>` brings a terminal tab forward; chats are not terminals.
- Plugin API: `workspace.open`, `terminal.focus`.
- Nothing focuses a specific **chat tab** yet: the board opens the agent's workspace.

## Rules the board follows

- A project is a Git remote (`canonicalKey`); repositories without one stay per host.
- A display name set in Orca (one that differs from the folder name) wins over folder names on any host.
- Children of a workspace are all its descendants, through parent links across hosts and projects. Their
  states count on the workspace's most recent chat, the one that shows the children summary.
- Filters match single agents, not workspaces.

## Gaps to raise with Orca

1. Parent links and Git remote identity in `workspace.list` / `project.list`.
2. A way to list the floating workspace's chats.
3. A host API (and CLI) call to focus a chat tab by session id.
