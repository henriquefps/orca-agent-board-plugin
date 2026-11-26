// `orca plugin check` (and `orca plugin shot --scenario`) render the panel once per scenario.
// Every scenario answers the board from invented fixtures, so no real Orca data is shown.
import { defineCheck } from 'orca/testing'
import { hostOnlySnapshotFixture, snapshotFixture } from './fixtures.ts'
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
  // v0.1.3. Plain host chips (the host name only) in cards, rows, groups and the host filter.
  hostChips: {
    requests: { 'board.snapshot': board },
    persisted: { plugin: { view: 'projects', filters: allOff } }
  },
  // The Card elements section open under the header, with Machine, Last reply and Time hidden:
  // the cards keep their chips row (project only), the title and the meta row without the time.
  cardElements: {
    requests: { 'board.snapshot': board },
    persisted: {
      plugin: { view: 'list', filters: { ...allOff, hideChildren: false }, elementsOpen: true, hiddenElements: { host: true, reply: true, time: true } }
    }
  },
  // Everything optional hidden: chips and meta rows collapse; icon, bar and title stay.
  cardElementsMinimal: {
    requests: { 'board.snapshot': board },
    persisted: {
      plugin: {
        view: 'list',
        filters: { ...allOff, hideChildren: false },
        hiddenElements: { project: true, host: true, parent: true, reply: true, status: true, children: true, agent: true, time: true, subagents: true, terminal: true }
      }
    }
  },
  // Children shown: "⑂ child of Storefront/main on Local · Checkout redesign" under a child on
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
