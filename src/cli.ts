// Finding and running the Orca CLI from the plugin worker (Node). Orca starts workers with a
// short environment allowlist (PATH, HOME, …), so `ORCA_CLI_COMMAND` is usually not set here;
// the worker runs inside Orca's own executable, so the CLI launcher Orca ships sits next to it.
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'

export type CliAnswer<T = unknown> = { result: T; error?: undefined } | { result?: undefined; error: string }
export type CliRunner = (args: readonly string[], options?: { timeoutMs?: number }) => Promise<CliAnswer>

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

const LAUNCHER: Partial<Record<NodeJS.Platform, string>> = {
  darwin: join('bin', 'orca'),
  linux: join('bin', 'orca-ide'),
  win32: join('bin', 'orca.exe')
}

export function onPath(name: string, env: NodeJS.ProcessEnv): string | null {
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue
    const p = join(dir, name)
    if (isFile(p)) return p
  }
  return null
}

/**
 * Where the Orca CLI is, in order: `ORCA_CLI_COMMAND`; the launcher in the resources of the Orca
 * executable running this worker; the usual install places; on Linux `orca-ide` on PATH (never a
 * bare `orca`, which can be the GNOME screen reader); on Windows `orca.exe` on PATH.
 */
export function resolveCli(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath
): string | null {
  const fromEnv = env.ORCA_CLI_COMMAND
  if (fromEnv && isAbsolute(fromEnv) && isFile(fromEnv)) return fromEnv

  const launcher = LAUNCHER[platform]
  if (launcher) {
    const exeDir = dirname(execPath)
    const resources = platform === 'darwin' ? join(exeDir, '..', 'Resources') : join(exeDir, 'resources')
    const p = join(resources, launcher)
    if (isFile(p)) return p
  }

  const home = env.HOME || env.USERPROFILE || homedir()
  if (platform === 'darwin') {
    for (const app of ['/Applications/Orca.app', join(home, 'Applications', 'Orca.app')]) {
      const p = join(app, 'Contents', 'Resources', 'bin', 'orca')
      if (isFile(p)) return p
    }
    return null
  }
  if (platform === 'linux') return onPath('orca-ide', env)
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    const p = join(local, 'Programs', 'Orca', 'resources', 'bin', 'orca.exe')
    if (isFile(p)) return p
    return onPath('orca.exe', env)
  }
  return null
}

/** A child environment for the CLI: without the Node-mode flags Orca's worker runs under. */
function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env }
  delete out.ELECTRON_RUN_AS_NODE
  delete out.NODE_OPTIONS
  return out
}

/** At most `limit` CLI processes at once: each is a short-lived Orca process. */
function limiter(limit: number) {
  let running = 0
  const queue: (() => void)[] = []
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (running >= limit) await new Promise<void>((r) => queue.push(r))
    running++
    try {
      return await fn()
    } finally {
      running--
      queue.shift()?.()
    }
  }
}

export function cliRunner(command: string, env: NodeJS.ProcessEnv = process.env): CliRunner {
  const run = limiter(4)
  const cenv = childEnv(env)
  return (args, options) =>
    run(
      () =>
        new Promise<CliAnswer>((resolve) => {
          execFile(
            command,
            [...args, '--json'],
            { maxBuffer: 64 * 1024 * 1024, timeout: options?.timeoutMs ?? 30_000, env: cenv, windowsHide: true },
            (err, stdout, stderr) => {
              try {
                const parsed = JSON.parse(String(stdout)) as { ok?: boolean; result?: unknown; error?: { message?: string } }
                if (parsed.ok === false) return resolve({ error: parsed.error?.message || 'Orca CLI error' })
                resolve({ result: parsed.result })
              } catch {
                resolve({ error: (String(stderr || '') || err?.message || 'no output').trim().slice(0, 300) })
              }
            }
          )
        })
    )
}

// ---------------------------------------------------------------------------------------------
// Floating workspace chats: not listed by the CLI or the host API. Their ids are in Orca's local
// session store; read them (read-only) with the sqlite3 command line tool when it is installed.

/** Orca's user data folder on this computer. */
export function orcaUserDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  const home = env.HOME || env.USERPROFILE || homedir()
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'orca')
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'orca')
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'orca')
}

export const FLOATING_QUERY = `select t.session_id as id
  from agent_session_tabs t join agent_session_records r using(session_id)
  where json_extract(r.record_json,'$.location.workspaceId') = 'global-floating-terminal'
  order by t.position limit 20`

export type FloatingReader = () => Promise<string[] | null>

/** Null when it cannot run (no sqlite3, no store, a changed schema): the feature stays quiet. */
export function floatingReader(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): FloatingReader {
  const db = join(orcaUserDataDir(env, platform), 'agent-session-domain.db')
  const sqlite = platform === 'win32' ? onPath('sqlite3.exe', env) : onPath('sqlite3', env)
  return () =>
    new Promise((resolve) => {
      if (!sqlite || !existsSync(db)) return resolve(null)
      const uri = `file:${db.replace(/\\/g, '/')}?mode=ro`
      execFile(sqlite, ['-json', uri, FLOATING_QUERY], { timeout: 5000, windowsHide: true }, (err, stdout) => {
        if (err) return resolve(null)
        try {
          const rows = JSON.parse(String(stdout) || '[]') as { id?: unknown }[]
          resolve(rows.map((r) => r.id).filter((id): id is string => typeof id === 'string'))
        } catch {
          resolve(null)
        }
      })
    })
}
