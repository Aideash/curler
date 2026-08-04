import fs from 'node:fs/promises'
import path from 'node:path'

import { resolveWorkspaceHome } from '../config.mjs'

export const WORKSPACE_DIR = resolveWorkspaceHome()
export const WORKSPACE_FILE = path.join(WORKSPACE_DIR, 'workspace.json')
export const BACKUP_DIR = path.join(WORKSPACE_DIR, 'backups')

/** Keep enough history to cover a working day of periodic snapshots. */
const MAX_BACKUPS = 40
const BACKUP_INTERVAL_MS = 5 * 60 * 1000

/** Matches `workspace-2026-08-03T13-24-05-123Z[-shrunk].json` — no path segments. */
const BACKUP_NAME = /^workspace-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-shrunk)?\.json$/

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

function workspaceStats(contents) {
  try {
    const parsed = JSON.parse(contents)
    const collections = parsed.collections ?? []
    return {
      collectionCount: collections.length,
      requestCount: collections.reduce(
        (total, collection) => total + (collection.requests?.length ?? 0),
        0,
      ),
    }
  } catch {
    return { collectionCount: null, requestCount: null }
  }
}

async function writeSnapshot(contents, suffix = '') {
  await fs.mkdir(BACKUP_DIR, { recursive: true })

  for (;;) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    try {
      await fs.writeFile(path.join(BACKUP_DIR, `workspace-${stamp}${suffix}.json`), contents, {
        encoding: 'utf8',
        flag: 'wx',
      })
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
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

  await writeSnapshot(current, losingRequests ? '-shrunk' : '')
  await prune()
}

/**
 * Snapshots the live workspace before a restore so the user can undo. Skips when
 * the newest backup already holds the same contents.
 */
async function ensureCurrentBackedUp() {
  let current
  try {
    current = await fs.readFile(WORKSPACE_FILE, 'utf8')
  } catch {
    return
  }
  if (!current.trim()) return

  try {
    const names = (await fs.readdir(BACKUP_DIR))
      .filter((name) => name.startsWith('workspace-'))
      .sort()
    if (names.length) {
      const newest = await fs.readFile(path.join(BACKUP_DIR, names.at(-1)), 'utf8')
      if (newest === current) return
    }
  } catch {
    // If listing fails, snapshot anyway — restore should stay safe.
  }

  await writeSnapshot(current)
  await prune()
}

export async function listBackups() {
  try {
    const names = (await fs.readdir(BACKUP_DIR))
      .filter((name) => BACKUP_NAME.test(name))
      .sort()
      .reverse()

    return Promise.all(
      names.map(async (name) => {
        const file = path.join(BACKUP_DIR, name)
        const [stat, contents] = await Promise.all([fs.stat(file), fs.readFile(file, 'utf8')])
        const stats = workspaceStats(contents)
        return {
          name,
          createdAt: stat.mtime.toISOString(),
          shrunk: name.includes('-shrunk'),
          ...stats,
        }
      }),
    )
  } catch {
    return []
  }
}

export async function restoreBackup(name) {
  if (!BACKUP_NAME.test(name)) {
    throw new Error(`Not a workspace backup: ${name}`)
  }

  const backupPath = path.join(BACKUP_DIR, name)
  let restored
  try {
    restored = await fs.readFile(backupPath, 'utf8')
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error
    if (error.code === 'ENOENT') throw new Error(`Backup not found: ${name}`)
    throw error
  }
  if (!restored.trim()) throw new Error(`Backup is empty: ${name}`)

  await ensureCurrentBackedUp()

  const temporary = `${WORKSPACE_FILE}.tmp`
  await fs.writeFile(temporary, restored, 'utf8')
  await fs.rename(temporary, WORKSPACE_FILE)
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
