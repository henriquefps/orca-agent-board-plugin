// The Windows environment fix: Orca's worker allowlist has no APPDATA/LOCALAPPDATA.
import { assert, test } from 'orca/testing'
import { childEnv, orcaUserDataDir } from './cli.ts'
import { clipboardEnv } from './clipboard.ts'
import { withWindowsVars } from './winenv.ts'

test('win32 without APPDATA and LOCALAPPDATA: both derived from USERPROFILE', () => {
  const env = childEnv({ PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\dev' }, 'win32')
  assert.equal(env.APPDATA, 'C:\\Users\\dev\\AppData\\Roaming')
  assert.equal(env.LOCALAPPDATA, 'C:\\Users\\dev\\AppData\\Local')
})

test('win32 without USERPROFILE: derived from HOMEDRIVE and HOMEPATH', () => {
  const env = childEnv({ HOMEDRIVE: 'D:', HOMEPATH: '\\Users\\dev' }, 'win32')
  assert.equal(env.APPDATA, 'D:\\Users\\dev\\AppData\\Roaming')
  assert.equal(env.LOCALAPPDATA, 'D:\\Users\\dev\\AppData\\Local')
})

test('win32: present values are kept', () => {
  const env = childEnv(
    { USERPROFILE: 'C:\\Users\\dev', APPDATA: 'E:\\Roam', LOCALAPPDATA: 'E:\\Loc', SystemRoot: 'D:\\Win', windir: 'D:\\Win' },
    'win32'
  )
  assert.equal(env.APPDATA, 'E:\\Roam')
  assert.equal(env.LOCALAPPDATA, 'E:\\Loc')
  assert.equal(env.SystemRoot, 'D:\\Win')
})

test('win32: SystemRoot defaults to windir, else C:\\Windows, only when missing', () => {
  assert.equal(withWindowsVars({ USERPROFILE: 'C:\\Users\\dev' }, 'win32').SystemRoot, 'C:\\Windows')
  assert.equal(withWindowsVars({ USERPROFILE: 'C:\\Users\\dev', windir: 'D:\\Win' }, 'win32').SystemRoot, 'D:\\Win')
})

test('non-Windows environments are unchanged except the Node-mode flags', () => {
  const env = { PATH: '/usr/bin', HOME: '/home/dev', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--x' }
  for (const platform of ['linux', 'darwin'] as const) {
    assert.deepEqual(childEnv(env, platform), { PATH: '/usr/bin', HOME: '/home/dev' })
    assert.equal(withWindowsVars(env, platform), env)
  }
})

test('the clipboard environment gets the same on win32 and none elsewhere', () => {
  const env = clipboardEnv({ USERPROFILE: 'C:\\Users\\dev', NODE_OPTIONS: '--x' }, 'win32')
  assert.equal(env.APPDATA, 'C:\\Users\\dev\\AppData\\Roaming')
  assert.equal(env.LOCALAPPDATA, 'C:\\Users\\dev\\AppData\\Local')
  assert.equal(env.NODE_OPTIONS, undefined)
  assert.equal(clipboardEnv({ USERPROFILE: 'C:\\Users\\dev' }, 'darwin').APPDATA, undefined)
})

test('orcaUserDataDir on win32 follows the same derivation', () => {
  assert.equal(orcaUserDataDir({ HOMEDRIVE: 'D:', HOMEPATH: '\\Users\\dev' }, 'win32').replace(/\//g, '\\'), 'D:\\Users\\dev\\AppData\\Roaming\\orca')
  assert.equal(orcaUserDataDir({ APPDATA: 'E:\\Roam' }, 'win32').replace(/\//g, '\\'), 'E:\\Roam\\orca')
})
