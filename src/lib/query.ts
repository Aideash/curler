import { uid, type KeyValue, type RequestModel } from '../types'

export interface QueryPair {
  name: string
  value: string
}

export interface SplitUrl {
  /** Origin and path, with no query and no fragment. */
  base: string
  /** Fragment including the leading `#`, or empty when the template has none. */
  hash: string
  pairs: QueryPair[]
}

/**
 * Skip a `${NAME}` placeholder. Names cannot contain `?` or `#`, so treating
 * the whole match as opaque is what lets a template like `${BASE_URL}/x?a=1`
 * split on the real query marker and not on anything inside the braces.
 */
function skipPlaceholder(input: string, index: number): number | null {
  if (input[index] !== '$' || input[index + 1] !== '{') return null
  const start = index + 2
  if (!/^[A-Za-z_]/.test(input[start] ?? '')) return null
  let cursor = start + 1
  while (cursor < input.length && /[A-Za-z0-9_]/.test(input[cursor])) cursor += 1
  if (input[cursor] !== '}') return null
  return cursor + 1
}

function indexOfUnquoted(input: string, char: string): number {
  let index = 0
  while (index < input.length) {
    const skip = skipPlaceholder(input, index)
    if (skip !== null) {
      index = skip
      continue
    }
    if (input[index] === char) return index
    index += 1
  }
  return -1
}

function splitUnquoted(input: string, char: string): string[] {
  const parts: string[] = []
  let start = 0
  let index = 0
  while (index < input.length) {
    const skip = skipPlaceholder(input, index)
    if (skip !== null) {
      index = skip
      continue
    }
    if (input[index] === char) {
      parts.push(input.slice(start, index))
      start = index + 1
    }
    index += 1
  }
  parts.push(input.slice(start))
  return parts
}

function decodeQueryPart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Percent-encode a query name or value, then put any `${NAME}` placeholders
 * back so a general curl copy still expands in the shell.
 */
export function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value).replace(/%24%7B([A-Za-z_][A-Za-z0-9_]*)%7D/gi, '${$1}')
}

export function parseQueryString(query: string): QueryPair[] {
  if (!query) return []
  const pairs: QueryPair[] = []
  for (const part of splitUnquoted(query, '&')) {
    if (!part) continue
    const eq = indexOfUnquoted(part, '=')
    const rawName = eq === -1 ? part : part.slice(0, eq)
    const rawValue = eq === -1 ? '' : part.slice(eq + 1)
    const name = decodeQueryPart(rawName)
    if (!name.trim()) continue
    pairs.push({ name, value: decodeQueryPart(rawValue) })
  }
  return pairs
}

export function serializeQueryString(pairs: QueryPair[]): string {
  return pairs.map((pair) => `${pair.name}=${pair.value}`).join('&')
}

export function splitUrl(url: string): SplitUrl {
  const hashIndex = indexOfUnquoted(url, '#')
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const queryIndex = indexOfUnquoted(beforeHash, '?')
  const base = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1)
  return { base, hash, pairs: parseQueryString(query) }
}

export function joinBaseHash(base: string, hash: string): string {
  return `${base}${hash}`
}

export function composeUrl(base: string, pairs: QueryPair[], hash: string): string {
  const query = serializeQueryString(pairs)
  return `${base}${query ? `?${query}` : ''}${hash}`
}

/** A named query row is sendable even when the value is blank (`flag=`). */
export function queryRowUsable(row: KeyValue): boolean {
  return row.enabled && row.name.trim() !== ''
}

export function enabledQueryPairs(rows: KeyValue[] | undefined): QueryPair[] {
  return (rows ?? []).filter(queryRowUsable).map((row) => ({ name: row.name, value: row.value }))
}

export function enabledQueryCount(rows: KeyValue[] | undefined): number {
  return enabledQueryPairs(rows).length
}

/**
 * Named rows in `query` win. If the table is still empty, fall back to any
 * `?…` still sitting on `url` so an unmigrated string keeps sending.
 */
export function effectiveQueryRows(request: Pick<RequestModel, 'url' | 'query'>): KeyValue[] {
  const named = (request.query ?? []).filter((row) => row.name.trim() !== '')
  if (named.length) return request.query ?? []
  return splitUrl(request.url ?? '').pairs.map(pairToRow)
}

function pairToRow(pair: QueryPair): KeyValue {
  return {
    id: uid(),
    name: pair.name,
    value: pair.value,
    enabled: true,
    ...(pair.value.trim() === '' ? { defined: true } : {}),
  }
}

/**
 * URL edits replace the enabled rows. Disabled rows keep their ids and are
 * appended after, so toggling one off and typing in the URL bar cannot delete
 * it.
 */
export function mergeQueryRows(existing: KeyValue[], parsed: QueryPair[]): KeyValue[] {
  const disabled = existing.filter((row) => !row.enabled && row.name.trim() !== '')
  return [...parsed.map(pairToRow), ...disabled]
}

export function requestPath(request: Pick<RequestModel, 'url'>): string {
  const { base, hash } = splitUrl(request.url ?? '')
  return joinBaseHash(base, hash)
}

export function composedUrl(request: Pick<RequestModel, 'url' | 'query'>): string {
  const { base, hash } = splitUrl(request.url ?? '')
  return composeUrl(base, enabledQueryPairs(effectiveQueryRows(request)), hash)
}

export function applyComposedUrl(request: RequestModel, composed: string): void {
  const { base, hash, pairs } = splitUrl(composed)
  request.url = joinBaseHash(base, hash)
  request.query = mergeQueryRows(request.query ?? [], pairs)
}

/**
 * Move any `?…` sitting on `url` into `query`, then strip it from `url`.
 * Existing named query rows win, so a later load cannot duplicate them.
 */
export function normalizeRequestUrl(request: RequestModel): void {
  const { base, hash, pairs } = splitUrl(request.url ?? '')
  request.url = joinBaseHash(base, hash)
  const named = (request.query ?? []).filter((row) => row.name.trim() !== '')
  if (named.length) {
    request.query = request.query ?? []
    return
  }
  request.query = pairs.map(pairToRow)
}

/**
 * After the path has been resolved, append enabled query rows. Substitution
 * (including `:name`) happens in `apply` so encoding sees literal text.
 * Unresolved `${NAME}` is restored after encoding, matching curl --data-urlencode.
 */
export function appendEncodedQuery(
  resolvedBase: string,
  rows: KeyValue[] | undefined,
  apply: (input: string) => string,
): string {
  const pairs = (rows ?? []).filter(queryRowUsable)
  if (!pairs.length) return resolvedBase

  const encoded = pairs
    .map(
      (row) => `${encodeQueryComponent(apply(row.name))}=${encodeQueryComponent(apply(row.value))}`,
    )
    .join('&')

  // The resolved path may already carry a query (BASE_URL itself had one).
  // Append rather than replacing it.
  const hashIndex = indexOfUnquoted(resolvedBase, '#')
  const hash = hashIndex === -1 ? '' : resolvedBase.slice(hashIndex)
  const beforeHash = hashIndex === -1 ? resolvedBase : resolvedBase.slice(0, hashIndex)
  const separator = indexOfUnquoted(beforeHash, '?') === -1 ? '?' : '&'
  return `${beforeHash}${separator}${encoded}${hash}`
}
