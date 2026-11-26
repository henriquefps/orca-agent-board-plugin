// The worker against a mock Orca host and a fake CLI built from invented fixtures.
import { afterEach, assert, mockHost, mountWorker, test, type TestWorker } from 'orca/testing'
import type { CliRunner } from './cli.ts'
import { cliAnswers, hostApiFixture } from './fixtures.ts'
import { NOTICE_NO_CLI } from './model.ts'
import * as main from './worker.ts'

const NOW = 1_800_000_000_000
let worker: TestWorker | undefined
afterEach(async () => {
  await worker?.deactivate()
  worker = undefined
  delete main.deps.cli
  delete main.deps.floating
  delete main.deps.now
  delete main.deps.debounceMs
})

function fakeCli(calls: string[][] = []): CliRunner {
  const answer = cliAnswers(NOW)
  return async (args) => {
    calls.push([...args])
    const result = answer(args)
    return result === undefined ? { error: `unknown command ${args.join(' ')}` } : { result }
  }
}

function hostOnly() {
  const h = hostApiFixture(NOW)
  return mockHost({
    results: {
      'workspace.list': { workspaces: h.workspaces, truncated: false },
      'project.list': { projects: h.projects, truncated: false },
      'agents.list': (params: { workspaceId?: string }) => ({ agents: h.agents[params.workspaceId ?? ''] ?? [] }),
      'statusBar.update': { ok: true },
      'workspace.open': { opened: true },
      'terminal.focus': { focused: true },
      'commands.run': { ran: true }
    }
  })
}

test('builds the board from the CLI: hosts, projects, parents, floating chats', async () => {
  const calls: string[][] = []
  main.deps.cli = fakeCli(calls)
  main.deps.floating = async () => ['s-float']
  main.deps.now = () => NOW
  worker = await mountWorker(main, { host: hostOnly() })
  const snap = await worker.request('board.snapshot', { force: true })
  assert.equal(snap.source, 'cli')
  assert.deepEqual(snap.hosts, ['Local', 'Build server'])
  assert.deepEqual(snap.notices, [])
  assert.deepEqual(snap.errors, [])
  assert.equal(snap.projects['github.com/acme/web-shop'], 'Storefront')
  const pay = snap.workspaces.find((w) => w.name === 'payment-step')
  assert.equal(pay?.parentId, 'Local|repo-shop::/home/dev/code/web-shop')
  assert.ok(snap.workspaces.some((w) => w.floating && w.agents[0]?.title === 'Quick question about regex'))
  // One `worktree ps` per host.
  assert.equal(calls.filter((c) => c[0] === 'worktree' && c[1] === 'ps').length, 2)
  // The status bar shows the agents that need the person.
  const bar = worker.host.callsOf('statusBar.update').at(-1) as { text: string; visible: boolean }
  assert.deepEqual([bar.text, bar.visible], ['4 need you', true])
  assert.deepEqual(worker.refusals, [])
})

test('without the CLI it falls back to the host API and says what is off', async () => {
  main.deps.cli = null
  main.deps.floating = null
  main.deps.now = () => NOW
  worker = await mountWorker(main, { host: hostOnly() })
  const snap = await worker.request('board.snapshot', { force: true })
  assert.equal(snap.source, 'host')
  assert.deepEqual(snap.notices, [NOTICE_NO_CLI])
  assert.equal(snap.workspaces.length, 3)
  const keys = snap.workspaces.find((w) => w.name === 'key-rotation')
  assert.equal(keys?.agents[0]?.state, 'waiting')
  assert.equal(snap.projects[keys?.project ?? ''], 'Payments API')
  assert.deepEqual(worker.refusals, [])
})

test('a CLI that cannot read this computer falls back to the host API', async () => {
  main.deps.cli = async () => ({ error: 'Orca is not running' })
  main.deps.floating = null
  main.deps.now = () => NOW
  worker = await mountWorker(main, { host: hostOnly() })
  const snap = await worker.request('board.snapshot', { force: true })
  assert.equal(snap.source, 'host')
  assert.match(snap.notices[0] ?? '', /Orca CLI failed \(Orca is not running\)/)
})

test('opens local workspaces with the host API and remote ones with the CLI', async () => {
  const calls: string[][] = []
  main.deps.cli = fakeCli(calls)
  main.deps.floating = null
  main.deps.now = () => NOW
  worker = await mountWorker(main, { host: hostOnly() })
  const snap = await worker.request('board.snapshot', { force: true })
  const local = snap.workspaces.find((w) => w.name === 'key-rotation')
  const remote = snap.workspaces.find((w) => w.name === 'flaky-tests')
  assert.ok(local && remote)

  const r1 = await worker.request('board.open', { workspaceId: local.id, agentId: local.agents[0]?.id })
  assert.deepEqual(r1, { ok: true, how: 'workspace.open' })
  assert.deepEqual(worker.host.callsOf('workspace.open').at(-1), { workspaceId: 'identity:wt2:local:pay-keys' })

  const r2 = await worker.request('board.open', { workspaceId: remote.id })
  assert.deepEqual(r2, { ok: true, how: 'worktree activate' })
  assert.deepEqual(calls.at(-1), ['worktree', 'activate', '--environment', 'Build server', '--worktree', 'identity:wt2:runtime:pay-flaky'])
  assert.deepEqual(worker.refusals, [])
})

test('a terminal agent is focused; the floating workspace is maximized', async () => {
  main.deps.cli = null
  main.deps.floating = null
  main.deps.now = () => NOW
  worker = await mountWorker(main, { host: hostOnly() })
  const snap = await worker.request('board.snapshot', { force: true })
  const cart = snap.workspaces.find((w) => w.name === 'cart-totals')
  const r = await worker.request('board.open', { workspaceId: cart?.id ?? '', agentId: cart?.agents[0]?.id })
  assert.deepEqual(r, { ok: true, how: 'terminal.focus' })
  assert.deepEqual(worker.host.callsOf('terminal.focus').at(-1), { terminalId: 't-cart' })

  main.deps.cli = fakeCli()
  main.deps.floating = async () => ['s-float']
  await worker.deactivate()
  worker = await mountWorker(main, { host: hostOnly() })
  const snap2 = await worker.request('board.snapshot', { force: true })
  const floating = snap2.workspaces.find((w) => w.floating)
  const r2 = await worker.request('board.open', { workspaceId: floating?.id ?? '' })
  assert.deepEqual(r2, { ok: true, how: 'floating workspace' })
  assert.deepEqual(worker.host.callsOf('commands.run').at(-1), { action: 'floatingWorkspace.maximize' })
})

test('agent events tell open panels to refresh', async () => {
  main.deps.cli = fakeCli()
  main.deps.floating = null
  main.deps.debounceMs = 0
  worker = await mountWorker(main, { host: hostOnly() })
  await worker.request('board.snapshot', {})
  await worker.emit('agent.status.changed', { workspaceId: null, paneKey: 'tab-7:pane-1', terminalId: 't-9', state: 'waiting', receivedAt: 1 })
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(worker.posts.some((p) => p.event === 'board.changed'))
})
