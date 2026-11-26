// The board's data and rules, shared by the worker (snapshot, status bar count) and the panel
// (filters, views). Pure: no Orca, no Node, so tests and both surfaces load it as is.

export type AgentState = 'working' | 'waiting' | 'blocked' | 'done'

export type BoardAgent = {
  /** Unique on the board: `<workspace id>|<session or pane>`. */
  id: string
  sessionId: string | null
  paneKey: string | null
  /** CLI terminal handle (`term_…`) or host API terminal id, when the agent runs in a terminal. */
  terminal: string | null
  kind: 'chat' | 'terminal'
  agent: string | null
  state: AgentState
  outcome: string | null
  interrupted: boolean
  title: string | null
  prompt: string | null
  last: string | null
  subagents: number
  updatedAt: number
  unread: boolean
}

export type BoardPr = { number: number; url: string }

export type BoardWorkspace = {
  /** `<host>|<worktree id>` */
  id: string
  host: string
  /** CLI `--environment` name for this host. */
  env: string
  /** CLI `--worktree` selector; null when the CLI cannot address it (floating workspace). */
  selector: string | null
  /**
   * `workspace.list` id: the row's own id from the host API, or the id the CLI's worktree maps to
   * (`identity:<identity key>`, else the worktree id). Null for the floating workspace.
   */
  hostWorkspaceId: string | null
  /** `workspace.list` `hostId` of this workspace's host: `local`, `runtime:<environment id>`, … */
  hostId: string | null
  /** Project key: the Git remote's canonical key, else `<host>:<repo path or id>`. */
  project: string
  repo: string
  name: string
  branch: string
  path: string
  kanban: string | null
  unread: boolean
  pinned: boolean
  isMain: boolean
  floating: boolean
  prs: BoardPr[]
  parentId: string | null
  parentMissing: boolean
  lastAt: number
  /** Newest first. */
  agents: BoardAgent[]
}

export type DataSource = 'cli' | 'host'

export type BoardSnapshot = {
  at: number
  tookMs: number
  source: DataSource
  /** Host labels, this computer first. */
  hosts: string[]
  /** Project key -> display name. */
  projects: Record<string, string>
  workspaces: BoardWorkspace[]
  /** Per-host failures worth showing ("Build server: timed out"). */
  errors: string[]
  /** Features that are off and why, shown as a small notice. */
  notices: string[]
}

export const LOCAL_HOST = 'Local'

const CLI_FEATURES = 'parent and child workspaces, other Orca servers, projects by Git remote, linked PRs and last replies are off.'
export const NOTICE_NO_CLI = `Orca CLI not found: ${CLI_FEATURES}`
export const noticeCliFailed = (error: string): string => `Orca CLI failed (${error}): ${CLI_FEATURES}`

// Why a paired server's workspace did not open in this window (the panel puts "Could not open …:"
// in front). The board shows them with `terminal switch --environment <server>`.

/** The title of the temporary terminal the board opens (and closes) to show a chat-only workspace. */
export const TEMP_TERMINAL_TITLE = 'Agent Board'
export const noticeRemoteNeedsCli = (host: string): string =>
  `${host} is another Orca server; showing its workspaces in this window needs the Orca CLI.`
export const noticeRemoteNoAddress = (host: string): string =>
  `Orca gave no address for this ${host} workspace, so it cannot be shown in this window.`
export const noticeRemoteNoTerminal = (host: string, error: string): string =>
  `${host} did not open the terminal that shows its workspace in this window (${error}).`
export const noticeRemoteSwitchFailed = (host: string, error: string): string =>
  `Orca could not move this window to the ${host} workspace (${error}).`
export const noticeRemoteNotNavigated = (host: string, reason: string | null): string =>
  `Orca did not move this window to the ${host} workspace${reason ? ` (${reason})` : ''}.`

// ---------------------------------------------------------------------------------------------
// Status: one per agent card, most urgent first.

export type CardStatus = 'waiting' | 'failed' | 'working' | 'unread' | 'done'

export const isWaiting = (a: BoardAgent): boolean => a.state === 'waiting' || a.state === 'blocked'
export const isFailed = (a: BoardAgent): boolean =>
  a.state === 'done' && (a.outcome === 'failure' || a.interrupted)

/** The workspace's most recent agent: the card that carries the children summary. */
export const latestOf = (w: BoardWorkspace): BoardAgent | undefined => w.agents[0]
export const isLatest = (a: BoardAgent, w: BoardWorkspace): boolean => latestOf(w)?.id === a.id
export const agentUnread = (a: BoardAgent, w: BoardWorkspace): boolean =>
  a.unread || (w.unread && isLatest(a, w))

export function cardStatus(a: BoardAgent, w: BoardWorkspace): { status: CardStatus; label: string } {
  if (isWaiting(a)) return { status: 'waiting', label: a.state === 'blocked' ? 'blocked: needs you' : 'needs you' }
  if (isFailed(a)) return { status: 'failed', label: a.interrupted ? 'interrupted' : 'failed' }
  if (a.state === 'working') return { status: 'working', label: 'running' }
  if (agentUnread(a, w)) return { status: 'unread', label: 'unread' }
  return { status: 'done', label: 'done' }
}

export const STATUS_ORDER: readonly CardStatus[] = ['waiting', 'failed', 'working', 'unread', 'done']

// ---------------------------------------------------------------------------------------------
// Parents and children: children of a workspace are all its descendants, through parent links
// across hosts and projects.

export type Family = {
  byId: Map<string, BoardWorkspace>
  kids: Map<string, BoardWorkspace[]>
}

export function family(workspaces: readonly BoardWorkspace[]): Family {
  const byId = new Map(workspaces.map((w) => [w.id, w]))
  const kids = new Map<string, BoardWorkspace[]>()
  for (const w of workspaces) {
    if (!w.parentId || !byId.has(w.parentId)) continue
    const list = kids.get(w.parentId) ?? []
    list.push(w)
    kids.set(w.parentId, list)
  }
  return { byId, kids }
}

export function descendants(f: Family, w: BoardWorkspace): BoardWorkspace[] {
  const out: BoardWorkspace[] = []
  const seen = new Set<string>([w.id])
  const walk = (id: string): void => {
    for (const c of f.kids.get(id) ?? []) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push(c)
      walk(c.id)
    }
  }
  walk(w.id)
  return out
}

export type ChildSummary = { count: number; working: number; waiting: number; failed: number; unread: number }

export function childSummary(f: Family, w: BoardWorkspace): ChildSummary {
  const ds = descendants(f, w)
  const agents = ds.flatMap((d) => d.agents)
  return {
    count: ds.length,
    working: agents.filter((a) => a.state === 'working').length,
    waiting: agents.filter(isWaiting).length,
    failed: agents.filter(isFailed).length,
    unread: ds.filter((d) => d.unread || d.agents.some((a) => a.unread)).length
  }
}

// ---------------------------------------------------------------------------------------------
// Filters work per agent. A child's state counts only on its ancestor's most recent agent, the
// one that shows the children summary.

const childAgents = (f: Family, w: BoardWorkspace): BoardAgent[] => descendants(f, w).flatMap((d) => d.agents)

export const agentRunning = (f: Family, a: BoardAgent, w: BoardWorkspace): boolean =>
  a.state === 'working' || (isLatest(a, w) && childAgents(f, w).some((c) => c.state === 'working'))

export const agentNeedsMe = (f: Family, a: BoardAgent, w: BoardWorkspace): boolean =>
  isWaiting(a) || agentUnread(a, w) || (isLatest(a, w) && childAgents(f, w).some(isWaiting))

/** The card is highlighted: a descendant waits for the person. */
export const childNeedsMe = (f: Family, a: BoardAgent, w: BoardWorkspace): boolean =>
  isLatest(a, w) && childAgents(f, w).some(isWaiting)

/**
 * How loud a card is: its own status, except that the latest chat of a workspace whose child
 * needs the person looks like "needs you" (the most urgent status wins).
 */
export const cardEmphasis = (f: Family, a: BoardAgent, w: BoardWorkspace): CardStatus =>
  childNeedsMe(f, a, w) ? 'waiting' : cardStatus(a, w).status

export type FilterKey = 'needsMe' | 'running' | 'unread' | 'hideChildren' | 'hideIdle'
export type Filters = Record<FilterKey, boolean>
export type ViewName = 'list' | 'projects' | 'tree'

export const DEFAULT_FILTERS: Filters = {
  needsMe: false,
  running: false,
  unread: false,
  hideChildren: true,
  hideIdle: true
}

type AgentTest = (f: Family, a: BoardAgent, w: BoardWorkspace) => boolean

export const AGENT_FILTERS: readonly { key: 'needsMe' | 'running' | 'unread'; label: string; test: AgentTest }[] = [
  { key: 'needsMe', label: 'Needs me', test: agentNeedsMe },
  { key: 'running', label: 'Running', test: agentRunning },
  { key: 'unread', label: 'Unread', test: (_f, a, w) => agentUnread(a, w) }
]

export type BoardQuery = { view: ViewName; host: string; q: string; filters: Filters }

/** Host filter, and "Hide children" in the List view. */
export function inScope(query: BoardQuery, w: BoardWorkspace): boolean {
  if (query.host && w.host !== query.host) return false
  if (query.view === 'list' && query.filters.hideChildren && w.parentId) return false
  return true
}

/** A workspace with only the agents that pass the filters and search; `allAgents` keeps them all. */
export type VisibleWorkspace = BoardWorkspace & { allAgents: BoardAgent[] }

export function visibleWorkspaces(snap: BoardSnapshot, f: Family, query: BoardQuery): VisibleWorkspace[] {
  const q = query.q.trim().toLowerCase()
  const active = AGENT_FILTERS.filter((x) => query.filters[x.key])
  const out: VisibleWorkspace[] = []
  for (const w of snap.workspaces) {
    if (!inScope(query, w)) continue
    const wsText = [snap.projects[w.project], w.repo, w.name, w.branch].join(' ').toLowerCase()
    const agents = w.agents.filter((a) => {
      for (const x of active) if (!x.test(f, a, w)) return false
      if (q && !(wsText.includes(q) || [a.title, a.last, a.prompt].join(' ').toLowerCase().includes(q))) return false
      return true
    })
    const filtering = active.length > 0 || q.length > 0
    // A workspace without a matching agent stays only when nothing filters and idle shows.
    if (agents.length === 0 && (filtering || query.filters.hideIdle || w.agents.length > 0)) continue
    out.push({ ...w, agents, allAgents: w.agents })
  }
  return out
}

/** Chip counts: agents in scope (host, hide children) that pass each filter on its own. */
export function filterCounts(snap: BoardSnapshot, f: Family, query: BoardQuery): Record<'needsMe' | 'running' | 'unread', number> {
  const counts = { needsMe: 0, running: 0, unread: 0 }
  for (const w of snap.workspaces) {
    if (!inScope(query, w)) continue
    for (const a of w.agents) for (const x of AGENT_FILTERS) if (x.test(f, a, w)) counts[x.key]++
  }
  return counts
}

/** The List view as it opens: every host, no search, the default filters (Hide children on). */
export const DEFAULT_QUERY: BoardQuery = { view: 'list', host: '', q: '', filters: DEFAULT_FILTERS }

/**
 * The status bar count: the List's "Needs me" chip with the default filters, on every host. A
 * child that needs the person counts once, through its parent's most recent chat, as on the board.
 */
export function needsMeCount(snap: BoardSnapshot, f: Family = family(snap.workspaces)): number {
  return filterCounts(snap, f, DEFAULT_QUERY).needsMe
}

// ---------------------------------------------------------------------------------------------
// Views.

export type ListItemRef = { agent: BoardAgent; ws: VisibleWorkspace }

export function listItems(ws: readonly VisibleWorkspace[]): ListItemRef[] {
  return ws
    .flatMap((w) => w.agents.map((agent) => ({ agent, ws: w })))
    .sort((x, y) => y.agent.updatedAt - x.agent.updatedAt)
}

export type TreeNode = {
  ws: VisibleWorkspace
  depth: number
  /** Label of a parent drawn elsewhere (another project, or filtered out). */
  foreignParent: string | null
}

export const wsLabel = (snap: BoardSnapshot, w: BoardWorkspace): string =>
  w.floating ? 'Floating workspace' : `${snap.projects[w.project] || w.repo}/${w.name}`

/** Depth-first: roots newest first, each followed by its children (newest first). */
export function treeOf(snap: BoardSnapshot, f: Family, list: readonly VisibleWorkspace[]): TreeNode[] {
  const ids = new Set(list.map((w) => w.id))
  const byParent = new Map<string, VisibleWorkspace[]>()
  const roots: VisibleWorkspace[] = []
  for (const w of list) {
    if (w.parentId && ids.has(w.parentId)) {
      const l = byParent.get(w.parentId) ?? []
      l.push(w)
      byParent.set(w.parentId, l)
    } else roots.push(w)
  }
  const out: TreeNode[] = []
  const seen = new Set<string>()
  const walk = (w: VisibleWorkspace, depth: number): void => {
    if (seen.has(w.id)) return
    seen.add(w.id)
    const parent = w.parentId && !ids.has(w.parentId) ? f.byId.get(w.parentId) : undefined
    out.push({ ws: w, depth, foreignParent: depth === 0 && parent ? wsLabel(snap, parent) : null })
    for (const c of (byParent.get(w.id) ?? []).sort((a, b) => b.lastAt - a.lastAt)) walk(c, depth + 1)
  }
  for (const r of roots.sort((a, b) => b.lastAt - a.lastAt)) walk(r, 0)
  return out
}

export type ProjectGroup = {
  key: string
  name: string
  hosts: string[]
  lastAt: number
  /** Workspaces with an agent that needs the person. */
  attention: number
  nodes: TreeNode[]
}

export function projectGroups(snap: BoardSnapshot, f: Family, list: readonly VisibleWorkspace[]): ProjectGroup[] {
  const groups = new Map<string, VisibleWorkspace[]>()
  for (const w of list) {
    const l = groups.get(w.project) ?? []
    l.push(w)
    groups.set(w.project, l)
  }
  return [...groups.entries()]
    .map(([key, ws]) => ({
      key,
      name: snap.projects[key] || ws[0]?.repo || key,
      hosts: [...new Set(ws.map((w) => w.host))],
      lastAt: Math.max(...ws.map((w) => w.lastAt)),
      attention: ws.filter((w) => w.agents.some((a) => agentNeedsMe(f, a, w))).length,
      nodes: treeOf(snap, f, ws)
    }))
    .sort((a, b) => b.lastAt - a.lastAt)
}

// ---------------------------------------------------------------------------------------------
// Project names: a name the person set in Orca (one that differs from the folder name) wins on
// any host; else this computer's.

export type RepoRow = { host: string; id: string; path: string; displayName?: string | null; canonicalKey?: string | null }

export const folderOf = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path

export function projectKeyOf(r: RepoRow): string {
  return r.canonicalKey || `${r.host}:${r.path}`
}

export function projectNames(repos: readonly RepoRow[], localHost = LOCAL_HOST): Map<string, string> {
  const best = new Map<string, { name: string; custom: boolean; local: boolean }>()
  for (const r of repos) {
    const key = projectKeyOf(r)
    const name = r.displayName || folderOf(r.path)
    const custom = !!r.displayName && r.displayName !== folderOf(r.path)
    const local = r.host === localHost
    const prev = best.get(key)
    if (
      !prev ||
      (custom && !prev.custom) ||
      (custom === prev.custom && local && !prev.local)
    ) {
      best.set(key, { name, custom, local })
    }
  }
  return new Map([...best].map(([k, v]) => [k, v.name]))
}

// ---------------------------------------------------------------------------------------------
// A child's card says whose child it is.

export type ParentRef = {
  parent: BoardWorkspace
  /** `<project>/<workspace>` */
  label: string
  /** The parent's host, only when it differs from the child's. */
  otherHost: string | null
  /** Title (or prompt) of the parent's most recent chat. */
  chat: string | null
}

export function parentRef(snap: BoardSnapshot, f: Family, w: BoardWorkspace): ParentRef | null {
  const p = w.parentId ? f.byId.get(w.parentId) : undefined
  if (!p) return null
  const a = latestOf(p)
  return {
    parent: p,
    label: wsLabel(snap, p),
    otherHost: p.host !== w.host ? p.host : null,
    chat: (a && (a.title || a.prompt)) || null
  }
}

/** The line under a child card's chips: `⑂ child of web-shop/main on Local · Checkout redesign`. */
export function parentLineText(r: ParentRef): string {
  const who = r.otherHost ? `${r.label} on ${r.otherHost}` : r.label
  return `⑂ child of ${who}${r.chat ? ` · ${r.chat}` : ''}`
}

// ---------------------------------------------------------------------------------------------
// Card elements: which parts of a card show. The status icon, the bar and tint, and the title
// always show; everything else can be hidden, for every card in every view.

export type CardElement =
  | 'project'
  | 'host'
  | 'parent'
  | 'reply'
  | 'status'
  | 'children'
  | 'agent'
  | 'time'
  | 'subagents'
  | 'terminal'

/** Every element, in the order the card draws them and the Card elements section lists them. */
export const CARD_ELEMENTS: readonly { key: CardElement; label: string }[] = [
  { key: 'project', label: 'Project / workspace' },
  { key: 'host', label: 'Machine' },
  { key: 'parent', label: 'Parent' },
  { key: 'reply', label: 'Last reply' },
  { key: 'status', label: 'Status label' },
  { key: 'children', label: 'Children summary' },
  { key: 'agent', label: 'Agent kind' },
  { key: 'time', label: 'Time' },
  { key: 'subagents', label: 'Subagents' },
  { key: 'terminal', label: 'Terminal tag' }
]

/**
 * What the person hid (element -> true). Stored as hidden rather than shown, so an element added
 * later shows by default; unknown keys are ignored.
 */
export type HiddenElements = Partial<Record<CardElement, boolean>>

export const shows = (hidden: HiddenElements, key: CardElement): boolean => hidden[key] !== true

export const hiddenCount = (hidden: HiddenElements): number => CARD_ELEMENTS.filter((e) => !shows(hidden, e.key)).length

export const toggleElement = (hidden: HiddenElements, key: CardElement, show: boolean): HiddenElements => {
  const next = { ...hidden }
  if (show) delete next[key]
  else next[key] = true
  return next
}

/** "Card elements" or "Card elements (3 hidden)": the header button's tooltip. */
export const elementsTooltip = (hidden: HiddenElements): string => {
  const n = hiddenCount(hidden)
  return n ? `Card elements (${n} hidden)` : 'Card elements'
}
