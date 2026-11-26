// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { BoardSnapshot } from './model.ts'

export type OpenResult = {
  ok: boolean
  /** How it was shown: `workspace.open`, `terminal.focus`, `worktree activate`, … */
  how: string
  error?: string
  /** `floating-closed`: the floating workspace is not open, and a plugin cannot open it. */
  code?: 'floating-closed'
}

declare module 'orca' {
  interface PluginRequests {
    /** The board; `force` skips the worker's short cache. */
    'board.snapshot': { input: { force?: boolean }; output: BoardSnapshot }
    /** Shows a workspace (and, for a terminal agent, its terminal) in Orca. */
    'board.open': { input: { workspaceId: string; agentId?: string }; output: OpenResult }
  }
  interface PluginPanelEvents {
    /** Something changed in Orca: ask for a new snapshot. */
    'board.changed': { at: number }
  }
}
