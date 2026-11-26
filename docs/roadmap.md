# Roadmap

## M0: prototype (done)

`prototype/`: a local Node server that reads Orca through its CLI and serves the board as one page, sized
like Orca's right sidebar (about 470 px). Used to settle what the board shows.

## M1: plugin skeleton

- `worker-panel` plugin (`orca plugin create --template worker-panel`): a right-sidebar panel drawn with
  Orca's components, backed by a worker.
- The worker builds the snapshot the prototype builds today: the host API where it is enough, the `orca`
  CLI where it is not (parents, Git remotes, other hosts).
- List view with the filters (Needs me, Running, Unread, Hide children, Hide idle), host filter and search.
- Live updates from `agent.status.changed` and `workspace.changed` instead of polling only.
- Click opens the workspace (`workspace.open`).

## M2: all views

- Projects and Tree views.
- Status bar item: how many agents need you.
- Settings: default view, hosts to include.

## M3: publish

- Tests (`orca plugin test`, `orca plugin check`), screenshots, `orca plugin validate`.
- Release tag and catalog entry (`orca plugin release-entry`).
