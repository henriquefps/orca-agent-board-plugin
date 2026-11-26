# Agent Board for Orca

An [Orca](https://github.com/stablyai/orca) plugin that lists your coding agents the way you work with them:
one list of chats across every machine Orca reaches, newest first, with what each one needs from you.

Orca lets one agent start many workers in their own worktrees, often on other machines, and merge their
work back. The built-in sidebar shows workspaces; Agent Board shows **agents**:

- **One list across hosts.** This computer and every paired Orca server, in one place.
- **Parents, not workers.** "Hide children" keeps only the chats you talk to. Each one says how many child
  workspaces it has and whether any of them is running, failed or waiting for you.
- **One project per repository.** Clones of the same Git remote on different machines are one project.
- **What needs you first.** Needs you, failed, running and unread each have their own icon, colour and
  label; finished and seen agents fade back.
- **Cards your way.** The **Card elements** button in the header picks which parts of a card show (project,
  machine, parent, last reply, status label, children, agent kind, time, subagents, terminal tag).
- **Everything opens here.** Agents on other machines open in this computer's Orca window.
- **Three views:** List (agents by last activity), Projects (grouped by repository, children nested under
  their parent) and Tree (the full parent/child chain across hosts and projects).

Screenshots (List, Projects, Tree, Needs me) will be added under `docs/screenshots/`, rendered from the
invented fixtures in `src/fixtures.ts`.

## Install

Agent Board runs its own code (a worker), so Orca asks you to approve it before it loads. It needs Orca
1.4.259 or newer.

**From GitHub:** in Orca, Settings → Plugins → Install from link, and paste
`https://github.com/henriquefps/orca-agent-board-plugin`. Or from a terminal:

```sh
orca plugin install henriquefps/orca-agent-board-plugin --json
# exits 3 (approval_required) and prints what it would grant and a fingerprint; after reading it:
orca plugin install henriquefps/orca-agent-board-plugin --approve <fingerprint>
```

Orca installs the newest `vX.Y.Z` tag, else the default branch, pinned to the exact commit.

**From a local folder:** clone the repository and run `orca plugin install /path/to/orca-agent-board-plugin`
(the same approval follows). Orca refuses a plugin folder that contains symlinks, so install from a clone
where you have not run `npm install`, or delete `node_modules/` first; it is only needed for type checking.

On Linux the CLI is `orca-ide` outside Orca's own terminals.

### What Orca asks you to approve

- **Runs its own code** in a separate Node.js process on the Orca host, with your user account's access to
  that machine (`trusted-worker`). The worker runs the Orca CLI and, for floating workspace chats, the
  `sqlite3` command (read-only).
- The capabilities below.
- What it contributes: the **Agent Board** panel in the right sidebar, the **Agent Board: Show** command,
  the **need you** status bar item, the events it listens to and three settings.

### Capabilities and why

| Capability | Used for |
| --- | --- |
| `workspace:read` | `workspace.list` and `project.list` (the board when the Orca CLI is missing, and finding a workspace to open); `workspace.changed`, `workspace.created`, `workspace.removed` events to refresh. |
| `agent:read` | `agents.list` (agents when the CLI is missing, and the terminal of a terminal agent); `agent.status.changed` to refresh live. |
| `workspace:write` | `workspace.open` and `terminal.focus` to show an agent in Orca; `commands.run` to show the floating workspace and, as a fallback, the right sidebar. |
| `settings:own` | The three settings below. |

The status bar item and the panel ↔ worker requests need no capability. Panel state (view, filters, host,
card elements, collapsed groups) is kept by Orca for the plugin and needs no `storage:own`.

## Features

- **Header:** "updated Xs ago", the host filter (All hosts or one host), **Card elements** and Refresh.
- **Card elements** (the layers button, next to Refresh): opens a section under the header with one
  switch per card element, all on by default: Project / workspace, Machine (the host chip), Parent (the
  "child of …" line), Last reply ("Agent: …" / "You: …"), Status label (the badge text), Children summary,
  Agent kind, Time, Subagents and Terminal tag. **Show all** turns them all back on; the button again, or
  the close button, closes the section. The status icon, the left bar and tint and the title always show.
  The choice applies to every card in every view and is remembered across reloads and Orca restarts.
  When some are hidden the button is accent-toned and its tooltip says how many ("Card elements (3
  hidden)"). A row whose elements are all hidden goes away (no empty chip line or meta row).
- **Views:** List (default), Projects and Tree, and search over titles, projects, workspaces and messages.
- **Filters**, matched per agent, not per workspace: **Needs me** (waiting, blocked or unread, or the most
  recent chat of a workspace whose child waits), **Running**, **Unread**, **Hide children** (List only, on
  by default) and **Hide idle** (workspaces without an open agent; on by default). Chip counts count agents.
- **Agent cards:** project/workspace and host chips first (plain badges with the host name; pressing
  them opens the agent like the rest of the card); for a child workspace, a muted line
  `⑂ child of <project>/<workspace>`, `on <the parent's host>` (only when it is another machine) and
  `· <the parent's most recent chat>`, which opens the parent when pressed; then the status icon (an
  animated spinner while running) beside the title, the card's only status icon; "Agent: <last reply>";
  then the status badge (text only), the children summary (on the workspace's most recent chat only: how
  many descendant workspaces, and how many of them need you, failed, are running or unread, each in its
  tone), agent kind, relative time, subagents and "terminal" for a terminal agent. The parent line shows
  in every view. Any of these can be hidden with **Card elements**.
- **One status per card**, most urgent first, with the prototype's signals (left bar, card surface, icon,
  title weight, badge), all in Orca's theme tones:
  - needs you: warning bar, tinted and outlined card, warning icon, semibold title, warning badge. The
    most recent chat of a workspace whose child needs you looks the same.
  - failed or interrupted: danger bar and outline, error icon, semibold, danger badge.
  - running: accent bar, spinner beside the title, semibold, accent badge.
  - unread: amber (warning) bar like Orca's bell, bell icon, semibold, warning badge.
  - done: no bar, a neutral check, regular title, muted reply, the word "done" as quiet text.
- **Projects:** one collapsible group per Git remote across hosts. A display name you set in Orca (one
  that differs from the folder name) wins on any host, else this computer's. Children nest under their
  parent; a child whose parent is in another project says "child of …".
- **Tree:** the whole parent/child chain across hosts and projects.
- **Click** an agent or workspace to show it in **this computer's** Orca window, on any host.
  - This computer: `terminal.focus` for a terminal agent, else `workspace.open`, else
    `orca worktree activate`.
  - A paired Orca server: Orca does not list its workspaces for plugins, so the board uses the CLI's
    `orca terminal switch --environment <server>`, which moves this window to a terminal's workspace: the
    agent's own terminal, else one of the workspace's terminals. A workspace with only chats gets a
    temporary terminal titled "Agent Board": the board creates it, switches to it and closes it again
    right away (also when the switch fails), and never closes any other terminal.
  - It counts as opened only when Orca says the window moved; otherwise the panel shows why. The board
    never runs `worktree activate` for another machine (that opens the other machine's window).
- **Floating workspace:** a click on one of its chats maximizes it. When it is closed, Orca does not let
  plugins open it, so the panel says: "The floating workspace is closed. Press ⌘⌥A (Ctrl+Alt+A on
  Windows/Linux) to open it, then click the chat again." (dismissible).
- **Status bar:** "N need you", hidden at zero: the List's **Needs me** chip with the default filters, on
  every host (children count once, through their parent's summary). Pressing it shows the panel.
- View, filters, host filter, card elements, collapsed groups and the last open failure (until dismissed)
  are remembered.

## Settings

| Setting | Default | |
| --- | --- | --- |
| Default view | List | The view a panel opens with until you pick one; changing it switches open panels. |
| Refresh every (seconds) | 15 | How often an open panel re-reads Orca, on top of live events. |
| Include floating workspace chats | on | Lists this computer's floating workspace chats (see Known limits). |

## How it gets its data

The worker prefers the plugin host API for what it covers (events, opening, focusing) and reads the
board from the Orca CLI, because the host API has no parent/child links, Git remote identity, linked PRs,
per-agent unread or outcome, last replies or other Orca servers. One `orca worktree ps` per host gives all
of that in one call; `environment list` names the hosts and `repo list` the projects (cached for two
minutes). [docs/orca-data-sources.md](docs/orca-data-sources.md) lists what each source gives.

- **The Orca CLI** is found without configuration: `ORCA_CLI_COMMAND` when set, else the CLI launcher in
  the resources of the Orca app that runs the worker (`bin/orca` on macOS, `bin/orca-ide` on Linux,
  `bin/orca.exe` on Windows), else the usual install places, else `orca-ide` on Linux (never a bare `orca`,
  which can be the GNOME screen reader) or `orca.exe` on Windows from `PATH`.
- **Without the CLI**, or when it cannot read this computer, the board falls back to `workspace.list`,
  `project.list` and `agents.list` and says which features are off.
- **Refresh:** live on agent and workspace events, plus a poll while a panel shows (the setting above).
  With no panel open nothing polls except the status bar count: at most one `worktree ps` per host per
  minute.

## Known limits

- **No chat-tab focus.** Orca has no API to focus one chat tab: clicking a chat opens its workspace, with
  whatever tab was last active there, and a terminal agent focuses its terminal.
- **Floating workspace chats** are listed on this computer only. Neither the CLI nor the host API lists
  them, so the worker reads their ids from Orca's local session store (`agent-session-domain.db` in Orca's
  user data folder, read-only, with the `sqlite3` command) and asks `orca agent show` for each. Without
  `sqlite3` or the file, the floating workspace is left out silently. Clicking one shows the floating
  workspace if it is open; plugins cannot open it, so when it is closed the panel tells you its shortcut.
- **Other machines' workspaces** are not in the host API's `workspace.list` (Orca leaves paired servers
  out of it), so `workspace.open` cannot reach them and they open through the Orca CLI. A chat-only
  workspace briefly gets a temporary "Agent Board" terminal to show it; if a crash ever leaves one
  behind, its title says where it came from and you can close it. The window shows the workspace with
  whatever tab was last active there, not the chat you clicked.
- **Needs the Orca CLI:** parent and child workspaces, other Orca servers, one project per Git remote,
  display names from other hosts, linked PRs, last replies, per-agent unread and failed/interrupted
  outcomes, and showing other Orca servers' workspaces in this window.
- Pressing the status bar item shows the panel through `orca plugin open`; if that fails it toggles the
  right sidebar.
- The panel draws at most 60 agent cards at a time; **Show more** adds 60 more.

## Develop

```sh
npm install          # TypeScript and Node typings, for type checking only
npx tsc -p .
orca plugin validate . --json
orca plugin test . --json
orca plugin check . --json        # renders src/panel.check.ts scenarios from invented fixtures
```

- `src/model.ts`: the board's rules (status, filters, children, views, project names), shared by worker and panel.
- `src/sources.ts`: Orca's answers (CLI JSON, host API) → the board snapshot.
- `src/cli.ts`: finding and running the Orca CLI; floating chats.
- `src/worker.ts`: refresh, events, opening, status bar.
- `src/panel.tsx`: the panel, drawn with Orca's components so it follows Orca's theme.
- `prototype/`: the HTML prototype the plugin was ported from (`node prototype/server.mjs`, see below).

### The prototype

Needs Node 20+ and the Orca desktop app running. It reads Orca through its CLI
(`ORCA_CLI_COMMAND`, default the macOS app's CLI):

```sh
node prototype/server.mjs
# open http://localhost:4870
```

## License

[MIT](LICENSE)
