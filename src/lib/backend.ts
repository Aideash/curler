import type { HttpResponse } from '../types'
import type { ResolvedRequest } from './vars'

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
export async function readBuiltins(): Promise<Record<string, string>> {
  const { variables } = await api<{ variables: Record<string, string> }>('/builtins')
  return variables
}

export async function writeWorkspace(contents: string): Promise<void> {
  await api('/workspace', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
  })
}
