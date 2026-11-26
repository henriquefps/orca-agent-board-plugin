// `orca plugin check` (and `orca plugin shot --scenario`) render the panel once per scenario.
// Every scenario answers the board from invented fixtures, so no real Orca data is shown.
import { defineCheck } from 'orca/testing'
import { HOST_COLORS, hostOnlySnapshotFixture, snapshotFixture } from './fixtures.ts'
import { FLOATING_CLOSED } from './panel.tsx'

const board = () => snapshotFixture()
const allOff = { needsMe: false, running: false, unread: false, hideChildren: true, hideIdle: true }

export default defineCheck({
  list: {
    requests: { 'board.snapshot': board },
    persisted: { plugin: { view: 'list', filters: allOff } }
  },
  projects: {
    requests: { 'board.snapshot': board },
    persisted: { plugin: { view: 'projects', filters: allOff } }
  },
  tree: {
    requests: { 'board.snapshot': board },
    persisted: { plugin: { view: 'tree', filters: allOff } }
  },
  // One card in each status (needs you, failed, running, unread, done) and a parent whose
  // child needs you: the List with children shown.
  statuses: {
    requests: { 'board.snapshot': board },
    persisted: { plugin: { view: 'list', filters: { ...allOff, hideChildren: false } } }
  },
  needsYou: {
    requests: { 'board.snapshot': board },
    persisted: { plugin: { view: 'list', filters: { ...allOff, needsMe: true } } }
  },
  // v0.1.2. A running card: one spinner, beside the title; the badge is text only.
  runningBadge: {
    requests: { 'board.snapshot': board },
    persisted: { plugin: { view: 'list', filters: { ...allOff, running: true, hideChildren: false } } }
  },
  // Two hosts with custom colours (Local 🟣, Build server 🟠), in cards, groups and the host filter.
  hostColors: {
    requests: { 'board.snapshot': board },
    persisted: { plugin: { view: 'projects', filters: allOff, hostColors: HOST_COLORS } }
  },
  // Children shown: "⑂ child of Storefront/main 🔵 Local · Checkout redesign" under a child on
  // another host than its parent, and without the host for one on the same host.
  parentLine: {
    requests: { 'board.snapshot': board },
    persisted: { plugin: { view: 'list', filters: { ...allOff, hideChildren: false } } }
  },
  // Agents on another host: children of a Local parent and a terminal agent on the Build server.
  // Pressing one goes to the worker (board.open is not stubbed), which opens it in this window
  // with workspace.open / terminal.focus / terminal switch; check cannot press, so the routing
  // itself is tested in src/worker.test.ts.
  otherHost: {
    requests: { 'board.snapshot': board },
    persisted: { plugin: { view: 'tree', filters: allOff, host: 'Build server' } }
  },
  // The floating workspace was closed when its chat was pressed.
  floatingClosed: {
    requests: {
      'board.snapshot': board,
      'board.open': () => ({ ok: false, how: 'floating workspace', error: 'floatingWorkspace.maximize cannot run in this view', code: 'floating-closed' as const })
    },
    persisted: { plugin: { view: 'list', filters: allOff, openNotice: { tone: 'warning', text: FLOATING_CLOSED } } }
  },
  cliUnavailable: {
    requests: { 'board.snapshot': () => hostOnlySnapshotFixture() },
    persisted: { plugin: { view: 'list', filters: allOff } }
  },
  empty: {
    requests: { 'board.snapshot': () => ({ ...snapshotFixture(), workspaces: [] }) },
    persisted: { plugin: { view: 'list', filters: allOff } }
  }
})
