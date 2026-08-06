import jsBeautify from 'js-beautify'
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

export function contentLengthOf(response: HttpResponse | null): number | null {
  const header = response?.headers.find(([name]) => name.toLowerCase() === 'content-length')
  if (!header) return null
  const length = Number(header[1])
  return Number.isFinite(length) ? length : null
}

/** Bytes shown in the status bar — downloaded count, or declared size when skipped. */
export function responseByteLabel(response: HttpResponse): string {
  if (response.bodySkipped) {
    const declared = contentLengthOf(response)
    return declared !== null ? `${formatBytes(declared)} declared` : 'body not downloaded'
  }
  return formatBytes(response.bytes)
}

export function isJsonResponse(response: HttpResponse | null): boolean {
  return /\bjson\b/i.test(contentTypeOf(response))
}

const JAVASCRIPT_MIMES = new Set([
  'application/javascript',
  'application/ecmascript',
  'application/x-javascript',
  'text/javascript',
  'text/ecmascript',
])

const CSS_MIMES = new Set(['text/css', 'text/scss', 'text/less'])

const HTML_MIMES = new Set(['text/html', 'application/xhtml+xml'])

export function responseMime(response: HttpResponse | null): string {
  return contentTypeOf(response).split(';')[0]?.trim().toLowerCase() ?? ''
}

export function isJavascriptResponse(response: HttpResponse | null): boolean {
  return JAVASCRIPT_MIMES.has(responseMime(response))
}

export function isCssResponse(response: HttpResponse | null): boolean {
  return CSS_MIMES.has(responseMime(response))
}

export function isHtmlResponse(response: HttpResponse | null): boolean {
  return HTML_MIMES.has(responseMime(response))
}

export function isSassResponse(response: HttpResponse | null): boolean {
  return responseMime(response) === 'text/sass'
}

export function hasMediaPreview(response: HttpResponse | null): boolean {
  return Boolean(response?.bodyPreview && response.bodyBase64)
}

export type ResponseEditorLanguage = 'json' | 'javascript' | 'css' | 'sass' | 'html' | 'text'

/** CodeMirror language for a response body, when shown as text. */
export function responseEditorLanguage(response: HttpResponse | null): ResponseEditorLanguage {
  if (isJsonResponse(response)) return 'json'
  if (isJavascriptResponse(response)) return 'javascript'
  if (isSassResponse(response)) return 'sass'
  if (isCssResponse(response)) return 'css'
  if (isHtmlResponse(response)) return 'html'
  return 'text'
}

export function canCopyResponseBody(response: HttpResponse | null): boolean {
  if (!response || response.bodySkipped || hasMediaPreview(response)) return false
  if (response.bodyIsBinary) return false
  return Boolean(response.body)
}

export function canPrettyPrintResponse(response: HttpResponse | null): boolean {
  return isJsonResponse(response) || isJavascriptResponse(response)
}

/** Indented JSON where the text parses, and the text untouched where it does not. */
export function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

/** Reformats JavaScript; unparseable input is returned as-is. */
export function prettyJavascriptBody(body: string): string {
  try {
    return jsBeautify.js(body, { indent_size: 2 })
  } catch {
    return body
  }
}

/** Pretty-prints JSON or JavaScript response bodies; other types pass through. */
export function prettyResponseBody(response: HttpResponse | null, body: string): string {
  if (isJsonResponse(response)) return prettyBody(body)
  if (isJavascriptResponse(response)) return prettyJavascriptBody(body)
  return body
}
