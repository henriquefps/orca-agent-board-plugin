# Agent Board for Orca

An [Orca](https://github.com/stablyai/orca) plugin that lists your coding agents the way you work with them:
one list of chats across every machine Orca reaches, newest first, with what each one needs from you.

Orca lets one agent start many workers in their own worktrees, often on other machines, and merge their
work back. The built-in sidebar shows workspaces; Agent Board shows **agents**:

- **One list across hosts.** This machine and every paired Orca server, in one place.
- **Parents, not workers.** "Hide children" keeps only the chats you talk to. Each one says how many child
  workspaces it has and whether any of them is running, failed or waiting for you.
- **One project per repository.** Clones of the same Git remote on different machines are one project.
- **What needs you first.** Needs you, failed, running and unread each have their own icon, colour and
  label; finished and seen agents fade back.
- **Three views:** List (agents by last activity), Projects (grouped by repository, children nested under
  their parent) and Tree (the full parent/child chain across hosts and projects).

## Status

Early. The plugin itself is not built yet; `prototype/` holds a working HTML prototype that reads Orca
through its CLI. See [docs/roadmap.md](docs/roadmap.md).

## Try the prototype

Needs Node 20+ and the Orca desktop app running (macOS; the CLI ships with Orca).

```sh
node prototype/server.mjs
# open http://localhost:4870
```

The server only reads (`orca worktree ps`, `repo list`, `environment list`, `agent show`). A click on an agent
or workspace runs `orca worktree activate` to show that workspace in Orca, falling back to
`orca terminal switch`. Set `ORCA_CLI_COMMAND` to use another Orca executable and `PORT` for another port.

## How it gets its data

[docs/orca-data-sources.md](docs/orca-data-sources.md) lists what the Orca CLI and the plugin host API give,
and what is missing for this plugin.

## License

[MIT](LICENSE)
