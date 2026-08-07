import type { HttpResponse } from '../types'
import type { ResolvedRequest } from './vars'
import type { MultipartPartAlert, UploadPolicy } from './multipart'

/**
 * Every call goes to the local API server rather than out of the browser, so
 * requests behave like curl: no CORS, no preflight, no implicit cookie jar.
 */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, init)
  } catch {
    throw new Error(
      'Could not reach the local curler server. Is it still running? Start it with "npm run dev".',
    )
  }
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error ?? `Request failed (${response.status})`)
  return payload as T
}

export async function sendRequest(request: ResolvedRequest): Promise<HttpResponse> {
  const payload = await api<HttpResponse & { error?: string }>('/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body,
      multipart: request.multipart,
      followRedirects: request.followRedirects,
      insecure: request.insecure,
      timeoutSecs: request.timeoutSecs,
      maxResponseMb: request.maxResponseMb,
    }),
  })
  if (payload.error) throw new Error(payload.error)
  return payload
}

export async function readWorkspace(): Promise<{ contents: string | null; path: string }> {
  return api<{ contents: string | null; path: string }>('/workspace')
}

/** Read-only values the server picks up from its own environment. */
export async function checkMultipartPaths(
  items: { id: string; path: string }[],
): Promise<Record<string, MultipartPartAlert>> {
  if (!items.length) return {}
  const { results } = await api<{
    results: { id: string; ok: boolean; message?: string }[]
  }>('/check-paths', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: items }),
  })
  const alerts: Record<string, MultipartPartAlert> = {}
  for (const result of results) {
    if (!result.ok && result.message) {
      alerts[result.id] = { message: result.message }
    }
  }
  return alerts
}

export async function readBuiltins(): Promise<Record<string, string>> {
  const { variables } = await api<{ variables: Record<string, string> }>('/builtins')
  return variables
}

/** Server process cwd — same base curl uses for relative `@file` paths. */
export async function readCurrentDir(): Promise<string> {
  const { currentDir } = await api<{ currentDir: string }>('/current-dir')
  return currentDir
}

/** Upload allow/deny policy for advisory multipart path warnings. */
export async function readUploadPolicy(): Promise<UploadPolicy> {
  return api<UploadPolicy>('/upload-policy')
}

/**
 * Copy a browser-picked file to CURLER_HOME staging and return its absolute path.
 * The workspace stores only `@path`; bytes never enter workspace.json.
 */
export async function stageLocalFile(file: File): Promise<string> {
  let response: Response
  try {
    response = await fetch('/api/stage-file', {
      method: 'POST',
      headers: { 'X-Filename': file.name },
      body: file,
    })
  } catch {
    throw new Error(
      'Could not reach the local curler server. Is it still running? Start it with "npm run dev".',
    )
  }
  const payload = (await response.json()) as { path?: string; error?: string }
  if (!response.ok) throw new Error(payload?.error ?? `Upload failed (${response.status})`)
  if (!payload.path) throw new Error('Upload succeeded but no path was returned.')
  return payload.path
}

export async function writeWorkspace(contents: string): Promise<void> {
  await api('/workspace', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
  })
}

export interface BackupEntry {
  name: string
  createdAt: string
  shrunk: boolean
  requestCount: number | null
  collectionCount: number | null
}

export async function listBackups(): Promise<BackupEntry[]> {
  const { backups } = await api<{ backups: BackupEntry[] }>('/backups')
  return backups
}

export async function restoreBackup(name: string): Promise<void> {
  await api(`/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' })
}

export async function readSecrets(rowIds?: string[]): Promise<Record<string, string | null>> {
  const query = rowIds?.length ? `?ids=${encodeURIComponent(rowIds.join(','))}` : ''
  const { values } = await api<{ values: Record<string, string | null> }>(`/secrets${query}`)
  return values
}

export async function writeSecret(rowId: string, value: string): Promise<void> {
  await api(`/secrets/${encodeURIComponent(rowId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
}

export async function deleteSecret(rowId: string): Promise<void> {
  await api(`/secrets/${encodeURIComponent(rowId)}`, { method: 'DELETE' })
}

export async function copySecret(fromRowId: string, toRowId: string): Promise<boolean> {
  const { copied } = await api<{ copied: boolean }>(
    `/secrets/${encodeURIComponent(toRowId)}/copy`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromRowId }),
    },
  )
  return copied
}
