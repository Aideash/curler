import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHarness } from './harness.mjs'

const h = createHarness('storage')

/**
 * Pointed at a scratch directory through the same CURLER_HOME the app honours,
 * so these checks cannot touch a real workspace. Set before the import, because
 * storage resolves its paths once at module load.
 *
 * These checks exist because this module lost a workspace once.
 */
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'curler-home-'))
process.env.CURLER_HOME = home

const { readWorkspace, writeWorkspace, listBackups, restoreBackup, WORKSPACE_FILE, BACKUP_DIR } =
  await import('../server/storage.mjs')

const workspaceWith = (names) =>
  JSON.stringify({
    collections: [
      {
        id: 'c1',
        name: 'My requests',
        variables: [],
        requests: names.map((name) => ({ id: name, name })),
      },
    ],
    environments: [],
    activeEnvironmentId: null,
    globals: [],
  })

const backups = async () => {
  try {
    return (await fs.readdir(BACKUP_DIR)).filter((name) => name.startsWith('workspace-')).sort()
  } catch {
    return []
  }
}

// -- Reading ----------------------------------------------------------------

h.group('reading')

h.expect('a missing workspace reads as null, not an error', await readWorkspace(), null)

await writeWorkspace(workspaceWith(['one', 'two']))
h.expect('what was written comes back', await readWorkspace(), workspaceWith(['one', 'two']))
h.expect('CURLER_HOME redirected the workspace', WORKSPACE_FILE.startsWith(home), true)

h.expect(
  'no temp file is left behind',
  await backups()
    .then(() => fs.readdir(path.dirname(WORKSPACE_FILE)))
    .then((names) => names.includes('workspace.json.tmp')),
  false,
)

// -- Backups ----------------------------------------------------------------

h.group('backups')

h.expect('the first write has nothing to back up', (await backups()).length, 0)

// An identical write is not a change, so it should not consume history.
await writeWorkspace(workspaceWith(['one', 'two']))
h.expect('an identical write makes no backup', (await backups()).length, 0)

// The first real change since startup is always snapshotted, so an existing
// workspace is captured before anything in this session touches it.
await writeWorkspace(workspaceWith(['one', 'two', 'three']))
const firstChange = await backups()
h.expect('the first change is snapshotted', firstChange.length, 1)
h.expect(
  'and it holds the state before that change',
  JSON.parse(
    await fs.readFile(path.join(BACKUP_DIR, firstChange[0]), 'utf8'),
  ).collections[0].requests.map((request) => request.id),
  ['one', 'two'],
)

// A further growth within the interval should not consume history.
await writeWorkspace(workspaceWith(['one', 'two', 'three', 'four']))
h.expect('a growing workspace does not spam backups', (await backups()).length, 1)

// Losing a request is the case worth catching, whatever the interval says.
await writeWorkspace(workspaceWith(['one']))
const afterLoss = await backups()
h.expect('losing requests forces a backup', afterLoss.length, 2)
h.expect('and the backup is marked', afterLoss.at(-1).includes('-shrunk'), true)

const saved = await fs.readFile(path.join(BACKUP_DIR, afterLoss.at(-1)), 'utf8')
h.expect(
  'the backup holds what was there before, not after',
  JSON.parse(saved).collections[0].requests.map((request) => request.id),
  ['one', 'two', 'three', 'four'],
)
h.expect(
  'and the live file holds the new version',
  JSON.parse(await readWorkspace()).collections[0].requests.length,
  1,
)

// The exact shape of the accident: everything replaced by an empty default.
await writeWorkspace(workspaceWith([]))
const afterWipe = await backups()
h.expect('a full wipe is backed up too', afterWipe.length, 3)
h.expect(
  'and the last good workspace is recoverable',
  JSON.parse(await fs.readFile(path.join(BACKUP_DIR, afterWipe.at(-1)), 'utf8')).collections[0]
    .requests.length,
  1,
)

// -- Pruning ----------------------------------------------------------------

h.group('pruning')

for (let i = 0; i < 45; i += 1) {
  await writeWorkspace(workspaceWith(Array.from({ length: 45 - i }, (_, n) => `r${n}`)))
}
const pruned = await backups()
h.expect('history is capped', pruned.length <= 40, true)
h.expect('and the newest are the ones kept', pruned.at(-1) > pruned[0], true)

// -- Restore ----------------------------------------------------------------

h.group('restore')

await fs.rm(home, { recursive: true, force: true })
await fs.mkdir(path.dirname(WORKSPACE_FILE), { recursive: true })

await writeWorkspace(workspaceWith(['alpha', 'beta']))
await writeWorkspace(workspaceWith(['alpha']))
const beforeRestore = await backups()
h.expect('restore lists backups newest first', (await listBackups())[0].name, beforeRestore.at(-1))

const target = beforeRestore.at(-1)
await restoreBackup(target)
h.expect(
  'restore replaces the live workspace',
  JSON.parse(await readWorkspace()).collections[0].requests.map((request) => request.id),
  ['alpha', 'beta'],
)
h.expect(
  'restore keeps newer backups on disk',
  (await backups()).includes(beforeRestore.at(-1)),
  true,
)
h.expect(
  'restore snapshots the pre-restore workspace first',
  (await backups()).length >= beforeRestore.length + 1,
  true,
)

await fs.rm(home, { recursive: true, force: true })
process.exit(h.summary() === 0 ? 0 : 1)
