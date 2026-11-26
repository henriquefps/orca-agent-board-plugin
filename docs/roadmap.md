# Roadmap

## M0: prototype (done)

`prototype/`: a local Node server that reads Orca through its CLI and serves the board as one page, sized
like Orca's right sidebar (about 470 px). Used to settle what the board shows.

## M1: plugin skeleton (done)

- `worker-panel` plugin at the repository root: a right-sidebar panel drawn with Orca's components, backed
  by a Node worker, one typed protocol (`src/protocol.ts`).
- The worker builds the snapshot the prototype builds: the Orca CLI for parents, Git remotes, other hosts,
  linked PRs and last replies; the host API for events, opening and focusing, and as the whole source when
  the CLI is missing (with a notice saying what is off).
- List view with the filters (Needs me, Running, Unread, Hide children, Hide idle), host filter and search.
- Live updates from `agent.status.changed`, `workspace.changed`, `workspace.created` and
  `workspace.removed`, plus a poll only while a panel shows.
- Click opens the workspace (`workspace.open`, `terminal.focus`; the CLI for other Orca servers).

## M2: all views (done)

- Projects and Tree views.
- Status bar item: how many agents need you, hidden at zero; pressing it shows the panel.
- Settings: default view, refresh interval, floating workspace chats.

## M3: publish

- Done: tests (`orca plugin test`: board rules, worker and panel), `orca plugin check` scenarios (List,
  Projects, Tree, needs-you child, CLI unavailable, empty), screenshots from invented fixtures,
  `orca plugin validate`.
- Next: release tag `v0.1.0`, the `orca-plugin` topic and the catalog entry
  (`orca plugin release-entry`).

## v0.1.2 (done)

- One status icon per card (the badge is text only), a colour per machine (pressable host chips,
  remembered), a parent line on child cards, other machines' agents open in this computer's window
  (`workspace.open` with `runtime:<environment id>` rows; this never worked, see v0.1.4), and a message when the floating workspace is
  closed.

## v0.1.3 (done)

- Host chips are the plain host name again, everywhere (the v0.1.2 colour circles and their cycling are
  gone); on cards they are plain badges inside the card's press.
- **Card elements**: a header button opens a section with one switch per card element (project, machine,
  parent, last reply, status label, children summary, agent kind, time, subagents, terminal tag) and
  Show all; the choice applies to every card in every view and persists. Rows with nothing left collapse.
  Same capabilities as v0.1.2.

## v0.1.4 (done)

- Other machines' workspaces open in **this computer's** window again. Orca leaves paired servers out of
  the host API's `workspace.list`, so `workspace.open` never reached them: the board now uses the CLI's
  `terminal switch --environment <server>` to the agent's or the workspace's terminal, and for a
  chat-only workspace a temporary "Agent Board" terminal it creates, switches to and always closes.
  Success only when Orca says the window navigated; otherwise the panel says why. Same capabilities
  as v0.1.3.

## Later

- Drop the CLI and the session-store read as Orca's host API grows (see the gaps in
  [orca-data-sources.md](orca-data-sources.md)).
- Focus a chat tab directly once Orca has an API for it.
