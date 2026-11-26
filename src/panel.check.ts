// `orca plugin check` (and `orca plugin shot --scenario`) render the panel once per scenario.
// Every scenario answers the board from invented fixtures, so no real Orca data is shown.
import { defineCheck } from 'orca/testing'
import { hostOnlySnapshotFixture, snapshotFixture } from './fixtures.ts'

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
  needsYou: {
    requests: { 'board.snapshot': board },
    persisted: { plugin: { view: 'list', filters: { ...allOff, needsMe: true } } }
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
