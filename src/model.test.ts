// The board's rules, on invented fixtures: project grouping, display names, descendants and the
// children summary, per-agent filters, and the status priority.
import { assert, test } from 'orca/testing'
import { snapshotFixture } from './fixtures.ts'
import {
  cardEmphasis,
  cardStatus,
  childSummary,
  DEFAULT_FILTERS,
  family,
  filterCounts,
  listItems,
  needsMeCount,
  projectGroups,
  projectNames,
  treeOf,
  visibleWorkspaces,
  type BoardAgent,
  type BoardQuery,
  type BoardSnapshot,
  type BoardWorkspace
} from './model.ts'

const NOW = 1_800_000_000_000
const snap = (): BoardSnapshot => snapshotFixture(NOW)
const ws = (s: BoardSnapshot, name: string): BoardWorkspace => {
  const w = s.workspaces.find((x) => x.name === name)
  assert.ok(w, `workspace ${name}`)
  return w
}
const q = (over: Partial<BoardQuery> = {}, filters: Partial<BoardQuery['filters']> = {}): BoardQuery => ({
  view: 'list',
  host: '',
  q: '',
  ...over,
  filters: { ...DEFAULT_FILTERS, ...filters }
})
const titles = (items: { agent: BoardAgent }[]) => items.map((i) => i.agent.title)

test('one project per Git remote across hosts; repositories without one stay per host', () => {
  const s = snap()
  assert.equal(ws(s, 'payment-step').project, ws(s, 'cart-totals').project)
  assert.equal(ws(s, 'payment-step').project, 'github.com/acme/web-shop')
  assert.equal(ws(s, 'flaky-tests').project, 'github.com/acme/payments-api')
  assert.equal(ws(s, 'key-rotation').project, 'github.com/acme/payments-api')
  const notes = s.workspaces.find((w) => w.repo === 'notes')
  assert.equal(notes?.project, 'Local:/home/dev/notes')
  const groups = projectGroups(s, family(s.workspaces), visibleWorkspaces(s, family(s.workspaces), q({ view: 'projects' }, { hideIdle: false })))
  assert.deepEqual(groups.find((g) => g.key === 'github.com/acme/web-shop')?.hosts.sort(), ['Build server', 'Local'])
})

test('a display name set in Orca wins on any host; else this computer’s name', () => {
  const s = snap()
  // Renamed to "Storefront" on the build server, folder name "web-shop" here.
  assert.equal(s.projects['github.com/acme/web-shop'], 'Storefront')
  // Renamed to "Payments API" here; the build server keeps the folder name.
  assert.equal(s.projects['github.com/acme/payments-api'], 'Payments API')
  const names = projectNames([
    { host: 'Build server', id: 'a', path: '/srv/x/tool', displayName: 'tool', canonicalKey: 'k' },
    { host: 'Local', id: 'b', path: '/home/dev/tool-clone', displayName: 'tool-clone', canonicalKey: 'k' }
  ])
  assert.equal(names.get('k'), 'tool-clone', 'no custom name anywhere: the local name')
})

test('children are all descendants across hosts; the summary counts their states', () => {
  const s = snap()
  const f = family(s.workspaces)
  const main = ws(s, 'main')
  assert.equal(ws(s, 'payment-step').parentId, main.id, 'parent on another host')
  assert.deepEqual(childSummary(f, main), { count: 3, working: 1, waiting: 1, failed: 0, unread: 1 })
  assert.deepEqual(childSummary(f, ws(s, 'key-rotation')).count, 0)
  // A grandchild counts too.
  const extra: BoardWorkspace = { ...ws(s, 'cart-totals'), id: 'Local|grandchild', name: 'grandchild', parentId: ws(s, 'cart-totals').id, agents: [] }
  const f2 = family([...s.workspaces, extra])
  assert.equal(childSummary(f2, main).count, 4)
})

test('one status per card, most urgent first', () => {
  const s = snap()
  const base = ws(s, 'key-rotation')
  const agent = base.agents[0]
  assert.ok(agent)
  const at = (o: Partial<BoardAgent>, wo: Partial<BoardWorkspace> = {}) => {
    const a = { ...agent, ...o }
    return cardStatus(a, { ...base, ...wo, agents: [a] }).status
  }
  assert.equal(at({ state: 'waiting', unread: true }), 'waiting')
  assert.equal(at({ state: 'blocked' }), 'waiting')
  assert.equal(cardStatus({ ...agent, state: 'blocked' }, base).label, 'blocked: needs you')
  assert.equal(at({ state: 'done', outcome: 'failure', unread: true }), 'failed')
  assert.equal(at({ state: 'done', interrupted: true }), 'failed')
  assert.equal(at({ state: 'working', unread: true }), 'working')
  assert.equal(at({ state: 'done', unread: true }), 'unread')
  assert.equal(at({ state: 'done' }, { unread: true }), 'unread', 'workspace unread lands on its latest agent')
  assert.equal(at({ state: 'done', outcome: 'success' }), 'done')
})

test('filters match single agents, not workspaces', () => {
  const s = snap()
  const f = family(s.workspaces)
  // Needs me: the waiting agent, and the parent's latest chat (its child is blocked); never the
  // parent's older chat in the same workspace.
  const needs = titles(listItems(visibleWorkspaces(s, f, q({}, { needsMe: true }))))
  assert.deepEqual(needs.sort(), ['Checkout redesign', 'Rotate the signing keys'])
  // Without Hide children the blocked and unread children themselves show.
  const needsAll = titles(listItems(visibleWorkspaces(s, f, q({}, { needsMe: true, hideChildren: false }))))
  assert.deepEqual(needsAll.sort(), ['Checkout redesign', 'Payment step form', 'Receipt email template', 'Rotate the signing keys'])
  const running = titles(listItems(visibleWorkspaces(s, f, q({}, { running: true, hideChildren: false }))))
  assert.deepEqual(running.sort(), ['Cart totals with discounts', 'Checkout redesign'])
  const unread = titles(listItems(visibleWorkspaces(s, f, q({}, { unread: true, hideChildren: false }))))
  assert.deepEqual(unread, ['Receipt email template'])
  // Chip counts count agents in scope.
  assert.deepEqual(filterCounts(s, f, q()), { needsMe: 2, running: 1, unread: 0 })
  assert.equal(needsMeCount(s), 2, 'the status bar counts like the chip')
})

test('Hide idle drops workspaces without agents; search covers titles, projects and messages', () => {
  const s = snap()
  const f = family(s.workspaces)
  assert.ok(!visibleWorkspaces(s, f, q({ view: 'tree' })).some((w) => w.repo === 'notes'))
  assert.ok(visibleWorkspaces(s, f, q({ view: 'tree' }, { hideIdle: false })).some((w) => w.repo === 'notes'))
  assert.deepEqual(titles(listItems(visibleWorkspaces(s, f, q({ q: 'revoke' })))), ['Rotate the signing keys'])
  assert.deepEqual(titles(listItems(visibleWorkspaces(s, f, q({ q: 'storefront', view: 'tree' })))).length, 5)
  assert.deepEqual(titles(listItems(visibleWorkspaces(s, f, q({ host: 'Build server', view: 'tree' })))).sort(), ['Fix the flaky webhook test', 'Payment step form', 'Receipt email template'])
})

test('Tree nests children under parents across hosts; Projects says when a parent is elsewhere', () => {
  const s = snap()
  const f = family(s.workspaces)
  const nodes = treeOf(s, f, visibleWorkspaces(s, f, q({ view: 'tree' })))
  const main = nodes.findIndex((n) => n.ws.name === 'main')
  assert.ok(main >= 0)
  assert.deepEqual(
    nodes.filter((n) => n.depth === 1).map((n) => n.ws.name).sort(),
    ['cart-totals', 'payment-step', 'receipt-email']
  )
  // A child whose parent sits in another project shows "child of".
  const moved = s.workspaces.map((w) => (w.name === 'flaky-tests' ? { ...w, parentId: ws(s, 'main').id } : w))
  const s2 = { ...s, workspaces: moved }
  const f2 = family(moved)
  const groups = projectGroups(s2, f2, visibleWorkspaces(s2, f2, q({ view: 'projects' })))
  const pay = groups.find((g) => g.key === 'github.com/acme/payments-api')
  assert.equal(pay?.nodes.find((n) => n.ws.name === 'flaky-tests')?.foreignParent, 'Storefront/main')
})

test('emphasis: a parent’s latest chat whose child needs you looks like "needs you"', () => {
  const s = snap()
  const f = family(s.workspaces)
  const main = ws(s, 'main')
  const [latest, older] = main.agents
  assert.ok(latest && older)
  assert.equal(cardStatus(latest, main).status, 'done', 'its own status stays on the badge')
  assert.equal(cardEmphasis(f, latest, main), 'waiting')
  assert.equal(cardEmphasis(f, older, main), cardStatus(older, main).status, 'never an older chat')
  const keys = ws(s, 'key-rotation')
  assert.equal(cardEmphasis(f, keys.agents[0]!, keys), 'waiting')
})

test('status bar count: children that need you count once, through their parent, like the chip', () => {
  const s = snap()
  const f = family(s.workspaces)
  const chip = filterCounts(s, f, q()).needsMe
  assert.equal(needsMeCount(s), chip)
  // Counting every agent on every host (the old rule) gave more: the children and their parent.
  let everyAgent = 0
  for (const w of s.workspaces) for (const a of w.agents) if (a.state === 'waiting' || a.state === 'blocked' || a.unread || (w.unread && w.agents[0] === a)) everyAgent++
  assert.ok(everyAgent > chip)
})
