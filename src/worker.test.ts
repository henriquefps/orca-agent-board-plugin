// The worker against a mock Orca host and a fake CLI built from invented fixtures.
import { afterEach, assert, hostError, mockHost, mountWorker, test, type TestWorker } from 'orca/testing'
import type { CliRunner } from './cli.ts'
import { cliAnswers, hostApiFixture, workspaceRowsFixture } from './fixtures.ts'
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
  assert.deepEqual([bar.text, bar.visible], ['2 need you', true])
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

/** This computer's Orca with the paired server's rows in `workspace.list` (`runtime:env-1`). */
function pairedHost(opts: { remoteTerminal?: string | null; floatingOpen?: boolean } = {}) {
  return mockHost({
    results: {
      'workspace.list': { workspaces: workspaceRowsFixture(NOW), truncated: false },
      'project.list': { projects: [], truncated: false },
      'agents.list': (params: { workspaceId?: string }) => ({
        agents:
          params.workspaceId === 'wt-remote-receipt' && opts.remoteTerminal
            ? [{ terminalId: opts.remoteTerminal, title: 'Receipt email template', agent: 'gemini', state: 'done', stateStartedAt: NOW }]
            : []
      }),
      'statusBar.update': { ok: true },
      'workspace.open': { opened: true },
      'terminal.focus': { focused: true },
      'commands.run': () => {
        if (opts.floatingOpen === false) throw hostError('action_failed', 'floatingWorkspace.maximize cannot run in this view')
        return { ran: true }
      }
    }
  })
}

async function pairedWorker(opts: Parameters<typeof pairedHost>[0] = {}, calls: string[][] = []) {
  main.deps.cli = fakeCli(calls)
  main.deps.floating = async () => ['s-float']
  main.deps.now = () => NOW
  worker = await mountWorker(main, { host: pairedHost(opts) })
  const snap = await worker.request('board.snapshot', { force: true })
  const ws = (name: string) => {
    const w = snap.workspaces.find((x) => x.name === name)
    assert.ok(w, name)
    return w
  }
  return { w: worker, ws, snap }
}

const activateOn = (calls: string[][], env: string) =>
  calls.filter((c) => c[0] === 'worktree' && c[1] === 'activate' && c[c.indexOf('--environment') + 1] === env)

test('open routing: this computer’s workspace → workspace.open', async () => {
  const calls: string[][] = []
  const { w, ws } = await pairedWorker({}, calls)
  const local = ws('key-rotation')
  const r = await w.request('board.open', { workspaceId: local.id, agentId: local.agents[0]?.id })
  assert.deepEqual(r, { ok: true, how: 'workspace.open' })
  assert.deepEqual(w.host.callsOf('workspace.open').at(-1), { workspaceId: 'identity:wt2:local:pay-keys' })
  assert.equal(activateOn(calls, 'local').length, 0)
  assert.deepEqual(w.refusals, [])
})

test('open routing: a chat on another host → workspace.open with its runtime row, in this window', async () => {
  const calls: string[][] = []
  const { w, ws, snap } = await pairedWorker({}, calls)
  const remote = ws('flaky-tests')
  assert.equal(remote.hostId, 'runtime:env-1', 'the environment id from `environment list`')
  const r = await w.request('board.open', { workspaceId: remote.id, agentId: remote.agents[0]?.id })
  assert.deepEqual(r, { ok: true, how: 'workspace.open' })
  assert.deepEqual(w.host.callsOf('workspace.open').at(-1), { workspaceId: 'identity:wt2:runtime:pay-flaky' })
  // A child on another host opens the same way.
  const child = ws('payment-step')
  assert.equal(snap.workspaces.find((x) => x.id === child.parentId)?.host, 'Local')
  await w.request('board.open', { workspaceId: child.id, agentId: child.agents[0]?.id })
  assert.deepEqual(w.host.callsOf('workspace.open').at(-1), { workspaceId: 'identity:wt2:runtime:shop-pay' })
  assert.equal(activateOn(calls, 'Build server').length, 0, 'never worktree activate for another host')
  assert.deepEqual(w.refusals, [])
})

test('open routing: a terminal agent on another host → terminal.focus when the API knows its terminal', async () => {
  const calls: string[][] = []
  const { w, ws } = await pairedWorker({ remoteTerminal: 't-remote-receipt' }, calls)
  const term = ws('receipt-email')
  assert.equal(term.agents[0]?.kind, 'terminal')
  const r = await w.request('board.open', { workspaceId: term.id, agentId: term.agents[0]?.id })
  assert.deepEqual(r, { ok: true, how: 'terminal.focus' })
  // Mapped by path: the row id differs from the CLI's identity key.
  assert.deepEqual(w.host.callsOf('agents.list').at(-1), { workspaceId: 'wt-remote-receipt' })
  assert.deepEqual(w.host.callsOf('terminal.focus').at(-1), { terminalId: 't-remote-receipt' })
  assert.equal(activateOn(calls, 'Build server').length, 0)
})

test('open routing: a terminal agent on another host → CLI terminal switch otherwise', async () => {
  const calls: string[][] = []
  const { w, ws } = await pairedWorker({ remoteTerminal: null }, calls)
  const term = ws('receipt-email')
  const r = await w.request('board.open', { workspaceId: term.id, agentId: term.agents[0]?.id })
  assert.deepEqual(r, { ok: true, how: 'terminal switch' })
  assert.deepEqual(calls.at(-1), ['terminal', 'switch', '--environment', 'Build server', '--terminal', 'term_receipt'])
  assert.equal(w.host.callsOf('terminal.focus').length, 0)
  assert.equal(activateOn(calls, 'Build server').length, 0)
})

test('open routing: another host Orca does not list → a message, never worktree activate', async () => {
  const calls: string[][] = []
  main.deps.cli = fakeCli(calls)
  main.deps.floating = null
  main.deps.now = () => NOW
  worker = await mountWorker(main, {
    host: mockHost({ results: { 'workspace.list': { workspaces: [], truncated: false }, 'statusBar.update': { ok: true } } })
  })
  const snap = await worker.request('board.snapshot', { force: true })
  const remote = snap.workspaces.find((x) => x.name === 'flaky-tests')
  const r = await worker.request('board.open', { workspaceId: remote?.id ?? '', agentId: remote?.agents[0]?.id })
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /cannot be shown in this window/)
  assert.equal(activateOn(calls, 'Build server').length, 0)
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

  await worker.deactivate()
  const { w, snap: snap2 } = await pairedWorker()
  const floating = snap2.workspaces.find((x) => x.floating)
  const r2 = await w.request('board.open', { workspaceId: floating?.id ?? '' })
  assert.deepEqual(r2, { ok: true, how: 'floating workspace' })
  assert.deepEqual(w.host.callsOf('commands.run').at(-1), { action: 'floatingWorkspace.maximize' })
})

test('floating workspace closed → floating-closed, so the panel can say how to open it', async () => {
  const { w, snap } = await pairedWorker({ floatingOpen: false })
  const floating = snap.workspaces.find((x) => x.floating)
  const r = await w.request('board.open', { workspaceId: floating?.id ?? '', agentId: floating?.agents[0]?.id })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'floating-closed')
  assert.match(r.error ?? '', /cannot run in this view/)
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
