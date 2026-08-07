import fs from 'node:fs'
import path from 'node:path'

import {
  canonicalUploadPath,
  checkPathPermission,
  formatUploadLimitMb,
  getUploadPolicy,
} from './uploadPolicy.mjs'

/** Everything after the leading `@` on a multipart file part value. */
export function filePathFromValue(value, textOnly = false) {
  if (textOnly || !value.startsWith('@')) return null
  const raw = value.slice(1)
  return raw.trim() ? raw : null
}

/** Resolve like curl: absolute paths as-is, relative paths from `cwd`. */
export function resolveUploadPath(rawPath, cwd = process.cwd()) {
  return path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(cwd, rawPath)
}

export function isRelativeUploadPath(rawPath) {
  return !path.isAbsolute(rawPath)
}

/**
 * @returns {{ ok: true, resolved: string, size: number } | { ok: false, message: string }}
 */
export function checkUploadPath(rawPath, cwd = process.cwd(), policy = getUploadPolicy()) {
  if (!rawPath?.trim()) {
    return { ok: false, message: 'Invalid file path after @.' }
  }

  if (rawPath === '-') {
    return { ok: false, message: 'curl stdin (@-) file parts are not supported.' }
  }

  const resolved = resolveUploadPath(rawPath, cwd)
  const canonical = canonicalUploadPath(rawPath, cwd)
  const permission = checkPathPermission(canonical, policy)
  if (!permission.ok) return permission

  try {
    const stat = fs.statSync(resolved)
    if (stat.isDirectory()) {
      return { ok: false, message: `"${rawPath}" is a directory, not a file.` }
    }
    if (!stat.isFile()) {
      return { ok: false, message: `"${rawPath}" is not a file.` }
    }

    const realPath = fs.realpathSync(resolved)
    const realPermission = checkPathPermission(realPath, policy)
    if (!realPermission.ok) return realPermission

    if (stat.size > policy.maxUploadBytes) {
      return {
        ok: false,
        message: `File exceeds the ${formatUploadLimitMb(policy.maxUploadBytes)} MB upload limit.`,
      }
    }

    return { ok: true, resolved: realPath, size: stat.size }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { ok: false, message: `File not found: ${rawPath}` }
    }
    if (error && typeof error === 'object' && error.code === 'EACCES') {
      return { ok: false, message: `Permission denied reading "${rawPath}".` }
    }
    return { ok: false, message: `Could not read "${rawPath}".` }
  }
}

/** @returns {{ data: Buffer, filename: string }} */
export function readUploadFile(rawPath, filenameHint, cwd = process.cwd(), policy = getUploadPolicy()) {
  if (rawPath === '-') {
    throw new Error('curl stdin (@-) file parts are not supported.')
  }
  const checked = checkUploadPath(rawPath, cwd, policy)
  if (!checked.ok) throw new Error(checked.message)
  const data = fs.readFileSync(checked.resolved)
  const filename = filenameHint?.trim() || path.basename(checked.resolved)
  return { data, filename }
}
