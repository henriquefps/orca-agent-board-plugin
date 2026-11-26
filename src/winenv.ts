// Orca starts plugin workers with a short environment allowlist that has no APPDATA, LOCALAPPDATA or
// SystemRoot on Windows, and the Windows Orca CLI needs APPDATA to find its runtime metadata.
import { homedir } from 'node:os'

/** The user's home folder on Windows: USERPROFILE, else HOMEDRIVE+HOMEPATH, else the OS answer. */
export function windowsHome(env: NodeJS.ProcessEnv): string {
  if (env.USERPROFILE) return env.USERPROFILE
  if (env.HOMEDRIVE && env.HOMEPATH) return env.HOMEDRIVE + env.HOMEPATH
  return homedir()
}

/** Adds APPDATA, LOCALAPPDATA and SystemRoot/windir when missing, on win32 only; never overrides a present value. */
export function withWindowsVars(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  if (platform !== 'win32') return env
  const out = { ...env }
  const home = windowsHome(env).replace(/[\\/]+$/, '')
  if (!out.APPDATA) out.APPDATA = `${home}\\AppData\\Roaming`
  if (!out.LOCALAPPDATA) out.LOCALAPPDATA = `${home}\\AppData\\Local`
  if (!out.SystemRoot && !out.SYSTEMROOT) {
    if (out.windir || out.WINDIR) out.SystemRoot = out.windir || out.WINDIR
    else out.SystemRoot = 'C:\\Windows'
  }
  if (!out.windir && !out.WINDIR) out.windir = out.SystemRoot || out.SYSTEMROOT
  return out
}
