import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { resolveMaxUploadBytes } from '../config.mjs'
import { WORKSPACE_DIR } from './storage.mjs'

export const STAGING_DIR = path.join(WORKSPACE_DIR, 'upload-staging')

/** @deprecated Use DEFAULT_MAX_UPLOAD_MB from config.mjs */
export const DEFAULT_MAX_STAGE_MB = 32

export function resolveMaxStageBytes(env = process.env) {
  return resolveMaxUploadBytes(env)
}

export function sanitizeStageFilename(name) {
  const base = path.basename(String(name ?? '')).replace(/[^\w.\-()+ ]/g, '_')
  return base || 'upload'
}

/**
 * Writes picked file bytes to a unique path under CURLER_HOME. Returns the
 * absolute path for `@…` multipart parts — nothing is stored in the workspace JSON.
 */
export async function stageUploadedFile(buffer, originalName, maxBytes) {
  if (!buffer?.length) {
    throw new Error('No file was uploaded.')
  }
  if (buffer.length > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024))
    throw new Error(`File exceeds the ${mb} MB upload limit.`)
  }

  await fs.mkdir(STAGING_DIR, { recursive: true })

  const id = crypto.randomBytes(8).toString('hex')
  const filename = sanitizeStageFilename(originalName)
  const dest = path.resolve(STAGING_DIR, `${id}-${filename}`)

  if (!dest.startsWith(path.resolve(STAGING_DIR) + path.sep)) {
    throw new Error('Invalid staged file path.')
  }

  await fs.writeFile(dest, buffer)
  return dest
}
