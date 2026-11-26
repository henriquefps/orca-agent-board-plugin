// Copying text from the worker. The plugin host API has no clipboard, so the worker writes it with
// the platform's own tool: pbcopy (macOS), clip.exe (Windows), wl-copy, xclip or xsel (Linux),
// only those found on PATH, in that order. The text always goes on stdin, never in argv, and no
// shell runs.
import { spawn as nodeSpawn } from 'node:child_process'
import { withWindowsVars } from './winenv.ts'
import { existsSync, readdirSync } from 'node:fs'
import { onPath } from './cli.ts'

export type ClipboardTool = { name: string; command: string; args: string[] }

/** The platform's clipboard tools, in the order to try them, with their arguments. */
export const CLIPBOARD_TOOLS: Partial<Record<NodeJS.Platform, readonly { name: string; args: string[] }[]>> = {
  darwin: [{ name: 'pbcopy', args: [] }],
  win32: [{ name: 'clip.exe', args: [] }],
  linux: [
    { name: 'wl-copy', args: [] },
    { name: 'xclip', args: ['-selection', 'clipboard'] },
    { name: 'xsel', args: ['--clipboard', '--input'] }
  ]
}

/** The tools of `CLIPBOARD_TOOLS[platform]` that are on PATH, as absolute paths. */
export function clipboardTools(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  find: (name: string, env: NodeJS.ProcessEnv) => string | null = onPath
): ClipboardTool[] {
  const out: ClipboardTool[] = []
  for (const t of CLIPBOARD_TOOLS[platform] ?? []) {
    const command = find(t.name, env)
    if (command) out.push({ name: t.name, command, args: [...t.args] })
  }
  return out
}

/**
 * Orca starts workers with a short environment (PATH, HOME, …): on Linux, fill in the display the
 * desktop session uses when the worker was not given it, so wl-copy and xclip can reach it.
 */
export function clipboardEnv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  uid: number | undefined = process.getuid?.(),
  fs: { exists: (p: string) => boolean; list: (dir: string) => string[] } = {
    exists: existsSync,
    list: (dir) => {
      try {
        return readdirSync(dir)
      } catch {
        return []
      }
    }
  }
): NodeJS.ProcessEnv {
  const out = { ...withWindowsVars(env, platform) }
  delete out.ELECTRON_RUN_AS_NODE
  delete out.NODE_OPTIONS
  if (platform !== 'linux') return out
  if (!out.XDG_RUNTIME_DIR && uid !== undefined && fs.exists(`/run/user/${uid}`)) out.XDG_RUNTIME_DIR = `/run/user/${uid}`
  if (!out.WAYLAND_DISPLAY && out.XDG_RUNTIME_DIR) {
    const socket = fs.list(out.XDG_RUNTIME_DIR).filter((n) => /^wayland-\d+$/.test(n)).sort()[0]
    if (socket) out.WAYLAND_DISPLAY = socket
  }
  if (!out.DISPLAY) {
    const x = fs.list('/tmp/.X11-unix').filter((n) => /^X\d+$/.test(n)).sort()[0]
    if (x) out.DISPLAY = `:${x.slice(1)}`
  }
  return out
}

export type CopyAnswer = { ok: true; tool: string } | { ok: false; error: string }

/** What `spawn` must offer: `child_process.spawn`, or a fake in tests. */
export type Spawner = (
  command: string,
  args: string[],
  options: { stdio: ['pipe', 'ignore', 'pipe']; env: NodeJS.ProcessEnv; windowsHide: boolean; shell: false }
) => {
  stdin: { end(chunk: string, encoding: 'utf8'): void; on(event: 'error', fn: (e: Error) => void): unknown } | null
  stderr: { on(event: 'data', fn: (chunk: unknown) => void): unknown; destroy?(): void } | null
  on(event: 'error', fn: (e: Error) => void): unknown
  on(event: 'exit', fn: (code: number | null, signal: string | null) => void): unknown
  kill?(): unknown
}

/** Runs one tool with the text on stdin. Waits for its exit, not for its pipes: wl-copy and xclip leave a child that serves the clipboard. */
export function runTool(tool: ClipboardTool, text: string, env: NodeJS.ProcessEnv, spawn: Spawner, timeoutMs = 5_000): Promise<string | null> {
  return new Promise((resolve) => {
    let err = ''
    let done = false
    const finish = (e: string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      child?.stderr?.destroy?.()
      resolve(e)
    }
    let child: ReturnType<Spawner> | null = null
    const timer = setTimeout(() => {
      child?.kill?.()
      finish(`${tool.name} timed out`)
    }, timeoutMs)
    try {
      child = spawn(tool.command, tool.args, { stdio: ['pipe', 'ignore', 'pipe'], env, windowsHide: true, shell: false })
    } catch (e) {
      return finish(`${tool.name}: ${(e as Error).message}`)
    }
    child.on('error', (e) => finish(`${tool.name}: ${e.message}`))
    child.on('exit', (code) => finish(code === 0 ? null : `${tool.name}: ${err.trim().slice(0, 200) || `exit ${code}`}`))
    child.stderr?.on('data', (c) => {
      err += String(c)
    })
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(text, 'utf8')
  })
}

/** Tries each tool in turn until one copies the text. */
export async function writeClipboard(
  text: string,
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; tools?: ClipboardTool[]; spawn?: Spawner } = {}
): Promise<CopyAnswer> {
  const platform = opts.platform ?? process.platform
  const env = opts.env ?? process.env
  const tools = opts.tools ?? clipboardTools(platform, env)
  if (!tools.length) {
    const names = (CLIPBOARD_TOOLS[platform] ?? []).map((t) => t.name)
    return { ok: false, error: names.length ? `no clipboard tool on this computer (looked for ${names.join(', ')})` : `no clipboard tool for ${platform}` }
  }
  const childEnv = clipboardEnv(env, platform)
  const spawn = opts.spawn ?? (nodeSpawn as unknown as Spawner)
  const errors: string[] = []
  for (const t of tools) {
    const e = await runTool(t, text, childEnv, spawn)
    if (!e) return { ok: true, tool: t.name }
    errors.push(e)
  }
  return { ok: false, error: errors.join('; ') }
}
