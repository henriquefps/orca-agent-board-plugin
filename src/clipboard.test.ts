// The clipboard writer with fake tools: which tool per platform, the text on stdin only.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { clipboardEnv, clipboardTools, writeClipboard, type ClipboardTool, type Spawner } from './clipboard.ts'

const SESSION = 'orca_session_id:0b1c2d3e-4f50-4617-8a9b-c0d1e2f30415'

/** A PATH lookup that finds only `present`, at `/fake/bin/<name>`. */
const findOnly = (...present: string[]) => (name: string) => (present.includes(name) ? `/fake/bin/${name}` : null)

test('the tool per platform: pbcopy, clip.exe, then wl-copy, xclip, xsel on Linux', () => {
  assert.deepEqual(clipboardTools('darwin', {}, findOnly('pbcopy')), [{ name: 'pbcopy', command: '/fake/bin/pbcopy', args: [] }])
  assert.deepEqual(clipboardTools('win32', {}, findOnly('clip.exe')), [{ name: 'clip.exe', command: '/fake/bin/clip.exe', args: [] }])
  assert.deepEqual(
    clipboardTools('linux', {}, findOnly('wl-copy', 'xclip', 'xsel')).map((t) => [t.name, ...t.args]),
    [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']]
  )
  // Only those on PATH, in order.
  assert.deepEqual(clipboardTools('linux', {}, findOnly('xsel')).map((t) => t.name), ['xsel'])
  assert.deepEqual(clipboardTools('linux', {}, findOnly()), [])
  // Never another platform's tool.
  assert.deepEqual(clipboardTools('darwin', {}, findOnly('wl-copy', 'clip.exe')), [])
})

type Spawned = { command: string; args: string[]; shell: unknown; stdin: string[] }

/** A fake spawn: records each run and exits with `codes[name]` (0 by default). */
function fakeSpawn(codes: Record<string, number> = {}): { spawn: Spawner; runs: Spawned[] } {
  const runs: Spawned[] = []
  const spawn: Spawner = (command, args, options) => {
    const run: Spawned = { command, args, shell: options.shell, stdin: [] }
    runs.push(run)
    const name = command.split('/').pop() ?? command
    let onExit: ((code: number | null, signal: string | null) => void) | null = null
    return {
      stdin: {
        end(chunk) {
          run.stdin.push(chunk)
          setTimeout(() => onExit?.(codes[name] ?? 0, null), 0)
        },
        on: () => undefined
      },
      stderr: { on: (_e, fn) => (codes[name] ? fn('cannot open display') : undefined) },
      on(event: 'error' | 'exit', fn: never) {
        if (event === 'exit') onExit = fn
        return undefined
      }
    }
  }
  return { spawn, runs }
}

const tools = (...names: string[]): ClipboardTool[] =>
  clipboardTools('linux', {}, findOnly(...names))

test('the text goes on stdin, never in the arguments, and no shell runs', async () => {
  const { spawn, runs } = fakeSpawn()
  const r = await writeClipboard(SESSION, { platform: 'darwin', env: {}, tools: clipboardTools('darwin', {}, findOnly('pbcopy')), spawn })
  assert.deepEqual(r, { ok: true, tool: 'pbcopy' })
  assert.equal(runs.length, 1)
  assert.deepEqual(runs[0]?.stdin, [SESSION])
  assert.deepEqual(runs[0]?.args, [])
  assert.equal(runs[0]?.shell, false)
  assert.ok(!runs.some((x) => x.args.some((a) => a.includes('orca_session_id'))))
})

test('Linux: a failing tool falls through to the next one', async () => {
  const { spawn, runs } = fakeSpawn({ 'wl-copy': 1 })
  const r = await writeClipboard('/home/dev/code/web-shop', { platform: 'linux', env: {}, tools: tools('wl-copy', 'xclip', 'xsel'), spawn })
  assert.deepEqual(r, { ok: true, tool: 'xclip' })
  assert.deepEqual(runs.map((x) => [x.command, ...x.args]), [['/fake/bin/wl-copy'], ['/fake/bin/xclip', '-selection', 'clipboard']])
  assert.deepEqual(runs[1]?.stdin, ['/home/dev/code/web-shop'])
})

test('no tool works: the reason names each one', async () => {
  const { spawn } = fakeSpawn({ 'wl-copy': 1, xsel: 1 })
  const r = await writeClipboard(SESSION, { platform: 'linux', env: {}, tools: tools('wl-copy', 'xsel'), spawn })
  assert.equal(r.ok, false)
  assert.match(!r.ok ? r.error : '', /wl-copy: cannot open display; xsel: cannot open display/)
  const none = await writeClipboard(SESSION, { platform: 'linux', env: {}, tools: [], spawn })
  assert.deepEqual(none, { ok: false, error: 'no clipboard tool on this computer (looked for wl-copy, xclip, xsel)' })
})

test('a real tool process gets the text on stdin', async () => {
  // A stand-in clipboard tool: a script that writes its stdin and its arguments to files.
  const dir = mkdtempSync(join(tmpdir(), 'agent-board-clip-'))
  try {
    const tool = join(dir, 'xsel')
    writeFileSync(tool, `#!/bin/sh\ncat > "${dir}/stdin"\nprintf '%s\\n' "$@" > "${dir}/argv"\n`)
    chmodSync(tool, 0o755)
    const found = clipboardTools('linux', { PATH: dir })
    assert.deepEqual(found.map((t) => t.command), [tool])
    const r = await writeClipboard(SESSION, { platform: 'linux', env: { PATH: `${dir}:/usr/bin:/bin` }, tools: found })
    assert.deepEqual(r, { ok: true, tool: 'xsel' })
    assert.equal(readFileSync(join(dir, 'stdin'), 'utf8'), SESSION)
    assert.equal(readFileSync(join(dir, 'argv'), 'utf8'), '--clipboard\n--input\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Linux: the worker’s short environment gets the desktop display filled in', () => {
  const fs = {
    exists: (p: string) => p === '/run/user/1000',
    list: (d: string) => (d === '/run/user/1000' ? ['bus', 'wayland-1', 'wayland-1.lock', 'wayland-0'] : d === '/tmp/.X11-unix' ? ['X0'] : [])
  }
  const out = clipboardEnv({ PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1' }, 'linux', 1000, fs)
  assert.equal(out.XDG_RUNTIME_DIR, '/run/user/1000')
  assert.equal(out.WAYLAND_DISPLAY, 'wayland-0')
  assert.equal(out.DISPLAY, ':0')
  assert.equal(out.ELECTRON_RUN_AS_NODE, undefined)
  // What the worker was given wins.
  const given = clipboardEnv({ XDG_RUNTIME_DIR: '/run/user/1000', WAYLAND_DISPLAY: 'wayland-1', DISPLAY: ':1' }, 'linux', 1000, fs)
  assert.deepEqual([given.WAYLAND_DISPLAY, given.DISPLAY], ['wayland-1', ':1'])
  // Other platforms keep their environment.
  assert.equal(clipboardEnv({ PATH: '/usr/bin' }, 'darwin', 501, fs).DISPLAY, undefined)
})
