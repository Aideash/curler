import fs from 'node:fs/promises'
import path from 'node:path'

import { resolveWorkspaceHome } from '../config.mjs'

export const WORKSPACE_DIR = resolveWorkspaceHome()
export const WORKSPACE_FILE = path.join(WORKSPACE_DIR, 'workspace.json')
export const BACKUP_DIR = path.join(WORKSPACE_DIR, 'backups')

/** Keep enough history to cover a working day of periodic snapshots. */
const MAX_BACKUPS = 40
const BACKUP_INTERVAL_MS = 5 * 60 * 1000

/** Returns null when there is no workspace yet, which is not an error. */
export async function readWorkspace() {
  try {
    return await fs.readFile(WORKSPACE_FILE, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error(`Could not read ${WORKSPACE_FILE}: ${error.message}`, { cause: error })
  }
}

function countRequests(contents) {
  try {
    const parsed = JSON.parse(contents)
    return (parsed.collections ?? []).reduce(
      (total, collection) => total + (collection.requests?.length ?? 0),
      0,
    )
  } catch {
    return null
  }
}

async function newestBackupAge() {
  try {
    const names = (await fs.readdir(BACKUP_DIR))
      .filter((name) => name.startsWith('workspace-'))
      .sort()
    if (!names.length) return Infinity
    const newest = await fs.stat(path.join(BACKUP_DIR, names.at(-1)))
    return Date.now() - newest.mtimeMs
  } catch {
    return Infinity
  }
}

async function prune() {
  try {
    const names = (await fs.readdir(BACKUP_DIR))
      .filter((name) => name.startsWith('workspace-'))
      .sort()
    for (const stale of names.slice(0, -MAX_BACKUPS)) {
      await fs.rm(path.join(BACKUP_DIR, stale), { force: true })
    }
  } catch {
    // Pruning is housekeeping. Failing it must never fail the save.
  }
}

/**
 * Snapshots the current file before it is replaced.
 *
 * Saves are debounced but still frequent, so snapshotting every one would churn
 * through the history in minutes. Instead this keeps a periodic trail, and
 * always snapshots immediately when the incoming workspace holds fewer requests
 * than the one on disk -- the case where you would actually want it back.
 */
async function backup(incoming) {
  let current
  try {
    current = await fs.readFile(WORKSPACE_FILE, 'utf8')
  } catch {
    return
  }
  if (!current.trim() || current === incoming) return

  const before = countRequests(current)
  const after = countRequests(incoming)
  const losingRequests = before !== null && after !== null && after < before

  if (!losingRequests && (await newestBackupAge()) < BACKUP_INTERVAL_MS) return

  const suffix = losingRequests ? '-shrunk' : ''
  await fs.mkdir(BACKUP_DIR, { recursive: true })

  /*
   * The name carries a millisecond-resolution timestamp, so two snapshots taken
   * inside one millisecond would resolve to the same path and the second would
   * overwrite the first. Only shrinking saves can arrive that fast, since they
   * bypass the interval -- which makes the lost one exactly the snapshot worth
   * keeping. `wx` refuses to clobber, and waiting for the clock to move keeps
   * the names both unique and sortable, which is what prune() orders by.
   */
  for (;;) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    try {
      await fs.writeFile(path.join(BACKUP_DIR, `workspace-${stamp}${suffix}.json`), current, {
        encoding: 'utf8',
        flag: 'wx',
      })
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
  }

  await prune()
}

export async function writeWorkspace(contents) {
  await fs.mkdir(WORKSPACE_DIR, { recursive: true })

  try {
    await backup(contents)
  } catch {
    // Never let a backup problem block the save the user asked for.
  }

  // Write then rename, so an interrupted save cannot truncate the workspace.
  const temporary = `${WORKSPACE_FILE}.tmp`
  await fs.writeFile(temporary, contents, 'utf8')
  await fs.rename(temporary, WORKSPACE_FILE)
}
