import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHarness } from './harness.mjs'
import {
  DEFAULT_MAX_UPLOAD_MB,
  MAX_MULTIPART_FILE_PARTS,
  parseUploadRootList,
  resolveMaxUploadBytes,
  resolveUploadPolicy,
} from '../config.mjs'

const h = createHarness('upload policy')

h.group('config parsing')

h.expect('default upload cap', resolveMaxUploadBytes({}), DEFAULT_MAX_UPLOAD_MB * 1024 * 1024)
h.expect(
  'CURLER_MAX_UPLOAD_MB is honoured',
  resolveMaxUploadBytes({ CURLER_MAX_UPLOAD_MB: '8' }),
  8 * 1024 * 1024,
)
h.expect(
  'bad upload cap is rejected',
  (() => {
    try {
      resolveMaxUploadBytes({ CURLER_MAX_UPLOAD_MB: 'nope' })
      return false
    } catch {
      return true
    }
  })(),
  true,
)

h.expect(
  'tilde roots expand',
  parseUploadRootList('~/uploads', {})[0],
  path.join(os.homedir(), 'uploads'),
)
h.expect('comma-separated roots', parseUploadRootList('/tmp/a, /tmp/b', {}).length, 2)

h.expect('policy carries part cap', resolveUploadPolicy({}).maxFileParts, MAX_MULTIPART_FILE_PARTS)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curler-policy-'))
const allowed = path.join(dir, 'allowed')
const denied = path.join(dir, 'denied')
const secret = path.join(dir, 'secret.txt')
const allowedFile = path.join(allowed, 'ok.txt')
fs.mkdirSync(allowed)
fs.mkdirSync(denied)
fs.writeFileSync(secret, 'secret')
fs.writeFileSync(allowedFile, 'ok')

process.env.CURLER_UPLOAD_ALLOW = allowed
process.env.CURLER_UPLOAD_DENY = denied
process.env.CURLER_MAX_UPLOAD_MB = '1'

const { resetUploadPolicy, checkPathPermission, canonicalUploadPath, getUploadPolicy } =
  await import('../server/uploadPolicy.mjs')
const { checkUploadPath, readUploadFile } = await import('../server/paths.mjs')
const { encodeMultipartBody } = await import('../server/multipart.mjs')

resetUploadPolicy()
const policy = getUploadPolicy()

h.group('allow and deny')

h.expect(
  'allowed file passes',
  checkPathPermission(canonicalUploadPath(allowedFile), policy).ok,
  true,
)
h.expect(
  'path outside allowlist is blocked',
  checkPathPermission(canonicalUploadPath(secret), policy).ok,
  false,
)
h.expect(
  'deny wins over allow',
  checkPathPermission(canonicalUploadPath(path.join(denied, 'blocked.txt')), policy).ok,
  false,
)

h.group('symlink escape')

const link = path.join(allowed, 'escape')
fs.symlinkSync(secret, link)
resetUploadPolicy()

h.expect(
  'symlink target outside allowlist is blocked',
  checkUploadPath(link, dir, getUploadPolicy()).ok,
  false,
)

h.group('size caps')

const bigFile = path.join(allowed, 'big.bin')
fs.writeFileSync(bigFile, Buffer.alloc(2 * 1024 * 1024))

resetUploadPolicy()
const oversize = checkUploadPath(bigFile, dir, getUploadPolicy())
h.expect('oversize file is rejected before read', oversize.ok, false)
h.expect('oversize message names the cap', /upload limit/i.test(oversize.message ?? ''), true)

let readFailed = false
try {
  readUploadFile(bigFile, undefined, dir, getUploadPolicy())
} catch (error) {
  readFailed = /upload limit/i.test(error.message)
}
h.expect('readUploadFile rejects oversize files', readFailed, true)

let totalFailed = false
try {
  encodeMultipartBody(
    [
      { name: 'a', value: `@${allowedFile}` },
      { name: 'b', value: `@${bigFile}` },
    ],
    { policy: getUploadPolicy() },
  )
} catch (error) {
  totalFailed = /upload limit/i.test(error.message)
}
h.expect('total multipart payload cap is enforced', totalFailed, true)

h.group('part count')

let tooManyFailed = false
try {
  encodeMultipartBody(
    Array.from({ length: policy.maxFileParts + 1 }, (_, index) => ({
      name: `f${index}`,
      value: `@${allowedFile}`,
    })),
    { policy },
  )
} catch (error) {
  tooManyFailed = /too many file parts/i.test(error.message)
}
h.expect('too many file parts are rejected early', tooManyFailed, true)

fs.rmSync(dir, { recursive: true, force: true })
delete process.env.CURLER_UPLOAD_ALLOW
delete process.env.CURLER_UPLOAD_DENY
delete process.env.CURLER_MAX_UPLOAD_MB
resetUploadPolicy()

const failures = h.summary()
process.exit(failures === 0 ? 0 : 1)
