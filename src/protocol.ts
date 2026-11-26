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

/** `board.copy`: which tool copied it, or why nothing could (the panel then shows the text). */
export type CopyResult = { ok: true; tool: string } | { ok: false; error: string }
export type MarkReadResult = { ok: boolean; error?: string }

declare module 'orca' {
  interface PluginRequests {
    /** The board; `force` skips the worker's short cache. */
    'board.snapshot': { input: { force?: boolean }; output: BoardSnapshot }
    /** Shows a workspace (and, for a terminal agent, its terminal) in Orca. */
    'board.open': { input: { workspaceId: string; agentId?: string }; output: OpenResult }
    /** Copies text to this computer's clipboard with the platform's tool (the host API has none). */
    'board.copy': { input: { text: string }; output: CopyResult }
    /** `worktree set --environment <env> --worktree <selector> --read` for a board workspace. */
    'board.markRead': { input: { workspaceId: string }; output: MarkReadResult }
  }
  interface PluginPanelEvents {
    /** Something changed in Orca: ask for a new snapshot. */
    'board.changed': { at: number }
  }
}
