import os from 'node:os'
import path from 'node:path'

/**
 * Settings shared by the API server, the Vite dev server and the dev runner.
 *
 * They live in one place because the Vite proxy target and the port the API
 * server actually binds have to agree: split them across two files and the day
 * one moves, the other silently proxies into nothing.
 *
 * Values are read from the environment. `npm run dev` and `npm start` load a
 * `.env` at the project root, and Vite picks the same file up through `loadEnv`.
 */

export const DEFAULT_API_PORT = 5174
export const DEFAULT_UI_PORT = 5173

/**
 * @param {Record<string, string | undefined>} env
 * @param {string[]} names Accepted spellings, most preferred first.
 * @param {number} fallback
 */
function readPort(env, names, fallback) {
  for (const name of names) {
    const raw = env[name]
    if (raw === undefined || raw.trim() === '') continue

    const value = Number(raw.trim())
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      // A bad value must not be shrugged off: Number('5174;') is NaN, and
      // listening on NaN quietly binds a random port instead of failing.
      throw new Error(
        `${name} must be a whole port number between 1 and 65535, not "${raw}". ` +
          'Check your .env — values there need no quotes and no trailing semicolon.',
      )
    }
    return value
  }
  return fallback
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ api: number, ui: number }}
 */
export function resolvePorts(env = process.env) {
  return {
    // PORT is the older spelling, kept so existing shell habits keep working.
    api: readPort(env, ['API_PORT', 'PORT'], DEFAULT_API_PORT),
    ui: readPort(env, ['UI_PORT'], DEFAULT_UI_PORT),
  }
}

/**
 * Where collections, environments and backups are kept.
 *
 * `CURLER_HOME` gives you a second, isolated set of everything, which is what
 * you want when something other than you — an agent, a test, a demo — is going
 * to be writing to it.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveWorkspaceHome(env = process.env) {
  const override = env.CURLER_HOME?.trim()
  if (!override) return path.join(os.homedir(), '.curler')

  // A .env is not read by a shell, so a leading ~ arrives literally.
  const expanded = override.startsWith('~/') ? path.join(os.homedir(), override.slice(2)) : override

  return path.resolve(expanded)
}

export function resolveDomain(env = process.env) {
  return env.DOMAIN?.trim()
}

export const DEFAULT_MAX_UPLOAD_MB = 32
/** Guard against accidental huge multipart forms blocking the event loop. */
export const MAX_MULTIPART_FILE_PARTS = 100

/**
 * Max bytes per file part and total multipart payload. Separate from the
 * response cap (`maxResponseMb`) on each request.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveMaxUploadBytes(env = process.env) {
  const raw = env.CURLER_MAX_UPLOAD_MB?.trim()
  if (!raw) return DEFAULT_MAX_UPLOAD_MB * 1024 * 1024
  const mb = Number(raw)
  if (!Number.isFinite(mb) || mb < 1) {
    throw new Error(`CURLER_MAX_UPLOAD_MB must be a number between 1 and 2048 (got "${raw}").`)
  }
  return Math.min(mb, 2048) * 1024 * 1024
}

/**
 * @param {string | undefined} envValue Comma-separated directory roots.
 * @param {Record<string, string | undefined>} [env]
 */
export function parseUploadRootList(envValue, _env = process.env) {
  if (!envValue?.trim()) return []
  return envValue
    .split(',')
    .map((entry) => {
      const trimmed = entry.trim()
      if (!trimmed) return null
      const expanded = trimmed.startsWith('~/')
        ? path.join(os.homedir(), trimmed.slice(2))
        : trimmed
      return path.resolve(expanded)
    })
    .filter(Boolean)
}

/**
 * Filesystem policy for `@path` multipart parts and file-picker staging.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveUploadPolicy(env = process.env) {
  return {
    maxUploadBytes: resolveMaxUploadBytes(env),
    allowRoots: parseUploadRootList(env.CURLER_UPLOAD_ALLOW, env),
    denyRoots: parseUploadRootList(env.CURLER_UPLOAD_DENY, env),
    maxFileParts: MAX_MULTIPART_FILE_PARTS,
  }
}
