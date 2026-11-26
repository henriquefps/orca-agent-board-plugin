// Agent Board panel: drawn with Orca's components, so it follows Orca's theme. The worker
// (src/worker.ts) builds the board; this file filters and lays it out.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Collapsible,
  EmptyState,
  Heading,
  IconButton,
  Input,
  Link,
  List,
  ListItem,
  plugin,
  read,
  RelativeTime,
  Row,
  Select,
  settings,
  set,
  Skeleton,
  Spinner,
  Stack,
  Tab,
  Tabs,
  Text,
  update,
  type IconName,
  type OrcaNode,
  type PanelContext,
  type Tone
} from 'orca'
import {
  AGENT_FILTERS,
  cardStatus,
  cardEmphasis,
  childSummary,
  cycleHostColor,
  DEFAULT_FILTERS,
  family,
  filterCounts,
  hostWithDot,
  isLatest,
  listItems,
  parentLineText,
  parentRef,
  projectGroups,
  treeOf,
  visibleWorkspaces,
  wsLabel,
  type BoardAgent,
  type BoardQuery,
  type BoardSnapshot,
  type CardStatus,
  type Family,
  type FilterKey,
  type Filters,
  type HostColors,
  type TreeNode,
  type ViewName,
  type VisibleWorkspace
} from './model.ts'
import './protocol.ts'

// -- State ----------------------------------------------------------------------------------------

const snapshot = atom<BoardSnapshot | null>(null)
const loadError = atom<string | null>(null)
const loading = atom(false)
/** "Opening …" while an open runs. */
const opening = atom<string | null>(null)
/**
 * Why the last open failed, until dismissed or the next open succeeds (kept by Orca, so a check
 * scenario can show it).
 */
export type OpenNotice = { tone: 'warning' | 'danger'; text: string }
const openNotice = atom<OpenNotice | null>('openNotice', null, { persist: 'plugin' })
const query = atom('')
/** How many agent cards to draw before "Show more" (Orca refuses renders past 5000 nodes). */
export const PAGE = 60
const limit = atom(PAGE)
const defaultView = atom<ViewName>('list')

/** Null until the person picks a view: then the default view setting decides. */
const view = atom<ViewName | null>('view', null, { persist: 'plugin' })
const filters = atom<Filters>('filters', DEFAULT_FILTERS, { persist: 'plugin' })
const hostFilter = atom('host', '', { persist: 'plugin' })
const closedGroups = atom<Record<string, boolean>>('closedGroups', {}, { persist: 'plugin' })
/** Colours the person picked per host name (index in HOST_DOTS); the rest follow the host order. */
const hostColors = atom<HostColors>('hostColors', {}, { persist: 'plugin' })

/** What the panel says when the floating workspace is closed (plugins cannot open it). */
export const FLOATING_CLOSED =
  'The floating workspace is closed. Press ⌘⌥A (Ctrl+Alt+A on Windows/Linux) to open it, then click the chat again.'

const VIEWS: readonly { value: ViewName; label: string }[] = [
  { value: 'list', label: 'List' },
  { value: 'projects', label: 'Projects' },
  { value: 'tree', label: 'Tree' }
]
const isView = (v: unknown): v is ViewName => v === 'list' || v === 'projects' || v === 'tree'
const ALL_HOSTS = '*'

// -- Status look: one per card, most urgent first -------------------------------------------------
// The prototype's four signals per card, with Orca's components and theme tones: a left bar, the
// card surface, a toned icon before the title, and the title weight; plus the status badge.

export type StatusLook = {
  /** Tone of the narrow bar left of the card; null draws none. */
  bar: Tone | null
  /** Card surface: tinted background and/or a toned outline. */
  background: Tone | 'none'
  border: Tone | false
  /** Icon before the title; 'spinner' draws the animated Spinner. */
  icon: IconName | 'spinner'
  iconTone: Tone
  /** Title weight: semibold for anything that wants a look, regular for done. */
  strong: boolean
  /** Badge tone; null draws the label as quiet muted text. */
  badge: Tone | null
}

export const STATUS_LOOK: Record<CardStatus, StatusLook> = {
  waiting: { bar: 'warning', background: 'warning', border: 'warning', icon: 'warning', iconTone: 'warning', strong: true, badge: 'warning' },
  failed: { bar: 'danger', background: 'none', border: 'danger', icon: 'error', iconTone: 'danger', strong: true, badge: 'danger' },
  working: { bar: 'accent', background: 'none', border: false, icon: 'spinner', iconTone: 'accent', strong: true, badge: 'accent' },
  unread: { bar: 'warning', background: 'none', border: false, icon: 'bell', iconTone: 'warning', strong: true, badge: 'warning' },
  done: { bar: null, background: 'none', border: false, icon: 'check', iconTone: 'neutral', strong: false, badge: null }
}

/** Narrowest bar the API draws: a 3 px Box, toned outline over a tone tint, full card height. */
export const BAR_WIDTH = 3

const FILTER_ICON: Record<FilterKey, IconName> = {
  needsMe: 'warning',
  running: 'activity',
  unread: 'bell',
  hideChildren: 'branch',
  hideIdle: 'pause'
}

// -- Data -----------------------------------------------------------------------------------------

async function load(force = false): Promise<void> {
  set(loading, true)
  try {
    const snap = await plugin.request('board.snapshot', { force }, { timeoutMs: 60_000 })
    set(snapshot, snap)
    set(loadError, null)
    const h = read(hostFilter)
    if (h && !snap.hosts.includes(h)) set(hostFilter, '')
  } catch (e) {
    set(loadError, (e as Error).message || 'Could not read Orca')
  } finally {
    set(loading, false)
  }
}

async function open(workspaceId: string, agentId?: string, label?: string): Promise<void> {
  set(opening, `Opening ${label ?? 'workspace'}…`)
  set(openNotice, null)
  try {
    const r = await plugin.request('board.open', agentId ? { workspaceId, agentId } : { workspaceId })
    if (r.ok) return
    if (r.code === 'floating-closed') set(openNotice, { tone: 'warning', text: FLOATING_CLOSED })
    else set(openNotice, { tone: 'danger', text: `Could not open ${label ?? 'it'}: ${r.error ?? 'unknown error'}` })
  } catch (e) {
    set(openNotice, { tone: 'danger', text: `Could not open ${label ?? 'it'}: ${(e as Error).message}` })
  } finally {
    set(opening, null)
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('board.changed', () => void load()))
  ctx.subscriptions.push(
    settings.onDidChange(({ key }) => {
      if (key !== 'defaultView') return
      void settings.get('defaultView').then((v) => {
        if (!isView(v)) return
        set(defaultView, v)
        set(view, v)
      })
    })
  )
  void settings
    .get()
    .then((s) => {
      if (isView(s.defaultView)) set(defaultView, s.defaultView)
      const seconds = typeof s.pollSeconds === 'number' ? Math.min(600, Math.max(5, s.pollSeconds)) : 15
      // Poll only while the panel shows; events from the worker refresh it in between.
      const timer = setInterval(() => {
        if (read(ctx.visible) && !read(loading)) void load()
      }, seconds * 1000)
      ctx.signal.addEventListener('abort', () => clearInterval(timer))
    })
    .catch(() => undefined)
  void load()
}

// -- Pieces ---------------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function ChildBadges({ fam, w }: { fam: Family; w: VisibleWorkspace }): OrcaNode {
  const s = childSummary(fam, w)
  if (!s.count) return null
  return [
    <Text key="n" size="xs" muted>{plural(s.count, 'child', 'children')}</Text>,
    s.waiting ? <Badge key="w" tone="warning">{s.waiting === 1 ? '1 child needs you' : `${s.waiting} children need you`}</Badge> : null,
    s.failed ? <Badge key="f" tone="danger">{`${s.failed} failed`}</Badge> : null,
    s.working ? (
      <Row key="r" gap="xs" align="center">
        <Spinner label="Children running" labelHidden />
        <Badge tone="accent">{`${s.working} running`}</Badge>
      </Row>
    ) : null,
    s.unread ? <Badge key="u" tone="warning">{`${s.unread} unread`}</Badge> : null
  ]
}

function StatusIcon({ look, label, onPress }: { look: StatusLook; label: string; onPress: () => void }): OrcaNode {
  if (look.icon === 'spinner') return <Spinner label={label} labelHidden />
  return <IconButton icon={look.icon} label={label} tooltip={label} variant="ghost" tone={look.iconTone} size="xs" onPress={onPress} />
}

/** Text only: the card's one status icon sits beside the title. */
function StatusBadge({ look, label }: { look: StatusLook; label: string }): OrcaNode {
  if (!look.badge) return <Text size="xs" muted>{label}</Text>
  return <Badge tone={look.badge}>{label}</Badge>
}

/**
 * A host's chip: its colour dot and name. A Badge cannot be pressed, so it is the smallest outline
 * Button; pressing it gives that machine the next colour, everywhere it shows.
 */
function HostChip({ snap, host }: { snap: BoardSnapshot; host: string }): OrcaNode {
  const colors = read(hostColors)
  return (
    <Button
      size="xs"
      variant="outline"
      tone="neutral"
      tooltip="Change this machine's colour"
      onPress={() => update(hostColors, (c) => cycleHostColor(host, snap.hosts, c))}
    >
      {hostWithDot(host, snap.hosts, colors)}
    </Button>
  )
}

/** Under a child card's chips: whose child it is. Pressing it opens the parent. */
function ParentLine({ snap, fam, w }: { snap: BoardSnapshot; fam: Family; w: VisibleWorkspace }): OrcaNode {
  const r = parentRef(snap, fam, w)
  if (!r) return null
  const parent = r.parent
  return (
    <Box paddingX="sm">
      <Text size="xs" muted truncate>
        <Link onPress={() => open(parent.id, parent.agents[0]?.id, r.label)}>{parentLineText(r, snap.hosts, read(hostColors))}</Link>
      </Text>
    </Box>
  )
}

function AgentCard({ snap, fam, a, w }: { snap: BoardSnapshot; fam: Family; a: BoardAgent; w: VisibleWorkspace }): OrcaNode {
  const own = cardStatus(a, w)
  const look = STATUS_LOOK[cardEmphasis(fam, a, w)]
  // The badge keeps the card's own status; a waiting child shows in the children summary.
  const badgeLook = STATUS_LOOK[own.status]
  const title = a.title || a.prompt || '(untitled)'
  const where = wsLabel(snap, w)
  const press = () => open(w.id, a.id, where)
  const message = a.last ? { who: 'Agent:', text: a.last } : a.prompt ? { who: 'You:', text: a.prompt } : null
  return (
    <Box key={a.id} direction="row" align="stretch" gap="xs" border={look.border} background={look.background} radius="md">
      {look.bar ? <Box width={BAR_WIDTH} shrink={false} border={look.bar} background={look.bar} radius="full" /> : null}
      <Box grow gap="none">
        {/* Project first, always (the user's wireframe), then the icon beside the title. */}
        <Box direction="row" gap="xs" wrap align="center" paddingX="sm" paddingY="xs">
          <Badge>{where}</Badge>
          <HostChip snap={snap} host={w.host} />
        </Box>
        <ParentLine snap={snap} fam={fam} w={w} />
        <Box direction="row" align="start">
          {/* Outside the ListItem: a pressable ListItem cannot hold an IconButton. */}
          <Box shrink={false} paddingX="xs" paddingY="xs">
            <StatusIcon look={look} label={own.label} onPress={press} />
          </Box>
          <Box grow>
            <List label={title}>
              <ListItem onPress={press}>
                <Stack gap="xs">
                  <Text weight={look.strong ? 'semibold' : 'regular'} truncate>
                    {title}
                  </Text>
                  {message ? (
                    <Text size="sm" muted>
                      <Text size="sm" weight={look.strong ? 'medium' : 'regular'} muted={!look.strong}>{message.who}</Text> {message.text.length > 180 ? `${message.text.slice(0, 179)}…` : message.text}
                    </Text>
                  ) : null}
                  <Row gap="xs" wrap align="center">
                    <StatusBadge look={badgeLook} label={own.label} />
                    {isLatest(a, w) ? <ChildBadges fam={fam} w={w} /> : null}
                    <Text size="xs" muted>
                      {a.agent ?? 'agent'} · <RelativeTime at={a.updatedAt} format="short" muted />
                      {a.subagents ? ` · ${plural(a.subagents, 'subagent', 'subagents')}` : ''}
                      {a.kind === 'terminal' ? ' · terminal' : ''}
                    </Text>
                  </Row>
                </Stack>
              </ListItem>
            </List>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

function WorkspaceBlock({ snap, fam, node, showProject, budget }: { snap: BoardSnapshot; fam: Family; node: TreeNode; showProject: boolean; budget: { left: number } }): OrcaNode {
  const w = node.ws
  const name = w.floating ? 'Floating workspace' : showProject ? wsLabel(snap, w) : w.name
  const agents = w.agents.slice(0, Math.max(0, budget.left))
  budget.left -= agents.length
  return (
    <Box key={w.id} direction="row">
      {node.depth ? <Box width={Math.min(node.depth, 6) * 14} shrink={false} /> : null}
      <Box grow gap="xs">
        {/* The host chip sits outside the ListItem: a pressable ListItem cannot hold a Button. */}
        <Box direction="row" align="center" gap="xs">
          <Box grow>
            <List label={name}>
              <ListItem icon={w.floating ? 'layers' : w.isMain ? 'folder' : 'branch'} onPress={() => open(w.id, undefined, name)}>
                <Row gap="xs" align="center" wrap>
                  <Text weight="medium" truncate>{name}</Text>
                  {w.unread ? <Badge tone="warning">unread</Badge> : null}
                  {w.kanban && w.kanban !== 'in-progress' ? <Badge>{w.kanban}</Badge> : null}
                  {w.pinned ? <Badge>pinned</Badge> : null}
                  <Text size="xs" muted><RelativeTime at={w.lastAt} format="short" muted /></Text>
                </Row>
              </ListItem>
            </List>
          </Box>
          <Box shrink={false}>
            <HostChip snap={snap} host={w.host} />
          </Box>
        </Box>
        {node.foreignParent ? <Text size="xs" muted>{`↳ child of ${node.foreignParent}`}</Text> : null}
        {w.prs.length ? (
          <Row gap="sm" wrap>
            {w.prs.map((p) => <Link key={p.url} href={p.url}>{`#${p.number}`}</Link>)}
          </Row>
        ) : null}
        {agents.length ? agents.map((a) => <AgentCard snap={snap} fam={fam} a={a} w={w} />) : w.allAgents.length ? null : <Text size="xs" muted>no open agent</Text>}
      </Box>
    </Box>
  )
}

function FilterChips({ snap, fam, q }: { snap: BoardSnapshot | null; fam: Family | null; q: BoardQuery }): OrcaNode {
  const counts = snap && fam ? filterCounts(snap, fam, q) : null
  const toggle = (key: FilterKey) => () => update(filters, (f) => ({ ...f, [key]: !f[key] }))
  const chips: { key: FilterKey; label: string }[] = [
    ...AGENT_FILTERS.map((x) => ({ key: x.key, label: counts ? `${x.label} ${counts[x.key]}` : x.label })),
    ...(q.view === 'list' ? [{ key: 'hideChildren' as const, label: 'Hide children' }] : []),
    { key: 'hideIdle', label: 'Hide idle' }
  ]
  return (
    <Row gap="xs" wrap>
      {chips.map((c) => (
        <Button
          key={c.key}
          size="xs"
          variant={q.filters[c.key] ? 'solid' : 'outline'}
          tone={q.filters[c.key] ? 'accent' : 'neutral'}
          icon={FILTER_ICON[c.key]}
          onPress={toggle(c.key)}
        >
          {c.label}
        </Button>
      ))}
    </Row>
  )
}

function Board({ snap, q }: { snap: BoardSnapshot; q: BoardQuery }): OrcaNode {
  const fam = family(snap.workspaces)
  const ws = visibleWorkspaces(snap, fam, q)
  const agentCount = ws.reduce((n, w) => n + w.agents.length, 0)
  const budget = { left: read(limit) }
  let body: OrcaNode
  if (q.view === 'list') {
    const items = listItems(ws)
    body = (
      <Stack gap="xs">
        {items.slice(0, budget.left).map(({ agent, ws: w }) => <AgentCard snap={snap} fam={fam} a={agent} w={w} />)}
      </Stack>
    )
    budget.left -= items.length
  } else if (q.view === 'tree') {
    body = (
      <Stack gap="sm">
        {treeOf(snap, fam, ws).map((node) => (budget.left > 0 ? <WorkspaceBlock snap={snap} fam={fam} node={node} showProject budget={budget} /> : null))}
      </Stack>
    )
  } else {
    const closed = read(closedGroups)
    const colors = read(hostColors)
    body = (
      <Stack gap="xs">
        {projectGroups(snap, fam, ws).map((g) => (
          <Collapsible
            key={g.key}
            title={g.name}
            description={[g.hosts.map((h) => hostWithDot(h, snap.hosts, colors)).join(', '), plural(g.nodes.length, 'workspace', 'workspaces'), g.attention ? `${g.attention} need${g.attention === 1 ? 's' : ''} you` : ''].filter(Boolean).join(' · ')}
            open={!closed[g.key]}
            onChange={(isOpen) => update(closedGroups, (c) => ({ ...c, [g.key]: !isOpen }))}
          >
            <Stack gap="sm">
              {g.nodes.map((node) => (budget.left > 0 ? <WorkspaceBlock snap={snap} fam={fam} node={node} showProject={false} budget={budget} /> : null))}
            </Stack>
          </Collapsible>
        ))}
      </Stack>
    )
  }
  return (
    <Stack gap="sm">
      <Row justify="between">
        <Text size="xs" muted>{`${plural(agentCount, 'agent', 'agents')} · ${plural(ws.length, 'workspace', 'workspaces')}`}</Text>
        <Text size="xs" muted>last activity</Text>
      </Row>
      {ws.length ? body : <EmptyState icon="filter" title="Nothing matches these filters." />}
      {budget.left < 0 ? (
        <Button variant="ghost" size="sm" onPress={() => update(limit, (n) => n + PAGE)}>
          Show more
        </Button>
      ) : null}
    </Stack>
  )
}

export default function Panel(): OrcaNode {
  const snap = read(snapshot)
  const q: BoardQuery = {
    view: read(view) ?? read(defaultView),
    host: read(hostFilter),
    q: read(query),
    filters: { ...DEFAULT_FILTERS, ...read(filters) }
  }
  const fam = snap ? family(snap.workspaces) : null
  const err = read(loadError)
  const busy = read(opening)
  const notice = read(openNotice)
  const colors = read(hostColors)
  const hostOptions = [{ value: ALL_HOSTS, label: 'All hosts' }, ...(snap?.hosts ?? []).map((h) => ({ value: h, label: hostWithDot(h, snap?.hosts ?? [], colors) }))]
  const content = (
    <Stack gap="sm">
      <Input
        label="Search"
        labelHidden
        type="search"
        placeholder="Search agents, projects or messages"
        value={q.q}
        onChange={(v) => {
          set(query, v)
          set(limit, PAGE)
        }}
      />
      <FilterChips snap={snap} fam={fam} q={q} />
      {snap ? <Board snap={snap} q={q} /> : err ? null : <Skeleton lines={6} label="Loading agents" />}
    </Stack>
  )
  return (
    <Stack gap="sm">
      <Row justify="between" align="center">
        <Row gap="xs" align="center">
          <Heading level={3}>Agent Board</Heading>
          {read(loading) ? <Spinner label="Updating" labelHidden /> : snap ? <Text size="xs" muted>updated <RelativeTime at={snap.at} format="short" muted /></Text> : null}
        </Row>
        <Row gap="xs" align="center">
          <Select
            label="Host"
            labelHidden
            value={q.host || ALL_HOSTS}
            options={hostOptions}
            onChange={(v) => set(hostFilter, v === ALL_HOSTS ? '' : v)}
          />
          <IconButton icon="refresh" label="Refresh" onPress={() => load(true)} />
        </Row>
      </Row>
      {err ? <Callout tone="danger" title="Could not read Orca">{err}</Callout> : null}
      {snap?.notices.map((n) => <Callout key={n} tone="warning" icon="info">{n}</Callout>)}
      {snap?.errors.length ? <Callout tone="danger" title="Some hosts could not be read">{snap.errors.join('\n')}</Callout> : null}
      {busy ? <Text size="xs" muted>{busy}</Text> : null}
      {notice ? (
        <Callout tone={notice.tone} icon={notice.tone === 'danger' ? 'error' : 'info'}>
          <Row justify="between" align="start" gap="xs">
            <Text size="sm">{notice.text}</Text>
            <IconButton icon="close" label="Dismiss" tooltip="Dismiss" variant="ghost" size="xs" onPress={() => set(openNotice, null)} />
          </Row>
        </Callout>
      ) : null}
      <Tabs
        label="View"
        value={q.view}
        onChange={(v) => {
          if (!isView(v)) return
          set(view, v)
          set(limit, PAGE)
        }}
      >
        {VIEWS.map((v) => (
          <Tab key={v.value} value={v.value} label={v.label}>
            {v.value === q.view ? content : null}
          </Tab>
        ))}
      </Tabs>
    </Stack>
  )
}
