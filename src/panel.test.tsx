// The panel with Orca's real runtime and checks, against invented fixtures.
import { afterEach, assert, mockHost, mount, test, type TestPanel } from 'orca/testing'
import { hostOnlySnapshotFixture, snapshotFixture } from './fixtures.ts'
import { NOTICE_NO_CLI } from './model.ts'
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
