// The panel with Orca's real runtime and checks, against invented fixtures.
import { afterEach, assert, mockHost, mount, test, type TestPanel, type TreeSnapshot } from 'orca/testing'
import { hostOnlySnapshotFixture, snapshotFixture } from './fixtures.ts'
import { CARD_ELEMENTS, DEFAULT_FILTERS, needsMeCount, NOTICE_NO_CLI, type CardElement } from './model.ts'
import * as panelModule from './panel.tsx'
import { FLOATING_CLOSED } from './panel.tsx'

let panel: TestPanel | undefined
afterEach(async () => {
  await panel?.unmount()
  panel = undefined
})

const allOff = { needsMe: false, running: false, unread: false, hideChildren: true, hideIdle: true }

async function open(view: string, filters: Record<string, boolean> = allOff, snapshot = snapshotFixture(), more: Record<string, unknown> = {}) {
  const opened: unknown[] = []
  const host = mockHost({
    requests: {
      'board.snapshot': () => snapshot,
      'board.open': (input) => {
        opened.push(input)
        return { ok: true, how: 'workspace.open' }
      }
    }
  })
  panel = await mount(panelModule, { host, persisted: { plugin: { view, filters, ...more } } })
  return { panel, opened }
}

/** Each card's chip line is its own pressable List, labelled `<title>: where`. */
const isChipList = (label: string) => label.endsWith(': where')
const cardTitles = (p: TestPanel): string[] =>
  p
    .findAll({ type: 'List' })
    .map((l) => String((l.props as { label?: string }).label))
    .filter((l) => !isChipList(l))

test('List: agents newest first, children hidden, one status per card', async () => {
  const { panel: p, opened } = await open('list')
  assert.deepEqual(cardTitles(p), [
    'Rotate the signing keys',
    'Checkout redesign',
    'Fix the flaky webhook test',
    'Quick question about regex',
    'Bump dependencies'
  ])
  assert.ok(p.find({ text: 'needs you' }), 'waiting badge')
  assert.ok(p.find({ text: 'failed' }), 'failed badge')
  assert.ok(p.find({ text: '1 child needs you' }), 'children summary on the latest chat')
  assert.ok(p.find({ text: '3 children' }))
  assert.ok(p.find({ text: '1 running' }))
  assert.equal(p.findAll({ text: '3 children' }).length, 1, 'only the workspace’s most recent chat')
  assert.ok(p.find({ text: /^Needs me 2$/ }), 'chip counts count agents')
  // Pressing a card opens that agent.
  await p.press({ type: 'ListItem', text: /Rotate the signing keys/ })
  assert.equal((opened[0] as { workspaceId: string }).workspaceId, 'Local|repo-pay::/home/dev/workspaces/payments-api/key-rotation')
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.warnings, [])
  assert.deepEqual(p.refusals, [])
})

test('filters: Needs me keeps the waiting agent and the parent whose child is blocked', async () => {
  const { panel: p } = await open('list')
  await p.press({ text: /^Needs me/ })
  assert.deepEqual(cardTitles(p), ['Rotate the signing keys', 'Checkout redesign'])
  assert.deepEqual((p.persisted.plugin.filters as Record<string, boolean>).needsMe, true)
  await p.press({ text: 'Hide children' })
  assert.deepEqual(cardTitles(p), ['Rotate the signing keys', 'Payment step form', 'Checkout redesign', 'Receipt email template'])
  await p.press({ text: /^Needs me/ })
  await p.press({ text: /^Running/ })
  assert.deepEqual(cardTitles(p), ['Cart totals with discounts', 'Checkout redesign'])
  await p.press({ text: /^Running/ })
  await p.press({ text: /^Unread/ })
  assert.deepEqual(cardTitles(p), ['Receipt email template'])
})

test('search and host filter', async () => {
  const { panel: p } = await open('list')
  await p.type({ label: 'Search' }, 'revoke')
  assert.deepEqual(cardTitles(p), ['Rotate the signing keys'])
  await p.type({ label: 'Search' }, '', { replace: true })
  await p.select({ label: 'Host' }, 'Build server')
  assert.deepEqual(cardTitles(p), ['Fix the flaky webhook test'])
  assert.equal(p.persisted.plugin.host, 'Build server')
})

test('Projects: one group per Git remote, children nested, groups collapse', async () => {
  const { panel: p } = await open('projects')
  const groups = p.findAll({ type: 'Collapsible' }).map((c) => (c.props as { title: string }).title)
  assert.deepEqual(groups, ['Storefront', 'Payments API', 'Floating workspace'])
  assert.ok(p.find({ type: 'List', label: 'payment-step' }), 'a child on another host sits in its project')
  await p.toggle({ type: 'Collapsible', label: 'Storefront' })
  assert.deepEqual(p.persisted.plugin.closedGroups, { 'github.com/acme/web-shop': true })
  assert.equal(p.find({ type: 'List', label: 'payment-step' }), null)
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.warnings, [])
})

test('Tree: the whole chain across hosts and projects', async () => {
  const { panel: p } = await open('tree')
  const ws = p.findAll({ type: 'List' }).map((l) => String((l.props as { label?: string }).label))
  const at = (label: string) => ws.indexOf(label)
  assert.ok(at('Storefront/main') >= 0)
  assert.ok(at('Storefront/main') < at('Storefront/cart-totals'))
  assert.ok(at('Storefront/main') < at('Storefront/payment-step'))
  assert.ok(p.find({ type: 'Link', text: '#42' }), 'linked PR')
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.warnings, [])
})

test('switching views persists the choice', async () => {
  const { panel: p } = await open('list')
  await p.select({ label: 'View' }, 'tree')
  assert.equal(p.persisted.plugin.view, 'tree')
  assert.equal(p.find({ text: 'Hide children' }), null, 'Hide children is a List filter')
})

test('without the CLI the panel says which features are off', async () => {
  const { panel: p } = await open('list', allOff, hostOnlySnapshotFixture())
  assert.ok(p.find({ type: 'Callout', text: NOTICE_NO_CLI }))
  assert.ok(cardTitles(p).includes('Rotate the signing keys'))
})

// -- Status emphasis ------------------------------------------------------------------------------

type Node = TreeSnapshot
const kids = (n: Node): Node[] => (n.children ?? []).filter((c): c is Node => typeof c !== 'string')
const walk = (n: Node, out: Node[] = []): Node[] => {
  out.push(n)
  for (const c of kids(n)) walk(c, out)
  return out
}
const textOf = (n: Node | string): string => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(''))

/** What a card draws: its bar, surface, status icon, title weight and status badge. */
function cardLook(p: TestPanel, title: string) {
  const root = p.tree()
  assert.ok(root && typeof root !== 'string')
  const card = walk(root).find(
    (n) => n.type === 'Box' && n.props?.direction === 'row' && n.props?.radius === 'md' && kids(n).some((c) => walk(c).some((d) => d.type === 'List' && d.props?.label === title))
  )
  assert.ok(card, `card ${title}`)
  const bar = kids(card).find((c) => c.props?.width === 3) ?? null
  const nodes = walk(card)
  const icon = nodes.find((n) => n.type === 'Spinner' || n.type === 'IconButton')
  // Card order (the user's wireframe): line 1 the project and host chips; line 2 the status icon
  // beside the title (the icon outside the pressable ListItem); then the reply and the meta row.
  const content = kids(card).find((c) => c !== bar)
  assert.ok(content)
  // Line 1: the project and host chips, plain Badges inside their own pressable item (the card's
  // press); a child's parent line may follow; the title row is last.
  const rows = kids(content)
  const chipRow = rows[0]
  const titleRow = rows.at(-1)
  assert.equal(chipRow?.type, 'List', `${title}: chips first`)
  assert.equal(chipRow?.props?.label, `${title}: where`)
  const chipItem = kids(chipRow!)[0]
  assert.equal(chipItem?.type, 'ListItem')
  assert.deepEqual(kids(kids(chipItem!)[0]!).map((c) => c.type), ['Badge', 'Badge'], `${title}: two plain chips`)
  const [iconSlot, item] = kids(titleRow!)
  assert.ok(['Spinner', 'IconButton'].includes(kids(iconSlot!)[0]?.type ?? ''), `${title}: icon on the title line`)
  const inItem = walk(item!).filter((n) => n.type === 'Text' && textOf(n) === title)
  assert.equal(inItem.length, 1, `${title}: the title beside the icon`)
  const titleText = nodes.find((n) => n.type === 'Text' && textOf(n) === title)
  const badges = nodes.filter((n) => n.type === 'Badge').map((n) => ({ text: textOf(n), tone: n.props?.tone ?? null }))
  // The meta row: the status badge is text only, with no icon inside or beside it.
  const meta = nodes.find((n) => n.type === 'Row' && kids(n).some((c) => c.type === 'Badge' || (c.type === 'Text' && c.props?.size === 'xs')))
  const statusSlot = meta ? kids(meta)[0] : undefined
  return {
    bar: bar ? { tone: bar.props?.background, border: bar.props?.border } : null,
    background: card.props?.background ?? 'none',
    border: card.props?.border ?? false,
    icon: icon?.type === 'Spinner' ? 'spinner' : { name: icon?.props?.icon, tone: icon?.props?.tone },
    weight: titleText?.props?.weight,
    badges,
    spinners: nodes.filter((n) => n.type === 'Spinner').length,
    statusBadgeIcons: statusSlot ? walk(statusSlot).filter((n) => ['Spinner', 'IconButton'].includes(n.type)).length : -1,
    statusBadgeType: statusSlot?.type,
    parentLine: rows.length > 2 ? textOf(rows[1]!) : null
  }
}

test('each status draws the prototype’s signals: bar, surface, toned icon, weight, badge', async () => {
  const { panel: p } = await open('list', { ...allOff, hideChildren: false })
  // needs you: warning bar, tinted and outlined card, warning icon, semibold, warning badge.
  const waiting = cardLook(p, 'Rotate the signing keys')
  assert.deepEqual(waiting.bar, { tone: 'warning', border: 'warning' })
  assert.equal(waiting.background, 'warning')
  assert.equal(waiting.border, 'warning')
  assert.deepEqual(waiting.icon, { name: 'warning', tone: 'warning' })
  assert.equal(waiting.weight, 'semibold')
  assert.deepEqual(waiting.badges.at(-1), { text: 'needs you', tone: 'warning' })
  // failed: danger bar and outline, no tint, error icon.
  const failed = cardLook(p, 'Fix the flaky webhook test')
  assert.deepEqual(failed.bar, { tone: 'danger', border: 'danger' })
  assert.equal(failed.background, 'none')
  assert.equal(failed.border, 'danger')
  assert.deepEqual(failed.icon, { name: 'error', tone: 'danger' })
  assert.equal(failed.weight, 'semibold')
  assert.deepEqual(failed.badges.at(-1), { text: 'failed', tone: 'danger' })
  // running: accent bar, Spinner before the title and beside the accent badge.
  const running = cardLook(p, 'Cart totals with discounts')
  assert.deepEqual(running.bar, { tone: 'accent', border: 'accent' })
  assert.equal(running.border, false)
  assert.equal(running.icon, 'spinner')
  assert.equal(running.spinners, 1, 'one status icon per card: the spinner beside the title')
  assert.equal(running.statusBadgeType, 'Badge')
  assert.equal(running.statusBadgeIcons, 0)
  assert.equal(running.weight, 'semibold')
  assert.deepEqual(running.badges.at(-1), { text: 'running', tone: 'accent' })
  // unread: amber bar like Orca's bell, bell icon, warning badge.
  const unread = cardLook(p, 'Receipt email template')
  assert.deepEqual(unread.bar, { tone: 'warning', border: 'warning' })
  assert.equal(unread.background, 'none')
  assert.deepEqual(unread.icon, { name: 'bell', tone: 'warning' })
  assert.equal(unread.weight, 'semibold')
  assert.deepEqual(unread.badges.at(-1), { text: 'unread', tone: 'warning' })
  // done: recedes. No bar, no outline, neutral check, regular title, no badge (quiet text).
  const done = cardLook(p, 'Bump dependencies')
  assert.equal(done.bar, null)
  assert.equal(done.border, false)
  assert.deepEqual(done.icon, { name: 'check', tone: 'neutral' })
  assert.equal(done.weight, 'regular')
  assert.equal(done.badges.some((b) => b.text === 'done'), false)
  // A parent whose child needs you looks like "needs you"; its summary parts carry their tones.
  const parent = cardLook(p, 'Checkout redesign')
  assert.deepEqual(parent.bar, { tone: 'warning', border: 'warning' })
  assert.equal(parent.background, 'warning')
  assert.equal(parent.border, 'warning')
  assert.equal(parent.weight, 'semibold')
  assert.ok(parent.badges.some((b) => b.text === '1 child needs you' && b.tone === 'warning'))
  assert.ok(parent.badges.some((b) => b.text === '1 running' && b.tone === 'accent'))
  assert.ok(parent.badges.some((b) => b.text === '1 unread' && b.tone === 'warning'))
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.warnings, [])
  assert.deepEqual(p.refusals, [])
})

test('the status bar count is the "Needs me" chip with the default filters', async () => {
  const snapshot = snapshotFixture()
  // The fixture has children that need the person (one blocked, one unread) under a parent.
  assert.ok(snapshot.workspaces.some((w) => w.parentId && w.agents.some((a) => a.state === 'blocked')))
  const { panel: p } = await open('list', DEFAULT_FILTERS, snapshot)
  const chip = p.find({ type: 'Button', text: /^Needs me \d+$/ })
  assert.ok(chip)
  assert.equal(chip.text, `Needs me ${needsMeCount(snapshot)}`)
  assert.equal(needsMeCount(snapshot), 2, 'children count once, through their parent')
})

test('the status badge has no icon, for every status', async () => {
  const { panel: p } = await open('list', { ...allOff, hideChildren: false })
  for (const title of ['Rotate the signing keys', 'Fix the flaky webhook test', 'Cart totals with discounts', 'Receipt email template', 'Bump dependencies']) {
    const look = cardLook(p, title)
    assert.equal(look.statusBadgeIcons, 0, `${title}: badge text only`)
    assert.ok(['Badge', 'Text'].includes(look.statusBadgeType ?? ''), `${title}: a Badge or quiet text`)
    assert.equal(look.spinners + (typeof look.icon === 'string' ? 0 : 1), 1, `${title}: one status icon`)
  }
})

// -- Host chips ---------------------------------------------------------------------------------

const EMOJI = /[\u{1F300}-\u{1FAFF}\u26AA]/u

test('host chips: the plain host name, everywhere (cards, rows, groups, host filter, parent line)', async () => {
  for (const view of ['list', 'projects', 'tree']) {
    const { panel: p } = await open(view, { ...allOff, hideChildren: false })
    const badges = p.findAll({ type: 'Badge' }).map((b) => b.text)
    assert.ok(badges.includes('Local'), `${view}: Local chip`)
    assert.ok(badges.includes('Build server'), `${view}: Build server chip`)
    assert.ok(badges.every((t) => !EMOJI.test(t)), `${view}: no colour emoji in chips`)
    // Host chips are not buttons any more.
    assert.equal(p.find({ type: 'Button', text: /Local$|Build server$/ }), null, `${view}: no host button`)
    const links = p.findAll({ type: 'Link' }).map((l) => l.text)
    assert.ok(links.every((t) => !EMOJI.test(t)), `${view}: parent line plain`)
    if (view === 'projects') {
      const group = p.find({ type: 'Collapsible', label: 'Storefront' })
      assert.match(String((group?.props as { description?: string }).description), /^(Local, Build server|Build server, Local) · /)
    }
    assert.equal(p.persisted.plugin.hostColors, undefined, 'no colour state')
    assert.deepEqual(p.errors, [])
    assert.deepEqual(p.warnings, [])
    assert.deepEqual(p.refusals, [])
    await p.unmount()
    panel = undefined
  }
  const { panel: p } = await open('list')
  const hostSelect = p.find({ type: 'Select', label: 'Host' })
  const labels = (hostSelect?.props as { options: { label: string }[] }).options.map((o) => o.label)
  assert.deepEqual(labels, ['All hosts', 'Local', 'Build server'])
})

test('the chip line is part of the card: pressing it opens the agent', async () => {
  const { panel: p, opened } = await open('list')
  await p.press({ type: 'ListItem', text: /^Payments API\/key-rotation/ })
  assert.deepEqual(opened.at(-1), { workspaceId: 'Local|repo-pay::/home/dev/workspaces/payments-api/key-rotation', agentId: (opened.at(-1) as { agentId: string }).agentId })
  assert.match(String((opened.at(-1) as { agentId: string }).agentId), /^Local\|repo-pay::.*\|s-keys$/)
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.warnings, [])
})

// -- Card elements ------------------------------------------------------------------------------

const STATUS_LABELS = new Set(['needs you', 'blocked: needs you', 'failed', 'interrupted', 'running', 'unread', 'done'])
const HOSTS = new Set(['Local', 'Build server'])

/** Every card in the panel, by its title List. */
function cards(p: TestPanel): Node[] {
  const root = p.tree()
  assert.ok(root && typeof root !== 'string')
  return walk(root).filter(
    (n) => n.type === 'Box' && n.props?.direction === 'row' && n.props?.radius === 'md' && walk(n).some((d) => d.type === 'List' && !isChipList(String(d.props?.label)))
  )
}

/** How many of each element all cards draw together. */
function elementCounts(p: TestPanel): Record<CardElement, number> {
  const out = Object.fromEntries(CARD_ELEMENTS.map((e) => [e.key, 0])) as Record<CardElement, number>
  for (const card of cards(p)) {
    const nodes = walk(card)
    const chipList = nodes.find((n) => n.type === 'List' && isChipList(String(n.props?.label)))
    for (const b of chipList ? walk(chipList).filter((n) => n.type === 'Badge') : []) out[HOSTS.has(textOf(b)) ? 'host' : 'project']++
    out.parent += nodes.filter((n) => n.type === 'Link' && textOf(n).startsWith('⑂ child of')).length
    out.reply += nodes.filter((n) => n.type === 'Text' && /^(Agent|You):$/.test(textOf(kids(n)[0] ?? ''))).length
    out.status += nodes.filter((n) => (n.type === 'Badge' || (n.type === 'Text' && n.props?.size === 'xs')) && STATUS_LABELS.has(textOf(n))).length
    out.children += nodes.filter((n) => n.type === 'Text' && /^\d+ child(ren)?$/.test(textOf(n))).length
    const meta = nodes.filter((n) => n.type === 'Text' && n.props?.size === 'xs' && kids(n).some((c) => c.type === 'RelativeTime') || (n.type === 'Text' && n.props?.size === 'xs' && /^(claude|codex|gemini|agent|\d+ subagents?|terminal)( · |$)/.test(textOf(n))))
    for (const m of meta) {
      const parts = textOf(m).split(' · ')
      if (/^(claude|codex|gemini|agent)$/.test(parts[0] ?? '')) out.agent++
      out.time += kids(m).filter((c) => c.type === 'RelativeTime').length
      out.subagents += parts.filter((x) => /^\d+ subagents?$/.test(x)).length
      out.terminal += parts.filter((x) => x === 'terminal').length
    }
  }
  return out
}

const withChildren = { ...allOff, hideChildren: false }

test('Card elements: the header button opens a section with one switch per element', async () => {
  const { panel: p } = await open('list', withChildren)
  const btn = p.find({ type: 'IconButton', label: 'Card elements' })
  assert.ok(btn)
  assert.equal((btn.props as { icon: string }).icon, 'layers')
  assert.equal((btn.props as { tooltip: string }).tooltip, 'Card elements')
  assert.equal(p.find({ type: 'Switch' }), null, 'closed by default')
  await p.press({ type: 'IconButton', label: 'Card elements' })
  assert.deepEqual(
    p.findAll({ type: 'Switch' }).map((x) => (x.props as { label: string }).label),
    ['Project / workspace', 'Machine', 'Parent', 'Last reply', 'Status label', 'Children summary', 'Agent kind', 'Time', 'Subagents', 'Terminal tag']
  )
  assert.ok(p.findAll({ type: 'Switch' }).every((x) => (x.props as { checked: boolean }).checked))
  assert.equal(p.persisted.plugin.elementsOpen, true)
  // Pressing the button again closes it; so does Done.
  await p.press({ type: 'IconButton', label: 'Card elements' })
  assert.equal(p.find({ type: 'Switch' }), null)
  await p.press({ type: 'IconButton', label: 'Card elements' })
  await p.press({ type: 'IconButton', label: 'Close card elements' })
  assert.equal(p.find({ type: 'Switch' }), null)
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.warnings, [])
  assert.deepEqual(p.refusals, [])
})

test('Card elements: each switch hides exactly that element, on every card', async () => {
  const { panel: p } = await open('list', withChildren, snapshotFixture(), { elementsOpen: true })
  const all = elementCounts(p)
  for (const e of CARD_ELEMENTS) assert.ok(all[e.key] > 0, `the fixture shows ${e.key}`)
  const titles = cardTitles(p)
  for (const e of CARD_ELEMENTS) {
    await p.toggle({ type: 'Switch', label: e.label })
    const now = elementCounts(p)
    assert.equal(now[e.key], 0, `${e.key} hidden`)
    for (const o of CARD_ELEMENTS) if (o.key !== e.key) assert.equal(now[o.key], all[o.key], `${e.key} off leaves ${o.key}`)
    // Always shown: the cards, their titles, status icons and bars.
    assert.deepEqual(cardTitles(p), titles)
    assert.deepEqual(p.persisted.plugin.hiddenElements, { [e.key]: true })
    await p.toggle({ type: 'Switch', label: e.label })
    assert.deepEqual(p.persisted.plugin.hiddenElements, {})
  }
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.warnings, [])
  assert.deepEqual(p.refusals, [])
})

test('Card elements: the choice applies in every view', async () => {
  for (const view of ['projects', 'tree']) {
    const { panel: p } = await open(view, withChildren, snapshotFixture(), { hiddenElements: { project: true, reply: true, time: true } })
    const c = elementCounts(p)
    assert.equal(c.project + c.reply + c.time, 0, view)
    assert.ok(c.host > 0 && c.status > 0 && c.agent > 0, view)
    await p.unmount()
    panel = undefined
  }
})

test('Card elements: a row whose elements are all hidden collapses', async () => {
  const hiddenElements = { project: true, host: true, status: true, children: true, agent: true, time: true, subagents: true, terminal: true, reply: true, parent: true }
  const { panel: p } = await open('list', withChildren, snapshotFixture(), { hiddenElements })
  assert.ok(cards(p).length > 0)
  for (const card of cards(p)) {
    const nodes = walk(card)
    assert.equal(nodes.some((n) => n.type === 'List' && isChipList(String(n.props?.label))), false, 'no chip line')
    assert.equal(nodes.some((n) => n.type === 'Row'), false, 'no meta row')
    assert.equal(nodes.some((n) => n.type === 'Link'), false, 'no parent line')
    const item = nodes.find((n) => n.type === 'ListItem')!
    // Only the title is left in the card's item.
    assert.deepEqual(kids(kids(item)[0]!).map((n) => n.type), ['Text'])
    // The status icon and the bar stay.
    assert.ok(nodes.some((n) => n.type === 'Spinner' || n.type === 'IconButton'))
  }
  const waiting = cardLook2(p, 'Rotate the signing keys')
  assert.equal(waiting.bar, 'warning')
  // The tooltip says how many are hidden; the button is toned.
  const btn = p.find({ type: 'IconButton', label: 'Card elements' })
  assert.equal((btn?.props as { tooltip: string }).tooltip, 'Card elements (10 hidden)')
  assert.equal((btn?.props as { tone: string }).tone, 'accent')
  // Only the chips hidden: the chip line goes, the rest stays.
  await p.unmount()
  const again = await open('list', withChildren, snapshotFixture(), { hiddenElements: { project: true, host: true } })
  const c = elementCounts(again.panel)
  assert.equal(c.project + c.host, 0)
  assert.ok(c.status > 0 && c.reply > 0)
  for (const card of cards(again.panel)) assert.equal(walk(card).some((n) => n.type === 'List' && isChipList(String(n.props?.label))), false)
  // Only the meta row's elements hidden: the row goes, the reply stays.
  await again.panel.unmount()
  const meta = await open('list', withChildren, snapshotFixture(), { hiddenElements: { status: true, children: true, agent: true, time: true, subagents: true, terminal: true } })
  for (const card of cards(meta.panel)) {
    const titleList = walk(card).find((n) => n.type === 'List' && !isChipList(String(n.props?.label)))!
    assert.equal(walk(titleList).some((n) => n.type === 'Row'), false, 'no empty meta row')
  }
  assert.ok(elementCounts(meta.panel).reply > 0)
  assert.deepEqual(meta.panel.errors, [])
  assert.deepEqual(meta.panel.warnings, [])
})

/** The bar tone of a card, found by title. */
function cardLook2(p: TestPanel, title: string) {
  const card = cards(p).find((c) => walk(c).some((d) => d.type === 'List' && d.props?.label === title))
  assert.ok(card, title)
  return { bar: kids(card).find((c) => c.props?.width === 3)?.props?.background ?? null }
}

test('Card elements: Show all resets, and the choice persists across reloads', async () => {
  const { panel: p } = await open('list', withChildren, snapshotFixture(), { elementsOpen: true })
  await p.toggle({ type: 'Switch', label: 'Machine' })
  await p.toggle({ type: 'Switch', label: 'Time' })
  await p.toggle({ type: 'Switch', label: 'Last reply' })
  assert.deepEqual(p.persisted.plugin.hiddenElements, { host: true, time: true, reply: true })
  assert.equal((p.find({ type: 'IconButton', label: 'Card elements' })?.props as { tooltip: string }).tooltip, 'Card elements (3 hidden)')
  // A new panel run (a reload or an Orca restart) starts from what was persisted.
  const persisted = { ...p.persisted.plugin }
  await p.unmount()
  const host = mockHost({ requests: { 'board.snapshot': () => snapshotFixture() } })
  panel = await mount(panelModule, { host, persisted: { plugin: persisted } })
  const q = panel
  const c = elementCounts(q)
  assert.equal(c.host + c.time + c.reply, 0, 'still hidden after a reload')
  assert.ok(c.project > 0)
  assert.equal((q.find({ type: 'Switch', label: 'Machine' })?.props as { checked: boolean }).checked, false)
  await q.press({ type: 'Button', text: 'Show all' })
  assert.deepEqual(q.persisted.plugin.hiddenElements, {})
  const all = elementCounts(q)
  for (const e of CARD_ELEMENTS) assert.ok(all[e.key] > 0, `${e.key} back`)
  assert.ok(q.findAll({ type: 'Switch' }).every((x) => (x.props as { checked: boolean }).checked))
  assert.equal((q.find({ type: 'IconButton', label: 'Card elements' })?.props as { tooltip: string }).tooltip, 'Card elements')
  assert.deepEqual(q.errors, [])
  assert.deepEqual(q.warnings, [])
})

// -- Parent line --------------------------------------------------------------------------------

test('a child’s card says whose child it is; pressing the line opens the parent', async () => {
  const { panel: p, opened } = await open('list', { ...allOff, hideChildren: false })
  // Parent on another host: its host name; then the parent's most recent chat.
  assert.equal(cardLook(p, 'Payment step form').parentLine, '⑂ child of Storefront/main on Local · Checkout redesign')
  // Same host: no host.
  assert.equal(cardLook(p, 'Cart totals with discounts').parentLine, '⑂ child of Storefront/main · Checkout redesign')
  assert.equal(cardLook(p, 'Rotate the signing keys').parentLine, null, 'no line without a parent')
  await p.press({ type: 'Link', text: /^⑂ child of Storefront\/main on Local/ })
  assert.deepEqual(opened.at(-1), { workspaceId: 'Local|repo-shop::/home/dev/code/web-shop', agentId: 'Local|repo-shop::/home/dev/code/web-shop|s-plan' })
  // The rest of the card still opens the child.
  await p.press({ type: 'ListItem', text: /Payment step form/ })
  assert.equal((opened.at(-1) as { workspaceId: string }).workspaceId, 'Build server|repo-b-shop::/srv/work/workspaces/payment-step')
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.warnings, [])
})

test('the parent line shows in Projects and Tree too', async () => {
  for (const view of ['projects', 'tree']) {
    const { panel: p } = await open(view)
    assert.ok(p.find({ type: 'Link', text: '⑂ child of Storefront/main on Local · Checkout redesign' }), view)
    assert.ok(p.find({ type: 'Link', text: '⑂ child of Storefront/main · Checkout redesign' }), view)
    await p.unmount()
    panel = undefined
  }
})

// -- Floating workspace closed ------------------------------------------------------------------

test('floating workspace closed: an inline, dismissible message says how to open it', async () => {
  const host = mockHost({
    requests: {
      'board.snapshot': () => snapshotFixture(),
      'board.open': () => ({ ok: false, how: 'floating workspace', error: 'floatingWorkspace.maximize cannot run in this view', code: 'floating-closed' as const })
    }
  })
  panel = await mount(panelModule, { host, persisted: { plugin: { view: 'list', filters: allOff } } })
  const p = panel
  await p.press({ type: 'ListItem', text: /Quick question about regex/ })
  assert.ok(p.find({ type: 'Callout', text: FLOATING_CLOSED }))
  assert.equal(FLOATING_CLOSED, 'The floating workspace is closed. Press ⌘⌥A (Ctrl+Alt+A on Windows/Linux) to open it, then click the chat again.')
  assert.deepEqual(p.persisted.plugin.openNotice, { tone: 'warning', text: FLOATING_CLOSED })
  await p.press({ type: 'IconButton', label: 'Dismiss' })
  assert.equal(p.find({ type: 'Callout', text: FLOATING_CLOSED }), null)
  assert.equal(p.persisted.plugin.openNotice, null)
  assert.deepEqual(p.refusals, [])
})
