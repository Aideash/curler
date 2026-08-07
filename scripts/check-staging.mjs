import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHarness } from './harness.mjs'

const h = createHarness('staging')

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'curler-stage-'))
process.env.CURLER_HOME = home

const { stageUploadedFile, sanitizeStageFilename, STAGING_DIR, DEFAULT_MAX_STAGE_MB } =
  await import('../server/staging.mjs')

h.group('filename sanitization')

h.expect('basename only', sanitizeStageFilename('/etc/passwd'), 'passwd')
h.expect('unsafe chars', sanitizeStageFilename('my file (1).txt'), 'my file (1).txt')
h.expect('empty name', sanitizeStageFilename(''), 'upload')

h.group('stage upload')

const payload = Buffer.from('staged-bytes')
const stagedPath = await stageUploadedFile(payload, 'note.txt', DEFAULT_MAX_STAGE_MB * 1024 * 1024)

h.expect('returns an absolute path', path.isAbsolute(stagedPath), true)
h.expect('file lives under upload-staging', stagedPath.startsWith(STAGING_DIR), true)
h.expect('bytes were written', fs.readFileSync(stagedPath, 'utf8'), 'staged-bytes')

let oversizeFailed = false
try {
  await stageUploadedFile(Buffer.alloc(1024), 'tiny.txt', 512)
} catch (error) {
  oversizeFailed = /exceeds/i.test(error.message)
}
h.expect('oversize rejected', oversizeFailed, true)

fs.rmSync(home, { recursive: true, force: true })

const failures = h.summary()
process.exit(failures === 0 ? 0 : 1)
