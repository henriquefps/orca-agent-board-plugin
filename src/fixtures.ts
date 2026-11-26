// Invented Orca answers for tests, checks and screenshots. Hosts, projects, people and messages
// are made up: two machines ("Local", "Build server"), three projects. The new cases of v0.1.2:
// children on another host than their parent (payment-step, receipt-email), a terminal agent on
// another host (receipt-email). v0.1.4: chat-only workspaces on another host (payment-step,
// flaky-tests), which the board shows here through a temporary terminal.
import { NOTICE_NO_CLI, type BoardSnapshot } from './model.ts'
import type { CliHostData } from './sources.ts'
import { floatingWorkspace, hostsFromEnvironments, reposFromCli, snapshotFromCli, snapshotFromHost } from './sources.ts'

const MIN = 60_000

/** The paired server's environment id: Orca's host API names that server `runtime:<id>`. */
export const BUILD_ENV_ID = 'env-1'

export function cliFixture(now = Date.now()): { environments: unknown; data: CliHostData[]; floatingShows: unknown[] } {
  const environments = { environments: [{ id: BUILD_ENV_ID, name: 'Build server' }] }
  const [local, build] = hostsFromEnvironments(environments)
  if (!local || !build) throw new Error('fixture hosts')

  const localRepos = {
    repos: [
      { id: 'repo-shop', path: '/home/dev/code/web-shop', displayName: 'web-shop', kind: 'git', gitRemoteIdentity: { canonicalKey: 'github.com/acme/web-shop' } },
      { id: 'repo-pay', path: '/home/dev/code/payments-api', displayName: 'Payments API', kind: 'git', gitRemoteIdentity: { canonicalKey: 'github.com/acme/payments-api' } },
      { id: 'repo-notes', path: '/home/dev/notes', displayName: 'notes', kind: 'git', gitRemoteIdentity: null }
    ]
  }
  const buildRepos = {
    repos: [
      // Renamed in Orca on the build server: wins over the folder names everywhere.
      { id: 'repo-b-shop', path: '/srv/work/web-shop', displayName: 'Storefront', kind: 'git', gitRemoteIdentity: { canonicalKey: 'github.com/acme/web-shop' } },
      { id: 'repo-b-pay', path: '/srv/work/payments-api', displayName: 'payments-api', kind: 'git', gitRemoteIdentity: { canonicalKey: 'github.com/acme/payments-api' } }
    ]
  }

  const chat = (id: string, o: Record<string, unknown>) => ({
    paneKey: `structured-agent-session-${id}:pane`,
    address: `orca_session_id:${id}`,
    orcaSessionId: id,
    agentType: 'claude',
    children: [],
    interrupted: false,
    activity: { unread: false },
    ...o
  })

  const localPs = {
    worktrees: [
      {
        worktreeId: 'repo-shop::/home/dev/code/web-shop',
        repoId: 'repo-shop',
        repo: 'web-shop',
        identity: { key: 'wt2:local:shop-main' },
        address: { environment: 'local', worktree: 'identity:wt2:local:shop-main' },
        path: '/home/dev/code/web-shop',
        branch: 'refs/heads/main',
        displayName: 'main',
        isMainWorktree: true,
        isPinned: true,
        workspaceStatus: 'in-progress',
        lastActivityAt: now - 4 * MIN,
        unread: false,
        linkedItems: [],
        parent: null,
        agents: [
          chat('s-plan', {
            state: 'done',
            mainAgent: { state: 'done', outcome: 'success' },
            conversationName: 'Checkout redesign',
            prompt: 'Split the checkout redesign into workers, one per step.',
            lastAssistantMessage: 'Three workers are on it: cart totals here, the payment step on the build server, and the receipt email. I will review each PR as it lands.',
            updatedAt: now - 4 * MIN,
            children: [{}, {}]
          }),
          chat('s-old', {
            state: 'done',
            mainAgent: { state: 'done', outcome: 'success' },
            conversationName: 'Bump dependencies',
            lastAssistantMessage: 'All dependencies are on their latest minor versions and the tests pass.',
            updatedAt: now - 3 * 24 * 60 * MIN
          })
        ]
      },
      {
        worktreeId: 'repo-shop::/home/dev/workspaces/web-shop/cart-totals',
        repoId: 'repo-shop',
        repo: 'web-shop',
        identity: { key: 'wt2:local:shop-cart' },
        address: { environment: 'local', worktree: 'identity:wt2:local:shop-cart' },
        path: '/home/dev/workspaces/web-shop/cart-totals',
        branch: 'refs/heads/cart-totals',
        displayName: 'cart-totals',
        workspaceStatus: 'in-progress',
        lastActivityAt: now - 1 * MIN,
        linkedItems: [{ type: 'pr', number: 42, url: 'https://github.com/acme/web-shop/pull/42' }],
        parent: { selector: 'identity:wt2:local:shop-main', environment: { name: 'local' }, address: { worktree: 'identity:wt2:local:shop-main' } },
        agents: [
          chat('s-cart', {
            state: 'working',
            conversationName: 'Cart totals with discounts',
            lastAssistantMessage: 'Rounding now happens once per order instead of per line; updating the snapshot tests.',
            updatedAt: now - 1 * MIN
          })
        ]
      },
      {
        worktreeId: 'repo-pay::/home/dev/workspaces/payments-api/key-rotation',
        repoId: 'repo-pay',
        repo: 'payments-api',
        identity: { key: 'wt2:local:pay-keys' },
        address: { environment: 'local', worktree: 'identity:wt2:local:pay-keys' },
        path: '/home/dev/workspaces/payments-api/key-rotation',
        branch: 'refs/heads/key-rotation',
        displayName: 'key-rotation',
        workspaceStatus: 'in-review',
        lastActivityAt: now - 2 * MIN,
        parent: null,
        agents: [
          chat('s-keys', {
            agentType: 'codex',
            state: 'waiting',
            conversationName: 'Rotate the signing keys',
            lastAssistantMessage: 'The new key is ready. Should I revoke the old one now, or keep both valid for a day?',
            updatedAt: now - 2 * MIN
          })
        ]
      },
      {
        worktreeId: 'repo-notes::/home/dev/notes',
        repoId: 'repo-notes',
        repo: 'notes',
        identity: { key: 'wt2:local:notes' },
        address: { environment: 'local', worktree: 'identity:wt2:local:notes' },
        path: '/home/dev/notes',
        branch: 'refs/heads/main',
        displayName: 'main',
        isMainWorktree: true,
        lastActivityAt: now - 2 * 24 * 60 * MIN,
        parent: null,
        agents: []
      }
    ]
  }

  const buildPs = {
    worktrees: [
      {
        worktreeId: 'repo-b-shop::/srv/work/workspaces/payment-step',
        repoId: 'repo-b-shop',
        repo: 'web-shop',
        identity: { key: 'wt2:runtime:shop-pay' },
        address: { environment: 'Build server', worktree: 'identity:wt2:runtime:shop-pay' },
        path: '/srv/work/workspaces/payment-step',
        branch: 'refs/heads/payment-step',
        displayName: 'payment-step',
        lastActivityAt: now - 3 * MIN,
        parent: { selector: 'identity:wt2:local:shop-main', environment: { name: 'local' }, address: { worktree: 'identity:wt2:local:shop-main' } },
        agents: [
          chat('s-pay', {
            state: 'blocked',
            conversationName: 'Payment step form',
            lastAssistantMessage: 'I need permission to run the end-to-end tests against the sandbox card provider.',
            updatedAt: now - 3 * MIN
          })
        ]
      },
      {
        worktreeId: 'repo-b-shop::/srv/work/workspaces/receipt-email',
        repoId: 'repo-b-shop',
        repo: 'web-shop',
        identity: { key: 'wt2:runtime:shop-mail' },
        address: { environment: 'Build server', worktree: 'identity:wt2:runtime:shop-mail' },
        path: '/srv/work/workspaces/receipt-email',
        branch: 'refs/heads/receipt-email',
        displayName: 'receipt-email',
        lastActivityAt: now - 9 * MIN,
        unread: true,
        parent: { selector: 'identity:wt2:local:shop-main', environment: { name: 'local' }, address: { worktree: 'identity:wt2:local:shop-main' } },
        agents: [
          {
            paneKey: 'tab-7:pane-1',
            address: 'term_receipt',
            orcaSessionId: null,
            agentType: 'gemini',
            state: 'done',
            mainAgent: { state: 'done', outcome: 'success' },
            interrupted: false,
            conversationName: 'Receipt email template',
            lastAssistantMessage: 'The receipt email renders in light and dark mail clients; PR #43 is open.',
            updatedAt: now - 9 * MIN,
            children: [],
            activity: { unread: true }
          }
        ]
      },
      {
        worktreeId: 'repo-b-pay::/srv/work/workspaces/flaky-tests',
        repoId: 'repo-b-pay',
        repo: 'payments-api',
        identity: { key: 'wt2:runtime:pay-flaky' },
        address: { environment: 'Build server', worktree: 'identity:wt2:runtime:pay-flaky' },
        path: '/srv/work/workspaces/flaky-tests',
        branch: 'refs/heads/flaky-tests',
        displayName: 'flaky-tests',
        lastActivityAt: now - 30 * MIN,
        parent: null,
        agents: [
          chat('s-flaky', {
            state: 'done',
            mainAgent: { state: 'done', outcome: 'failure' },
            conversationName: 'Fix the flaky webhook test',
            lastAssistantMessage: 'The test still fails one run in ten; the retry queue is not drained between cases.',
            updatedAt: now - 30 * MIN
          })
        ]
      }
    ]
  }

  const floatingShows = [
    {
      orcaSessionId: 's-float',
      kind: 'structured',
      places: [
        {
          agent: 'claude',
          state: 'done',
          paneKey: 'structured-agent-session-s-float:pane',
          title: 'Quick question about regex',
          lastAssistantMessage: 'Use a lookahead: ^(?=.*\\d).{8,}$ matches eight or more characters with a digit.',
          updatedAt: now - 50 * MIN
        }
      ]
    }
  ]

  return {
    environments,
    data: [
      { host: local, ps: localPs, repos: reposFromCli(local.label, localRepos) },
      { host: build, ps: buildPs, repos: reposFromCli(build.label, buildRepos) }
    ],
    floatingShows
  }
}

/** Raw CLI answers by argument list, for a fake CLI runner. */
export function cliAnswers(now = Date.now()): (args: readonly string[]) => unknown {
  const f = cliFixture(now)
  const byEnv = new Map(f.data.map((d) => [d.host.env, d]))
  const repoJson = (env: string) => ({
    repos: (byEnv.get(env)?.repos ?? []).map((r) => ({
      id: r.id,
      path: r.path,
      displayName: r.displayName,
      gitRemoteIdentity: r.canonicalKey ? { canonicalKey: r.canonicalKey } : null
    }))
  })
  return (args) => {
    const env = args[args.indexOf('--environment') + 1] ?? 'local'
    if (args[0] === 'environment') return f.environments
    if (args[0] === 'repo') return repoJson(env)
    if (args[0] === 'worktree' && args[1] === 'ps') return byEnv.get(env)?.ps
    if (args[0] === 'agent' && args[1] === 'show') return f.floatingShows.find((s) => (s as { orcaSessionId: string }).orcaSessionId === args[2])
    if (args[0] === 'worktree' && args[1] === 'activate') return { ok: true }
    if (args[0] === 'worktree' && args[1] === 'set') return { worktree: { worktreeId: args[args.indexOf('--worktree') + 1] } }
    if (args[0] === 'terminal' && args[1] === 'list') {
      const sel = args[args.indexOf('--worktree') + 1]
      const ws = (obj(byEnv.get(env)?.ps).worktrees as Record<string, unknown>[] | undefined) ?? []
      const w = ws.find((x) => obj(x.address).worktree === sel)
      const terms = ((w?.agents as Record<string, unknown>[] | undefined) ?? [])
        .filter((a) => typeof a.address === 'string' && a.address.startsWith('term_'))
        .map((a) => ({ handle: a.address, connected: true, agentIdentity: { agent: a.agentType } }))
      return { terminals: terms }
    }
    if (args[0] === 'terminal' && args[1] === 'switch') return { focus: { navigated: true } }
    if (args[0] === 'terminal' && args[1] === 'create') return { terminal: { handle: 'term_board-temp' } }
    if (args[0] === 'terminal' && args[1] === 'close') return { close: { ptyKilled: true } }
    return undefined
  }
}

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {})

/**
 * `workspace.list` as this computer's Orca answers it: only its own workspaces. Orca omits paired
 * servers from the host API (`hostScope.omittedHostIds` names them `runtime:<environment id>`).
 */
export function workspaceRowsFixture(now = Date.now()) {
  const row = (id: string, name: string, path: string, minutes: number) => ({
    id, kind: 'worktree' as const, name, path, branch: name, hostId: 'local',
    status: { state: 'done', unread: false, terminalCount: 1, lastActivityAt: now - minutes * MIN }
  })
  return [
    row('identity:wt2:local:shop-main', 'main', '/home/dev/code/web-shop', 4),
    row('identity:wt2:local:shop-cart', 'cart-totals', '/home/dev/workspaces/web-shop/cart-totals', 1),
    row('identity:wt2:local:pay-keys', 'key-rotation', '/home/dev/workspaces/payments-api/key-rotation', 2)
  ]
}

export function snapshotFixture(now = Date.now(), withFloating = true): BoardSnapshot {
  const f = cliFixture(now)
  const floating = withFloating ? floatingWorkspace(f.floatingShows) : null
  return { ...snapshotFromCli(f.data, floating ? [floating] : []), at: now, tookMs: 120, notices: [] }
}

/** What the host API alone gives: no parents, no other servers, no last replies. */
export function hostApiFixture(now = Date.now()) {
  const workspaces = [
    { id: 'identity:wt2:local:shop-main', kind: 'worktree' as const, name: 'main', project: 'web-shop', projectId: 'repo-shop', path: '/home/dev/code/web-shop', branch: 'main', hostId: 'local', status: { state: 'done', unread: true, terminalCount: 1, lastActivityAt: now - 4 * MIN } },
    { id: 'identity:wt2:local:pay-keys', kind: 'worktree' as const, name: 'key-rotation', project: 'Payments API', projectId: 'repo-pay', path: '/home/dev/workspaces/payments-api/key-rotation', branch: 'key-rotation', hostId: 'local', status: { state: 'permission', unread: false, terminalCount: 1, lastActivityAt: now - 2 * MIN } },
    { id: 'identity:wt2:local:shop-cart', kind: 'worktree' as const, name: 'cart-totals', project: 'web-shop', projectId: 'repo-shop', path: '/home/dev/workspaces/web-shop/cart-totals', branch: 'cart-totals', hostId: 'local', status: { state: 'working', unread: false, terminalCount: 1, lastActivityAt: now - 1 * MIN } }
  ]
  const projects = [
    { id: 'repo-shop', name: 'web-shop', kind: 'git' as const, hostId: 'local', path: '/home/dev/code/web-shop' },
    { id: 'repo-pay', name: 'Payments API', kind: 'git' as const, hostId: 'local', path: '/home/dev/code/payments-api' }
  ]
  const agents: Record<string, { terminalId: string | null; title: string | null; agent: string | null; state: 'working' | 'waiting' | 'blocked' | 'done'; stateStartedAt: number; sessionId?: string | null }[]> = {
    'identity:wt2:local:shop-main': [{ terminalId: 't-plan', title: 'Checkout redesign', agent: 'claude', state: 'done', stateStartedAt: now - 4 * MIN, sessionId: 's-plan' }],
    'identity:wt2:local:pay-keys': [{ terminalId: 't-keys', title: 'Rotate the signing keys', agent: 'codex', state: 'waiting', stateStartedAt: now - 2 * MIN, sessionId: 's-keys' }],
    'identity:wt2:local:shop-cart': [{ terminalId: 't-cart', title: 'Cart totals with discounts', agent: 'claude', state: 'working', stateStartedAt: now - 1 * MIN, sessionId: 's-cart' }]
  }
  return { workspaces, projects, agents }
}

export function hostOnlySnapshotFixture(now = Date.now()): BoardSnapshot {
  const h = hostApiFixture(now)
  const base = snapshotFromHost(h.workspaces, h.projects, new Map(Object.entries(h.agents)))
  return { ...base, at: now, tookMs: 40, notices: [NOTICE_NO_CLI] }
}
