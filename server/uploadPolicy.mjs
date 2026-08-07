import fs from 'node:fs'
import path from 'node:path'

import { resolveUploadPolicy } from '../config.mjs'
import { STAGING_DIR } from './staging.mjs'

let cachedPolicy = null

function resolveUploadPath(rawPath, cwd = process.cwd()) {
  return path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(cwd, rawPath)
}

function normalizeRoot(root) {
  try {
    return fs.realpathSync(root)
  } catch {
    return path.resolve(root)
  }
}

function stagingRoot() {
  try {
    if (fs.existsSync(STAGING_DIR)) return fs.realpathSync(STAGING_DIR)
  } catch {
    // Fall through to the resolved path when the directory does not exist yet.
  }
  return path.resolve(STAGING_DIR)
}

function buildPolicy(raw) {
  return {
    ...raw,
    allowRoots: raw.allowRoots.map(normalizeRoot),
    denyRoots: raw.denyRoots.map(normalizeRoot),
    stagingRoot: stagingRoot(),
  }
}

/** @returns {ReturnType<typeof resolveUploadPolicy> & { stagingRoot: string }} */
export function getUploadPolicy() {
  if (!cachedPolicy) cachedPolicy = buildPolicy(resolveUploadPolicy())
  return cachedPolicy
}

/** Test hook — call after changing process.env upload settings. */
export function resetUploadPolicy() {
  cachedPolicy = null
}

export function isPathUnderRoot(candidate, root) {
  const resolved = path.resolve(candidate)
  const resolvedRoot = path.resolve(root)
  if (resolved === resolvedRoot) return true
  return resolved.startsWith(resolvedRoot + path.sep)
}

/**
 * Resolve `@path` to an absolute path, collapsing symlinks when the target exists.
 */
export function canonicalUploadPath(rawPath, cwd = process.cwd()) {
  const resolved = resolveUploadPath(rawPath, cwd)
  try {
    return fs.realpathSync(resolved)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return resolved
    }
    throw error
  }
}

export function formatUploadLimitMb(maxBytes) {
  return Math.round(maxBytes / (1024 * 1024))
}

/**
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function checkPathPermission(canonicalPath, policy = getUploadPolicy()) {
  if (isPathUnderRoot(canonicalPath, policy.stagingRoot)) {
    return { ok: true }
  }

  for (const deny of policy.denyRoots) {
    if (isPathUnderRoot(canonicalPath, deny)) {
      return { ok: false, message: `File path not permitted: ${canonicalPath}` }
    }
  }

  if (policy.allowRoots.length > 0) {
    const allowed = policy.allowRoots.some((root) => isPathUnderRoot(canonicalPath, root))
    if (!allowed) {
      return { ok: false, message: `File path not permitted: ${canonicalPath}` }
    }
  }

  return { ok: true }
}

/** Shape exposed to the UI for advisory validation. */
export function uploadPolicyForClient(policy = getUploadPolicy()) {
  return {
    maxUploadMb: formatUploadLimitMb(policy.maxUploadBytes),
    hasAllowlist: policy.allowRoots.length > 0,
    allowRoots: policy.allowRoots,
    denyRoots: policy.denyRoots,
    stagingRoot: policy.stagingRoot,
  }
}
