import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHarness, loadModules } from './harness.mjs'
import { checkUploadPath, resolveUploadPath } from '../server/paths.mjs'
import { encodeMultipartBody } from '../server/multipart.mjs'

const { modules, close } = await loadModules(['/src/lib/multipart.ts', '/src/lib/vars.ts'])
const { validateMultipartPartValue, filePathFromPartValue, isAbsolutePath } = modules

const h = createHarness('multipart')

h.group('path syntax')

h.expect('file path extraction', filePathFromPartValue('@/tmp/x'), '/tmp/x')
h.expect('text parts are not paths', filePathFromPartValue('hello'), null)
h.expect(
  'bare @ is invalid',
  validateMultipartPartValue('@', {})?.message,
  'Invalid file path after @.',
)

h.expect('unix absolute', isAbsolutePath('/tmp/x'), true)
h.expect('windows absolute', isAbsolutePath('C:\\Users\\me'), true)
h.expect('relative', isAbsolutePath('tmp/x'), false)

h.expect(
  'relative path is advisory',
  validateMultipartPartValue('@file.txt', {})?.message,
  'Relative path — resolved from server cwd at send time.',
)

h.expect(
  'vars substitute before relative check',
  validateMultipartPartValue('@${DIR}/file.txt', { DIR: 'tmp' })?.message,
  'Relative path — resolved from server cwd at send time.',
)

h.expect(
  'absolute after substitution has no local warning',
  validateMultipartPartValue('@/${ROOT}/file.txt', { ROOT: '/var/data' }),
  null,
)

h.expect(
  'allowlist advisory warning',
  validateMultipartPartValue('@/etc/passwd', {}, false, {
    maxUploadMb: 32,
    hasAllowlist: true,
    allowRoots: ['/tmp/uploads'],
    denyRoots: [],
    stagingRoot: '/home/user/.curler/upload-staging',
  })?.message,
  'File path not permitted: /etc/passwd',
)

h.expect(
  'staging paths bypass allowlist in the UI',
  validateMultipartPartValue('@/home/user/.curler/upload-staging/abc-note.txt', {}, false, {
    maxUploadMb: 32,
    hasAllowlist: true,
    allowRoots: ['/tmp/uploads'],
    denyRoots: [],
    stagingRoot: '/home/user/.curler/upload-staging',
  }),
  null,
)

h.expect(
  'form-string skips path validation',
  validateMultipartPartValue('@looks-like-file', {}, true),
  null,
)

h.expect(
  'stdin paths are flagged',
  validateMultipartPartValue('@-', {})?.message,
  'Stdin (@-) file parts are not supported.',
)

const encodedTextOnly = encodeMultipartBody([{ name: 'note', value: '@literal', textOnly: true }])
h.expect(
  'form-string parts send literal @ values',
  encodedTextOnly.buffer.includes(Buffer.from('@literal')),
  true,
)

h.group('server path resolution')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curler-upload-'))
const file = path.join(dir, 'payload.txt')
fs.writeFileSync(file, 'file-bytes')

h.expect('absolute file resolves', checkUploadPath(file).ok, true)
h.expect('missing file fails', checkUploadPath(path.join(dir, 'nope.txt')).ok, false)
h.expect('relative resolves from cwd', resolveUploadPath('payload.txt', dir), file)

const encoded = encodeMultipartBody([
  { name: 'name', value: 'bob' },
  { name: 'file', value: `@${file}` },
])
h.expect('encoder accepts a file part', encoded.buffer.includes(Buffer.from('file-bytes')), true)
h.expect(
  'encoder sets multipart content-type',
  encoded.contentType.startsWith('multipart/form-data; boundary='),
  true,
)

fs.rmSync(dir, { recursive: true, force: true })

const failures = h.summary()
await close()
process.exit(failures === 0 ? 0 : 1)
