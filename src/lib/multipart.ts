import { resolve } from './vars'

export interface MultipartPartAlert {
  message: string
}

export interface UploadPolicy {
  maxUploadMb: number
  hasAllowlist: boolean
  allowRoots: string[]
  denyRoots: string[]
  stagingRoot: string
}

/** Whether a path string is absolute on Unix or Windows. */
export function isAbsolutePath(pathStr: string): boolean {
  if (pathStr.startsWith('/')) return true
  return /^[A-Za-z]:[/\\]/.test(pathStr)
}

function normalizePath(pathStr: string): string {
  if (/^[A-Za-z]:[/\\]/.test(pathStr)) {
    return pathStr.replace(/\\/g, '/')
  }
  return pathStr
}

function isPathUnderRoot(candidate: string, root: string): boolean {
  const resolved = normalizePath(candidate)
  const resolvedRoot = normalizePath(root).replace(/\/+$/, '')
  if (resolved === resolvedRoot) return true
  return resolved.startsWith(`${resolvedRoot}/`)
}

/** Advisory mirror of server-side allow/deny checks for absolute paths. */
export function checkUploadPathAdvisory(
  pathStr: string,
  policy: UploadPolicy,
): MultipartPartAlert | null {
  if (isPathUnderRoot(pathStr, policy.stagingRoot)) return null

  for (const deny of policy.denyRoots) {
    if (isPathUnderRoot(pathStr, deny)) {
      return { message: `File path not permitted: ${pathStr}` }
    }
  }

  if (policy.hasAllowlist) {
    const allowed = policy.allowRoots.some((root) => isPathUnderRoot(pathStr, root))
    if (!allowed) {
      return { message: `File path not permitted: ${pathStr}` }
    }
  }

  return null
}

/** Strip the leading `@` from a file part value, or return null for text parts. */
export function filePathFromPartValue(value: string, textOnly = false): string | null {
  if (textOnly || !value.startsWith('@')) return null
  const raw = value.slice(1)
  return raw.trim() ? raw : null
}

export function isStdinFilePath(pathStr: string): boolean {
  return pathStr === '-'
}

/**
 * Advisory validation for a multipart part value. Does not block send — mirrors
 * invalid JSON / GraphQL warnings in the request editor.
 */
export function validateMultipartPartValue(
  value: string,
  variables: Record<string, string>,
  textOnly = false,
  policy: UploadPolicy | null = null,
): MultipartPartAlert | null {
  if (textOnly) return null

  const filePath = filePathFromPartValue(value)
  if (filePath === null) {
    if (value.startsWith('@')) {
      return { message: 'Invalid file path after @.' }
    }
    return null
  }

  if (isStdinFilePath(filePath)) {
    return { message: 'Stdin (@-) file parts are not supported.' }
  }

  const substituted = resolve(filePath, variables).value
  if (substituted.includes('${')) {
    return null
  }

  if (isStdinFilePath(substituted)) {
    return { message: 'Stdin (@-) file parts are not supported.' }
  }

  if (!isAbsolutePath(substituted)) {
    return { message: 'Relative path — resolved from server cwd at send time.' }
  }

  if (policy) {
    return checkUploadPathAdvisory(substituted, policy)
  }

  return null
}

/** Paths to check on the server (absolute, vars resolved, no remaining refs). */
export function multipartPathsToCheck(
  parts: { id: string; value: string; enabled: boolean; name: string; textOnly?: boolean }[],
  variables: Record<string, string>,
): { id: string; path: string }[] {
  const out: { id: string; path: string }[] = []
  for (const part of parts) {
    if (!part.enabled || !part.name.trim() || !part.value.trim() || part.textOnly) continue
    const filePath = filePathFromPartValue(part.value)
    if (!filePath || isStdinFilePath(filePath)) continue
    const substituted = resolve(filePath, variables).value
    if (substituted.includes('${') || isStdinFilePath(substituted)) continue
    out.push({ id: part.id, path: substituted })
  }
  return out
}

export function mergePathCheckAlerts(
  local: Record<string, MultipartPartAlert>,
  remote: Record<string, MultipartPartAlert>,
): Record<string, MultipartPartAlert> {
  return { ...remote, ...local }
}
