// The panel with Orca's real runtime and checks, against invented fixtures.
import { afterEach, assert, mockHost, mount, test, type TestPanel, type TreeSnapshot } from 'orca/testing'
import { hostOnlySnapshotFixture, snapshotFixture } from './fixtures.ts'
import { DEFAULT_FILTERS, needsMeCount, NOTICE_NO_CLI } from './model.ts'
import * as panelModule from './panel.tsx'

let panel: TestPanel | undefined
afterEach(async () => {
  await panel?.unmount()
  panel = undefined
})

const allOff = { needsMe: false, running: false, unread: false, hideChildren: true, hideIdle: true }

async function open(view: string, filters: Record<string, boolean> = allOff, snapshot = snapshotFixture()) {
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
  panel = await mount(panelModule, { host, persisted: { plugin: { view, filters } } })
  return { panel, opened }
}

const cardTitles = (p: TestPanel): string[] =>
  p.findAll({ type: 'List' }).map((l) => String((l.props as { label?: string }).label))

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
    (n) => n.type === 'Box' && n.props?.direction === 'row' && kids(n).some((c) => walk(c).some((d) => d.type === 'List' && d.props?.label === title))
  )
  assert.ok(card, `card ${title}`)
  const [first, second] = kids(card)
  const bar = first?.props?.width === 3 ? first : null
  const iconSlot = bar ? second : first
  const icon = iconSlot ? kids(iconSlot)[0] : undefined
  const nodes = walk(card)
  const titleText = nodes.find((n) => n.type === 'Text' && textOf(n) === title)
  const badges = nodes.filter((n) => n.type === 'Badge').map((n) => ({ text: textOf(n), tone: n.props?.tone ?? null }))
  return {
    bar: bar ? { tone: bar.props?.background, border: bar.props?.border } : null,
    background: card.props?.background ?? 'none',
    border: card.props?.border ?? false,
    icon: icon?.type === 'Spinner' ? 'spinner' : { name: icon?.props?.icon, tone: icon?.props?.tone },
    weight: titleText?.props?.weight,
    badges,
    spinners: nodes.filter((n) => n.type === 'Spinner').length
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
  assert.equal(running.spinners, 2)
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
