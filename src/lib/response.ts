import type { HttpResponse } from '../types'

/** Colour band for a status code, matching the chip classes in the stylesheet. */
export function statusClass(status: number | undefined): string {
  const code = status ?? 0
  if (code >= 500) return 'red'
  if (code >= 400) return 'amber'
  if (code >= 300) return 'purple'
  if (code >= 200) return 'green'
  return 'dim'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function contentTypeOf(response: HttpResponse | null): string {
  const header = response?.headers.find(([name]) => name.toLowerCase() === 'content-type')
  return header?.[1] ?? ''
}

export function isJsonResponse(response: HttpResponse | null): boolean {
  return /\bjson\b/i.test(contentTypeOf(response))
}

/** Indented JSON where the text parses, and the text untouched where it does not. */
export function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}
