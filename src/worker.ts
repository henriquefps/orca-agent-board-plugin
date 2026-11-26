// Agent Board's worker: builds the board from Orca (the Orca CLI where it is available, the
// plugin host API otherwise), answers the panel, opens workspaces and keeps the status bar item.
import type { OrcaWorkerApi } from 'orca/worker'
import { writeClipboard, type CopyAnswer } from './clipboard.ts'
import { cliRunner, floatingReader, resolveCli, type CliAnswer, type CliRunner, type FloatingReader } from './cli.ts'
import {
  needsMeCount,
  NOTICE_NO_CLI,
  noticeCliFailed,
  noticeRemoteNeedsCli,
  noticeRemoteNoAddress,
  noticeRemoteNoTerminal,
  noticeRemoteNotNavigated,
  noticeRemoteSwitchFailed,
  TEMP_TERMINAL_TITLE,
  type BoardAgent,
  type BoardSnapshot,
  type BoardWorkspace
} from './model.ts'
import type { CopyResult, MarkReadResult, OpenResult } from './protocol.ts'
import {
  createdHandle,
  floatingWorkspace,
  navigated,
  notNavigatedReason,
  hostsFromEnvironments,
  reposFromCli,
  snapshotFromCli,
  snapshotFromHost,
  type CliHost,
  type CliHostData,
  type HostAgentRow,
  type HostProjectRow,
  type HostWorkspaceRow
} from './sources.ts'

export const PANEL_ID = 'agent-board'
export const STATUS_ITEM = 'needs-you'


/** Background refresh for the status bar while no panel is open: one `worktree ps` cycle a minute. */
const BACKGROUND_MS = 60_000
/** A snapshot this fresh answers a panel request without asking Orca again. */
const FRESH_MS = 3_000
const ENV_TTL_MS = 60_000
const REPO_TTL_MS = 120_000
const FLOATING_TTL_MS = 20_000
const HOST_AGENT_CALLS = 60

/** Test seams: `plugin test` swaps the CLI and the floating-chat reader for fakes. */
export const deps: {
  cli?: CliRunner | null
  floating?: FloatingReader | null
  /** The clipboard writer (`writeClipboard`); tests swap in a fake. */
  copy?: (text: string) => Promise<CopyAnswer>
  now?: () => number
  debounceMs?: number
} = {}

type Settings = { pollSeconds: number; floatingChats: boolean }

export default function activate(orca: OrcaWorkerApi): void {
  const now = deps.now ?? Date.now
  const cliPath = deps.cli === undefined ? resolveCli() : null
  const cli: CliRunner | null = deps.cli !== undefined ? deps.cli : cliPath ? cliRunner(cliPath) : null
  const readFloating: FloatingReader | null = deps.floating !== undefined ? deps.floating : floatingReader()
  orca.log(cli ? `Orca CLI: ${cliPath ?? 'test runner'}` : 'Orca CLI not found; using the host API only')

  let snap: BoardSnapshot | null = null
  let inflight: Promise<BoardSnapshot> | null = null
  let lastPanelAt = 0
  let lastShownCount = -1
  let lastBackgroundAt = 0
  let eventTimer: ReturnType<typeof setTimeout> | null = null
  const terminalByPane = new Map<string, string>()
  let envCache: { at: number; hosts: CliHost[] } | null = null
  const repoCache = new Map<string, { at: number; repos: ReturnType<typeof reposFromCli> }>()
  let floatingCache: { at: number; ws: BoardWorkspace | null } | null = null

  async function settings(): Promise<Settings> {
    try {
      const s = await orca.settings.get()
      const poll = typeof s.pollSeconds === 'number' ? s.pollSeconds : 15
      return { pollSeconds: Math.min(600, Math.max(5, poll)), floatingChats: s.floatingChats !== false }
    } catch {
      return { pollSeconds: 15, floatingChats: true }
    }
  }

  const panelOpen = async (): Promise<boolean> =>
    now() - lastPanelAt < Math.max(30_000, (await settings()).pollSeconds * 2_000)

  // -- CLI snapshot ------------------------------------------------------------------------------

  async function cliHosts(run: CliRunner): Promise<CliHost[]> {
    if (envCache && now() - envCache.at < ENV_TTL_MS) return envCache.hosts
    const envs = await run(['environment', 'list'])
    const hosts = hostsFromEnvironments(envs.result)
    envCache = { at: now(), hosts }
    return hosts
  }

  async function cliRepos(run: CliRunner, h: CliHost): Promise<ReturnType<typeof reposFromCli>> {
    const c = repoCache.get(h.env)
    if (c && now() - c.at < REPO_TTL_MS) return c.repos
    const r = await run(['repo', 'list', '--environment', h.env])
    const repos = r.error ? (c?.repos ?? []) : reposFromCli(h.label, r.result)
    repoCache.set(h.env, { at: now(), repos })
    return repos
  }

  async function floating(run: CliRunner, on: boolean): Promise<BoardWorkspace | null> {
    if (!on || !readFloating) return null
    if (floatingCache && now() - floatingCache.at < FLOATING_TTL_MS) return floatingCache.ws
    let ws: BoardWorkspace | null = null
    try {
      const ids = await readFloating()
      if (ids?.length) {
        const shows = await Promise.all(ids.map((id) => run(['agent', 'show', id], { timeoutMs: 10_000 })))
        ws = floatingWorkspace(shows.map((s) => s.result).filter(Boolean))
      }
    } catch {
      ws = null
    }
    floatingCache = { at: now(), ws }
    return ws
  }

  async function fromCli(run: CliRunner, s: Settings): Promise<Omit<BoardSnapshot, 'at' | 'tookMs' | 'notices'>> {
    const hosts = await cliHosts(run)
    const [data, extra] = await Promise.all([
      Promise.all(
        hosts.map(async (h): Promise<CliHostData> => {
          const [repos, ps] = await Promise.all([
            cliRepos(run, h),
            run(['worktree', 'ps', '--limit', '10000', '--environment', h.env])
          ])
          return ps.error ? { host: h, repos, error: ps.error } : { host: h, repos, ps: ps.result }
        })
      ),
      floating(run, s.floatingChats)
    ])
    return snapshotFromCli(data, extra ? [extra] : [])
  }

  // -- Host API snapshot ---------------------------------------------------------------------------

  async function fromHost(): Promise<Omit<BoardSnapshot, 'at' | 'tookMs' | 'notices'>> {
    const [wl, pl] = await Promise.all([
      orca.host.call('workspace.list', { includeStatus: true }),
      orca.host.call('project.list', {}).catch(() => ({ projects: [] as HostProjectRow[], truncated: false }))
    ])
    const rows = wl.workspaces as HostWorkspaceRow[]
    // agents.list is one call per workspace: ask only where something runs, newest first.
    const busy = rows
      .filter((r) => (r.status?.terminalCount ?? 0) > 0 || r.status?.unread)
      .sort((a, b) => (b.status?.lastActivityAt ?? 0) - (a.status?.lastActivityAt ?? 0))
      .slice(0, HOST_AGENT_CALLS)
    const agentsByWs = new Map<string, HostAgentRow[]>()
    await Promise.all(
      busy.map(async (r) => {
        try {
          const a = await orca.host.call('agents.list', { workspaceId: r.id })
          agentsByWs.set(r.id, a.agents as HostAgentRow[])
        } catch {
          // A workspace that closed meanwhile: leave it without agents.
        }
      })
    )
    return snapshotFromHost(rows, pl.projects as HostProjectRow[], agentsByWs)
  }

  // -- Refresh -----------------------------------------------------------------------------------

  async function build(): Promise<BoardSnapshot> {
    const t0 = now()
    const s = await settings()
    const notices: string[] = []
    let base: Omit<BoardSnapshot, 'at' | 'tookMs' | 'notices'> | null = null
    if (cli) {
      const cliBase = await fromCli(cli, s)
      // The CLI is there but could not read this computer: fall back to the host API.
      const localError = cliBase.errors.find((e) => e.startsWith(`${cliBase.hosts[0]}:`))
      if (localError && !cliBase.workspaces.some((w) => w.env === 'local' && !w.floating)) {
        notices.push(noticeCliFailed(localError.slice(localError.indexOf(':') + 1).trim()))
      } else base = cliBase
    } else notices.push(NOTICE_NO_CLI)
    if (!base) {
      try {
        base = await fromHost()
      } catch (e) {
        base = { source: 'host', hosts: [], projects: {}, workspaces: [], errors: [`Orca: ${(e as Error).message}`] }
      }
    }
    return { ...base, at: now(), tookMs: now() - t0, notices }
  }

  async function refresh(): Promise<BoardSnapshot> {
    if (inflight) return inflight
    inflight = build()
      .then(async (next) => {
        snap = next
        await showCount(next)
        return next
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  async function showCount(s: BoardSnapshot): Promise<void> {
    const n = needsMeCount(s)
    if (n === lastShownCount) return
    lastShownCount = n
    try {
      await orca.host.call('statusBar.update', {
        id: STATUS_ITEM,
        text: n === 1 ? '1 needs you' : `${n} need you`,
        tooltip: `Agent Board: ${n} agent${n === 1 ? '' : 's'} waiting for you or unread`,
        visible: n > 0
      })
    } catch {
      // Web clients and servers have no status bar.
    }
  }

  async function backgroundTick(): Promise<void> {
    if (await panelOpen()) return
    if (now() - lastBackgroundAt < BACKGROUND_MS - 1_000) return
    lastBackgroundAt = now()
    await refresh().catch(() => undefined)
  }

  /** Orca changed something: refresh soon, and tell open panels. */
  function onOrcaChange(): void {
    void (async () => {
      if (!(await panelOpen())) return backgroundTick()
      if (eventTimer) clearTimeout(eventTimer)
      eventTimer = setTimeout(() => {
        eventTimer = null
        void refresh()
          .then((s) => orca.panels.post('board.changed', { at: s.at }))
          .catch(() => undefined)
      }, deps.debounceMs ?? 1_500)
    })()
  }

  orca.events.on('agent.status.changed', (e) => {
    if (e.paneKey && e.terminalId) terminalByPane.set(e.paneKey, e.terminalId)
    onOrcaChange()
  })
  orca.events.on('workspace.changed', () => onOrcaChange())
  orca.events.on('workspace.created', () => onOrcaChange())
  orca.events.on('workspace.removed', () => onOrcaChange())

  // The manifest cannot declare the item hidden: hide it until the first count is in.
  void orca.host.call('statusBar.update', { id: STATUS_ITEM, visible: false }).catch(() => undefined)
  const ticker = setInterval(() => void backgroundTick(), BACKGROUND_MS)
  const first = setTimeout(() => void backgroundTick(), 15_000)
  stopTimers = () => {
    clearInterval(ticker)
    clearTimeout(first)
    if (eventTimer) clearTimeout(eventTimer)
  }

  orca.panels.handle('board.snapshot', async (input) => {
    lastPanelAt = now()
    if (!input?.force && snap && now() - snap.at < FRESH_MS) return snap
    return refresh()
  })

  // -- Opening -----------------------------------------------------------------------------------
  // Everything opens in THIS computer's Orca window.
  // - This computer: `terminal.focus` for a terminal agent, else `workspace.open` with the
  //   `workspace.list` row, else `worktree activate` through the CLI.
  // - A paired Orca server: `workspace.list` never lists its workspaces (the host API is built from
  //   the local runtime's `worktree.list`, whose `hostScope` names paired servers as omitted), so
  //   `workspace.open` cannot reach them. The CLI's `terminal switch --environment <server>` moves
  //   this window to a terminal's workspace: the agent's own terminal, else one of the workspace's,
  //   else a temporary terminal the board creates, switches to and always closes again.
  //   `worktree activate --environment <server>` would open the server's own window: never used.

  let wsListCache: { at: number; rows: HostWorkspaceRow[] } | null = null
  async function hostRows(fresh = false): Promise<HostWorkspaceRow[]> {
    if (wsListCache && now() - wsListCache.at < (fresh ? 2_000 : 30_000)) return wsListCache.rows
    const wl = await orca.host.call('workspace.list', {})
    wsListCache = { at: now(), rows: wl.workspaces as HostWorkspaceRow[] }
    return wsListCache.rows
  }

  /** The `workspace.list` id of a board workspace on this computer: the same id, else the same path. */
  async function hostRowOf(s: BoardSnapshot, w: BoardWorkspace): Promise<string | null> {
    if (w.floating) return null
    if (s.source === 'host') return w.hostWorkspaceId
    if (w.hostId !== 'local') return null
    const find = (all: HostWorkspaceRow[]): string | null => {
      const rows = all.filter((r) => !r.hostId || r.hostId === 'local')
      const hit = rows.find((r) => r.id === w.hostWorkspaceId) ?? rows.find((r) => !!w.path && r.path === w.path)
      return hit?.id ?? null
    }
    try {
      // A workspace made since the last read: ask Orca again once.
      return find(await hostRows()) ?? find(await hostRows(true))
    } catch {
      return null
    }
  }

  async function terminalIdOf(s: BoardSnapshot, a: BoardAgent | undefined, hostWs: string): Promise<string | null> {
    if (!a || a.kind !== 'terminal') return null
    if (s.source === 'host' && a.terminal) return a.terminal
    if (a.paneKey && terminalByPane.has(a.paneKey)) return terminalByPane.get(a.paneKey) ?? null
    try {
      const { agents } = await orca.host.call('agents.list', { workspaceId: hostWs })
      const hit =
        agents.find((x) => x.sessionId && x.sessionId === a.sessionId) ??
        agents.find((x) => x.title && x.title === a.title) ??
        (agents.length === 1 ? agents[0] : undefined)
      return hit?.terminalId ?? null
    } catch {
      return null
    }
  }

  type TerminalRow = { handle?: string; connected?: boolean; agentIdentity?: unknown }
  const terminalRows = (r: CliAnswer): TerminalRow[] =>
    ((r.result as { terminals?: TerminalRow[] } | undefined)?.terminals ?? []).filter((t) => t.connected !== false && !!t.handle)

  /** A terminal of this computer's workspace (the agent's own when it has one), shown by the CLI. */
  async function switchTerminal(run: CliRunner, w: BoardWorkspace, a: BoardAgent | undefined): Promise<OpenResult | null> {
    if (!w.selector) return null
    let handle = a?.terminal ?? null
    if (!handle) {
      const terms = terminalRows(await run(['terminal', 'list', '--environment', w.env, '--worktree', w.selector]))
      handle = (terms.find((t) => t.agentIdentity) ?? terms[0])?.handle ?? null
    }
    if (!handle) return null
    const r = await run(['terminal', 'switch', '--environment', w.env, '--terminal', handle])
    return r.error ? { ok: false, how: 'terminal switch', error: r.error } : { ok: true, how: 'terminal switch' }
  }

  /** This computer's workspace through the CLI: `worktree activate`, then the agent's terminal. */
  async function activateLocal(run: CliRunner, w: BoardWorkspace, a: BoardAgent | undefined): Promise<OpenResult> {
    if (!w.selector) return { ok: false, how: 'none', error: 'Orca cannot open this workspace from a plugin' }
    const r = await run(['worktree', 'activate', '--environment', w.env, '--worktree', w.selector])
    if (!r.error) {
      if (a?.terminal) {
        await run(['terminal', 'switch', '--environment', w.env, '--terminal', a.terminal])
        return { ok: true, how: 'worktree activate + terminal switch' }
      }
      return { ok: true, how: 'worktree activate' }
    }
    return (await switchTerminal(run, w, a)) ?? { ok: false, how: 'worktree activate', error: r.error }
  }

  /** `terminal switch` on a paired server: success only when Orca says this window navigated. */
  async function switchRemote(run: CliRunner, w: BoardWorkspace, handle: string, how: string): Promise<OpenResult> {
    const r = await run(['terminal', 'switch', '--environment', w.env, '--terminal', handle])
    if (r.error) return { ok: false, how, error: noticeRemoteSwitchFailed(w.host, r.error) }
    if (navigated(r.result)) return { ok: true, how }
    return { ok: false, how, error: noticeRemoteNotNavigated(w.host, notNavigatedReason(r.result)) }
  }

  /**
   * A paired server's workspace in this window: `terminal switch` to the agent's live terminal or
   * one of the workspace's connected terminals; with none, a temporary terminal (create, switch,
   * close). Only the terminal the board created is ever closed, also when the switch fails.
   */
  async function openRemote(run: CliRunner, w: BoardWorkspace, a: BoardAgent | undefined): Promise<OpenResult> {
    if (!w.selector) return { ok: false, how: 'none', error: noticeRemoteNoAddress(w.host) }
    const list = await run(['terminal', 'list', '--environment', w.env, '--worktree', w.selector])
    const terms = terminalRows(list)
    const own = a?.kind === 'terminal' && a.terminal && (list.error || terms.some((t) => t.handle === a.terminal)) ? a.terminal : null
    const existing = own ?? (terms.find((t) => t.agentIdentity) ?? terms[0])?.handle ?? null
    if (existing) return switchRemote(run, w, existing, 'terminal switch')

    const how = 'temporary terminal'
    const made = await run(['terminal', 'create', '--environment', w.env, '--worktree', w.selector, '--title', TEMP_TERMINAL_TITLE])
    const temp = createdHandle(made.result)
    if (!temp) return { ok: false, how, error: noticeRemoteNoTerminal(w.host, made.error ?? 'Orca did not give a terminal handle') }
    try {
      return await switchRemote(run, w, temp, how)
    } catch (e) {
      return { ok: false, how, error: noticeRemoteSwitchFailed(w.host, (e as Error).message) }
    } finally {
      const closed = await run(['terminal', 'close', '--environment', w.env, '--terminal', temp]).catch((e: Error) => ({ error: e.message }))
      if (closed.error) orca.log(`Agent Board could not close its temporary terminal ${temp} on ${w.host}: ${closed.error}`)
    }
  }

  orca.panels.handle('board.open', async ({ workspaceId, agentId }): Promise<OpenResult> => {
    const s = snap ?? (await refresh())
    const w = s.workspaces.find((x) => x.id === workspaceId)
    if (!w) return { ok: false, how: 'none', error: 'This workspace is gone; refresh the board.' }
    if (w.floating) {
      try {
        await orca.host.call('commands.run', { action: 'floatingWorkspace.maximize' })
        return { ok: true, how: 'floating workspace' }
      } catch (e) {
        // Orca refuses to maximize a floating workspace that is not open, and plugins cannot open it.
        return { ok: false, how: 'floating workspace', error: (e as Error).message, code: 'floating-closed' }
      }
    }
    const a = w.agents.find((x) => x.id === agentId)
    // A paired Orca server: only the CLI can show it here.
    if (s.source === 'cli' && w.env !== 'local') {
      return cli ? openRemote(cli, w, a) : { ok: false, how: 'none', error: noticeRemoteNeedsCli(w.host) }
    }
    const remote = s.source === 'host' && !!w.hostId && w.hostId !== 'local'
    const row = await hostRowOf(s, w)
    let error: string | null = null

    if (row) {
      const term = await terminalIdOf(s, a, row)
      if (term) {
        try {
          const { focused } = await orca.host.call('terminal.focus', { terminalId: term })
          if (focused) return { ok: true, how: 'terminal.focus' }
        } catch (e) {
          error = (e as Error).message
        }
      }
      try {
        await orca.host.call('workspace.open', { workspaceId: row })
        return { ok: true, how: 'workspace.open' }
      } catch (e) {
        error = (e as Error).message
      }
    }
    if (cli && !remote) return activateLocal(cli, w, a)
    return {
      ok: false,
      how: 'none',
      error: error ?? (remote ? noticeRemoteNeedsCli(w.host) : 'Orca cannot open this workspace from a plugin.')
    }
  })

  // -- Card actions ------------------------------------------------------------------------------

  /** At most this much text goes to the clipboard: an id or a path, never a transcript. */
  const COPY_MAX = 4096
  orca.panels.handle('board.copy', async (input): Promise<CopyResult> => {
    const text = typeof input?.text === 'string' ? input.text : ''
    if (!text || text.length > COPY_MAX) return { ok: false, error: 'nothing to copy' }
    try {
      return await (deps.copy ?? writeClipboard)(text)
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // Orca keeps read state per workspace: `worktree set --read` clears the workspace's unread dot
  // on whichever host it lives (`--environment`). The panel refreshes the board after.
  orca.panels.handle('board.markRead', async ({ workspaceId }): Promise<MarkReadResult> => {
    const s = snap ?? (await refresh())
    const w = s.workspaces.find((x) => x.id === workspaceId)
    if (!w) return { ok: false, error: 'This workspace is gone; refresh the board.' }
    if (w.floating || !w.selector) return { ok: false, error: 'Orca cannot mark this workspace read from the board.' }
    if (!cli) return { ok: false, error: 'Marking a workspace read needs the Orca CLI.' }
    const r = await cli(['worktree', 'set', '--environment', w.env, '--worktree', w.selector, '--read'])
    return r.error ? { ok: false, error: r.error } : { ok: true }
  })

  // -- Status bar: pressing the item shows the panel ---------------------------------------------

  orca.commands.register('show', async () => {
    if (cli) {
      const list = await cli(['plugin', 'list'])
      const plugins = (list.result as { plugins?: { pluginKey: string; status?: string; panels?: { id: string }[] }[] })?.plugins ?? []
      const mine = plugins
        .filter((p) => p.pluginKey.endsWith('.agent-board') && (p.panels ?? []).some((x) => x.id === PANEL_ID))
        .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running'))[0]
      if (mine) {
        const r = await cli(['plugin', 'open', mine.pluginKey, '--panel', PANEL_ID])
        if (!r.error) return 'Agent Board'
      }
    }
    await orca.host.call('commands.run', { action: 'sidebar.right.toggle' })
    return 'Agent Board'
  })
}

let stopTimers: (() => void) | null = null

export function deactivate(): void {
  stopTimers?.()
  stopTimers = null
}
