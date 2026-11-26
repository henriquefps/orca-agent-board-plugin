// Turns what Orca answers (the CLI's JSON, or the plugin host API) into a BoardSnapshot.
// Pure functions over plain data, so tests feed them invented fixtures.

import {
  LOCAL_HOST,
  projectKeyOf,
  projectNames,
  type AgentState,
  type BoardAgent,
  type BoardSnapshot,
  type BoardWorkspace,
  type RepoRow
} from './model.ts'

const MSG_MAX = 400
const PROMPT_MAX = 240

const clip = (s: unknown, n: number): string | null => {
  if (typeof s !== 'string' || !s) return null
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
const str = (x: unknown): string => (typeof x === 'string' ? x : '')
const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])

const STATES = new Set<AgentState>(['working', 'waiting', 'blocked', 'done'])
const asState = (x: unknown): AgentState => (STATES.has(x as AgentState) ? (x as AgentState) : 'done')

// ---------------------------------------------------------------------------------------------
// CLI: `environment list`, `repo list --environment <env>`, `worktree ps --environment <env>`.

/**
 * `env` is the CLI's `--environment` name; `id` the paired environment's id, which the host API
 * names as `runtime:<id>` in `workspace.list` rows (null for this computer).
 */
export type CliHost = { env: string; label: string; id?: string | null }

/** This computer plus every paired Orca server. */
export function hostsFromEnvironments(envList: unknown): CliHost[] {
  const hosts: CliHost[] = [{ env: 'local', label: LOCAL_HOST, id: null }]
  for (const e of arr(obj(envList).environments)) {
    const name = str(obj(e).name)
    if (name && name !== 'local') hosts.push({ env: name, label: name, id: str(obj(e).id) || null })
  }
  return hosts
}

/** The host API's `hostId` for a CLI host: `local`, or `runtime:<environment id>`. */
export const hostIdOfCliHost = (h: CliHost): string | null => (h.env === 'local' ? 'local' : h.id ? `runtime:${h.id}` : null)

export function reposFromCli(host: string, repoList: unknown): RepoRow[] {
  return arr(obj(repoList).repos).map((r0) => {
    const r = obj(r0)
    return {
      host,
      id: str(r.id),
      path: str(r.path),
      displayName: str(r.displayName) || null,
      canonicalKey: str(obj(r.gitRemoteIdentity).canonicalKey) || null
    }
  })
}

export function agentFromCli(wsId: string, a0: unknown, index = 0): BoardAgent {
  const a = obj(a0)
  const paneKey = str(a.paneKey) || null
  const kind = paneKey?.startsWith('structured-agent-session') ? 'chat' : 'terminal'
  const sessionId = str(a.orcaSessionId) || null
  const address = str(a.address)
  return {
    id: `${wsId}|${sessionId ?? paneKey ?? `#${index}`}`,
    sessionId,
    paneKey,
    terminal: kind === 'terminal' && address.startsWith('term_') ? address : null,
    kind,
    agent: str(a.agentType) || null,
    state: asState(a.state),
    outcome: str(obj(a.mainAgent).outcome) || null,
    interrupted: a.interrupted === true,
    title: clip(a.conversationName, 200) ?? clip(a.displayName, 200) ?? clip(a.taskTitle, 200),
    prompt: clip(a.prompt, PROMPT_MAX),
    last: clip(a.lastAssistantMessage, MSG_MAX),
    subagents: arr(a.children).length,
    updatedAt: num(a.updatedAt) || num(a.stateStartedAt),
    unread: obj(a.activity).unread === true
  }
}

type ParentRef = { host: string | null; keys: string[] }

export type CliHostData = { host: CliHost; ps?: unknown; repos?: RepoRow[]; error?: string }

/**
 * Builds the snapshot from every host's `worktree ps` and `repo list`. A project is a Git remote
 * (`canonicalKey`); repositories without one stay per host.
 */
export function snapshotFromCli(data: readonly CliHostData[], extra: BoardWorkspace[] = []): Omit<BoardSnapshot, 'at' | 'tookMs' | 'notices'> {
  const repos = data.flatMap((d) => d.repos ?? [])
  const projectOf = new Map(repos.map((r) => [`${r.host}|${r.id}`, projectKeyOf(r)]))
  const names = projectNames(repos)
  const labelOfEnv = new Map(data.map((d) => [d.host.env, d.host.label]))
  const errors: string[] = []
  const workspaces: BoardWorkspace[] = []
  const parents = new Map<string, ParentRef>()
  const index = new Map<string, string>()

  for (const d of data) {
    const h = d.host
    if (d.error || !d.ps) {
      errors.push(`${h.label}: ${d.error ?? 'no answer'}`)
      continue
    }
    for (const w0 of arr(obj(d.ps).worktrees)) {
      const w = obj(w0)
      const worktreeId = str(w.worktreeId)
      if (!worktreeId) continue
      const id = `${h.label}|${worktreeId}`
      const repo = str(w.repo)
      const project = projectOf.get(`${h.label}|${str(w.repoId)}`) ?? `${h.label}:${repo}`
      if (!names.has(project)) names.set(project, repo)
      const address = obj(w.address)
      const agents = arr(w.agents)
        .map((a, i) => agentFromCli(id, a, i))
        .sort((x, y) => y.updatedAt - x.updatedAt)
      const identityKey = str(obj(w.identity).key)
      workspaces.push({
        id,
        host: h.label,
        env: str(address.environment) || h.env,
        selector: str(address.worktree) || `id:${worktreeId}`,
        hostWorkspaceId: identityKey ? `identity:${identityKey}` : worktreeId,
        hostId: hostIdOfCliHost(h),
        project,
        repo,
        name: str(w.displayName) || repo,
        branch: str(w.branch).replace(/^refs\/heads\//, ''),
        path: str(w.path),
        kanban: str(w.workspaceStatus) || null,
        unread: w.unread === true,
        pinned: w.isPinned === true,
        isMain: w.isMainWorktree === true,
        floating: false,
        prs: arr(w.linkedItems)
          .map(obj)
          .filter((i) => i.type === 'pr' && typeof i.url === 'string')
          .map((i) => ({ number: num(i.number), url: str(i.url) })),
        parentId: null,
        parentMissing: false,
        lastAt: Math.max(num(w.lastActivityAt), ...agents.map((a) => a.updatedAt)),
        agents
      })
      const p = obj(w.parent)
      if (w.parent) {
        const envName = str(obj(p.environment).name) || (typeof p.environment === 'string' ? p.environment : '')
        parents.set(id, {
          host: envName ? (labelOfEnv.get(envName) ?? (envName === 'local' ? LOCAL_HOST : envName)) : null,
          keys: [str(p.selector), str(obj(p.address).worktree)].filter(Boolean)
        })
      } else if (typeof w.parentWorktreeId === 'string' && w.parentWorktreeId) {
        parents.set(id, { host: h.label, keys: [w.parentWorktreeId] })
      }
      for (const k of [worktreeId, `id:${worktreeId}`, identityKey, identityKey && `identity:${identityKey}`]) {
        if (k) index.set(`${h.label}|${k}`, id)
      }
    }
  }

  for (const ws of workspaces) {
    const ref = parents.get(ws.id)
    if (!ref) continue
    // The parent's host when named, else this host first, then any host.
    const hostsToTry = ref.host ? [ref.host] : [ws.host, ...data.map((d) => d.host.label)]
    for (const host of hostsToTry) {
      for (const k of ref.keys) {
        const hit = index.get(`${host}|${k}`)
        if (hit && hit !== ws.id) {
          ws.parentId = hit
          break
        }
      }
      if (ws.parentId) break
    }
    ws.parentMissing = !ws.parentId
  }

  for (const f of extra) {
    workspaces.push(f)
    names.set(f.project, 'Floating workspace')
  }
  return {
    source: 'cli',
    hosts: data.map((d) => d.host.label),
    projects: Object.fromEntries(names),
    workspaces,
    errors
  }
}

/** The floating workspace's chats, from `agent show <id>` answers (newest first). */
export function floatingWorkspace(shows: readonly unknown[]): BoardWorkspace | null {
  const id = `${LOCAL_HOST}|global-floating-terminal`
  const agents: BoardAgent[] = []
  for (const s of shows) {
    const r = obj(s)
    const p = obj(arr(r.places)[0])
    if (!p.paneKey && !p.title) continue
    const sessionId = str(r.orcaSessionId) || str(p.orcaSessionId) || null
    agents.push({
      id: `${id}|${sessionId ?? str(p.paneKey)}`,
      sessionId,
      paneKey: str(p.paneKey) || null,
      terminal: null,
      kind: 'chat',
      agent: str(p.agent) || null,
      state: asState(p.state),
      outcome: null,
      interrupted: false,
      title: clip(p.title, 200),
      prompt: null,
      last: clip(p.lastAssistantMessage, MSG_MAX),
      subagents: 0,
      updatedAt: num(p.updatedAt),
      unread: false
    })
  }
  if (!agents.length) return null
  agents.sort((x, y) => y.updatedAt - x.updatedAt)
  return {
    id,
    host: LOCAL_HOST,
    env: 'local',
    selector: null,
    hostWorkspaceId: null,
    hostId: null,
    project: `${LOCAL_HOST}:floating`,
    repo: 'Floating',
    name: 'floating workspace',
    branch: '',
    path: '',
    kanban: null,
    unread: false,
    pinned: false,
    isMain: false,
    floating: true,
    prs: [],
    parentId: null,
    parentMissing: false,
    lastAt: agents[0]?.updatedAt ?? 0,
    agents
  }
}

// ---------------------------------------------------------------------------------------------
// Host API only: `workspace.list` (includeStatus), `project.list`, `agents.list` per workspace.
// No parents, no Git remotes, no other Orca servers, no last replies.

export type HostWorkspaceRow = {
  id: string
  kind: 'worktree' | 'folder'
  name: string
  project?: string | null
  projectId?: string | null
  path: string
  branch: string | null
  hostId: string | null
  status?: { state: string; unread: boolean; terminalCount: number; lastActivityAt: number | null }
}
export type HostProjectRow = { id: string; name: string; hostId: string | null; path: string }
export type HostAgentRow = {
  terminalId: string | null
  title: string | null
  agent: string | null
  state: AgentState
  stateStartedAt: number
  sessionId?: string | null
}

export function hostLabel(hostId: string | null | undefined): string {
  if (!hostId || hostId === 'local') return LOCAL_HOST
  const [kind, ...rest] = hostId.split(':')
  const name = rest.join(':')
  return kind === 'ssh' || kind === 'runtime' ? name || hostId : hostId
}

export function snapshotFromHost(
  rows: readonly HostWorkspaceRow[],
  projects: readonly HostProjectRow[],
  agentsByWs: ReadonlyMap<string, readonly HostAgentRow[]>
): Omit<BoardSnapshot, 'at' | 'tookMs' | 'notices'> {
  const projectName = new Map(projects.map((p) => [p.id, p.name]))
  const hosts = new Set<string>([LOCAL_HOST])
  const workspaces: BoardWorkspace[] = rows.map((r) => {
    const host = hostLabel(r.hostId)
    hosts.add(host)
    const id = `${host}|${r.id}`
    const project = r.projectId ? `${host}:${r.projectId}` : `${host}:${r.path}`
    const agents: BoardAgent[] = (agentsByWs.get(r.id) ?? [])
      .map((a, i) => ({
        id: `${id}|${a.sessionId ?? a.terminalId ?? i}`,
        sessionId: a.sessionId ?? null,
        paneKey: null,
        terminal: a.terminalId,
        kind: a.terminalId ? ('terminal' as const) : ('chat' as const),
        agent: a.agent,
        state: asState(a.state),
        outcome: null,
        interrupted: false,
        title: clip(a.title, 200),
        prompt: null,
        last: null,
        subagents: 0,
        updatedAt: a.stateStartedAt,
        unread: false
      }))
      .sort((x, y) => y.updatedAt - x.updatedAt)
    return {
      id,
      host,
      env: r.hostId ?? 'local',
      selector: null,
      hostWorkspaceId: r.id,
      hostId: r.hostId ?? 'local',
      project,
      repo: r.project || (r.projectId && projectName.get(r.projectId)) || r.name,
      name: r.name,
      branch: r.branch ?? '',
      path: r.path,
      kanban: null,
      unread: r.status?.unread === true,
      pinned: false,
      isMain: false,
      floating: false,
      prs: [],
      parentId: null,
      parentMissing: false,
      lastAt: Math.max(r.status?.lastActivityAt ?? 0, ...agents.map((a) => a.updatedAt)),
      agents
    }
  })
  const names: Record<string, string> = {}
  for (const w of workspaces) {
    const r = rows.find((x) => `${hostLabel(x.hostId)}|${x.id}` === w.id)
    names[w.project] = (r?.projectId && projectName.get(r.projectId)) || w.repo
  }
  return { source: 'host', hosts: [...hosts], projects: names, workspaces, errors: [] }
}
