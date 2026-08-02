import type { KeyValue, RequestModel, Scope } from '../types'
import { SECRET_REDACTED } from './secrets'
import { buildGraphqlBody } from './graphql'

/**
 * Matches `${NAME}`, and only that. A bare `$NAME` is literal text, because a
 * GraphQL query carries its own `$id` variables and a shell would not have
 * expanded those either: they reach us from inside single or `$'...'` quotes,
 * where nothing is expanded. Anything the shell *would* have expanded arrives
 * braced already, courtesy of the importer.
 */
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/** A bare `$NAME`, which is only ever a suggestion to write `${NAME}`. */
const BARE_REFERENCE = /\$([A-Za-z_][A-Za-z0-9_]*)/g

/**
 * Path parameters, as in `/api/things/:id`. Only meaningful in a URL, and only
 * after a separator, which keeps `https://`, `:8080` and `user:pass@host` out
 * of it. The leading separator is captured so it can be put back.
 */
const PATH_PARAM = /(^|[/?&=,;])(:)([A-Za-z_][A-Za-z0-9_]*)/g

export interface Resolution {
  value: string
  missing: string[]
  /** Defined, but with an empty value. */
  empty: string[]
}

/**
 * `bare` is a suggestion rather than a fault: the text is valid as it stands,
 * it just does not reference anything. Only `inspect` reports it, so it can
 * never reach `variableProblem` and hold up a send.
 */
export type VariableIssue = { name: string; kind: 'missing' | 'empty' | 'bare' }

/** A resolved set of variables, with the scope each name came from. */
export interface VariableSet {
  values: Record<string, string>
  origins: Record<string, Scope>
  /** Names whose winning definition is stored as a secret. */
  secretNames: Set<string>
}

export const EMPTY_VARIABLE_SET: VariableSet = { values: {}, origins: {}, secretNames: new Set() }

/**
 * Folds the scopes into one lookup table. Sources are supplied narrowest
 * first, and the first definition of a name wins, so a request-level value
 * quietly takes precedence over the collection or environment it sits in.
 */
export function mergeScopes(
  sources: { scope: Scope; rows: KeyValue[] }[],
  secretValues: Record<string, string> = {},
): VariableSet {
  const values: Record<string, string> = {}
  const origins: Record<string, Scope> = {}
  const secretNames = new Set<string>()

  const claim = (scope: Scope, name: string, row: KeyValue) => {
    if (name in values) return
    values[name] = row.secret ? (secretValues[row.id] ?? '') : row.value
    origins[name] = scope
    if (row.secret) secretNames.add(name)
  }

  // Rows carrying an actual value are considered first, across every scope.
  // The editor keeps a blank trailing row at the bottom of each list, and a
  // half-typed name in one of those must not blank out a real value further
  // out. Blank rows only get to define a name nothing else defines, where
  // they still serve a purpose: reporting it as empty rather than missing.
  // Secret rows count as filled when the keychain holds a value, even though
  // the persisted `value` field is empty.
  for (const pass of [1, 2]) {
    for (const { scope, rows } of sources) {
      for (const row of rows) {
        if (!row.enabled) continue
        const name = row.name.trim()
        if (!name) continue
        const resolved = row.secret ? (secretValues[row.id] ?? '') : row.value
        const blank = resolved === ''
        if (blank === (pass === 1)) continue
        claim(scope, name, row)
      }
    }
  }

  return { values, origins, secretNames }
}

/** Kept for the simple single-list case, mainly in checks. */
export function environmentMap(
  environment: { variables: KeyValue[] } | null,
): Record<string, string> {
  if (!environment) return {}
  return mergeScopes([{ scope: 'environment', rows: environment.variables }]).values
}

function substitute(
  input: string,
  variables: Record<string, string>,
  includePathParams: boolean,
): Resolution {
  const missing: string[] = []
  const empty: string[] = []

  const take = (name: string, original: string): string => {
    if (!(name in variables)) {
      if (!missing.includes(name)) missing.push(name)
      return original
    }
    if (variables[name].trim() === '' && !empty.includes(name)) empty.push(name)
    return variables[name]
  }

  let value = input.replace(REFERENCE, (match, name) => take(name, match))

  if (includePathParams) {
    value = value.replace(PATH_PARAM, (_match, lead, colon, name) => {
      const replaced = take(name, `${colon}${name}`)
      return `${lead}${replaced}`
    })
  }

  return { value, missing, empty }
}

export function resolve(input: string, variables: Record<string, string>): Resolution {
  return substitute(input, variables, false)
}

/** Same as `resolve`, but also expands `:name` path parameters. */
export function resolveUrl(input: string, variables: Record<string, string>): Resolution {
  return substitute(input, variables, true)
}

/**
 * Names written bare, which resolve to nothing. A `${NAME}` alongside is left
 * out: the `{` stops the bare pattern from matching, so the two never overlap.
 */
export function bareReferencedNames(input: string): string[] {
  const names: string[] = []
  for (const match of input.matchAll(BARE_REFERENCE)) {
    if (!names.includes(match[1])) names.push(match[1])
  }
  return names
}

/**
 * Rewrites bare `$NAME` as `${NAME}`, either throughout or for one name. Used
 * both to bring an older workspace forward and to apply the suggestion offered
 * beside a field, so the two can never disagree about what the fix is.
 */
export function braceBareReferences(input: string, name?: string): string {
  return input.replace(BARE_REFERENCE, (match, found) =>
    name === undefined || found === name ? `\${${found}}` : match,
  )
}

export function referencedNames(input: string, includePathParams = false): string[] {
  const names: string[] = []
  for (const match of input.matchAll(REFERENCE)) {
    if (!names.includes(match[1])) names.push(match[1])
  }
  if (includePathParams) {
    for (const match of input.matchAll(PATH_PARAM)) {
      if (!names.includes(match[3])) names.push(match[3])
    }
  }
  return names
}

/**
 * A reference that resolves to an empty string is worth flagging as loudly as
 * one that is undefined: it silently produces a header like `x-api-key:` with
 * nothing after it, which reads as an authentication failure at the far end.
 *
 * A bare `$NAME` is reported too, since typing one and expecting a value is an
 * easy habit to carry over from the shell. Pass `bareReferences: false` where a
 * bare `$` is ordinary text, as it is in a request body.
 */
export function inspect(
  input: string,
  variables: Record<string, string>,
  includePathParams = false,
  bareReferences = true,
): VariableIssue[] {
  const issues: VariableIssue[] = []
  for (const name of referencedNames(input, includePathParams)) {
    if (!(name in variables)) issues.push({ name, kind: 'missing' })
    else if (variables[name].trim() === '') issues.push({ name, kind: 'empty' })
  }
  if (bareReferences) {
    for (const name of bareReferencedNames(input)) issues.push({ name, kind: 'bare' })
  }
  return issues
}

export function describeIssues(issues: VariableIssue[]): string {
  return issues
    .map((issue) => {
      if (issue.kind === 'missing') return `$${issue.name} is not defined in any scope`
      if (issue.kind === 'empty') return `$${issue.name} is defined but empty`
      return `$${issue.name} is literal text. Write \${${issue.name}} to reference the variable.`
    })
    .join('\n')
}

export interface TraceVariable {
  name: string
  value: string
  /** Null when nothing defines the name. */
  scope: Scope | null
  /** Where in the request it was referenced. */
  usedIn: string[]
}

/**
 * How the request was assembled: which variables were consulted, which scope
 * answered, and which rows were left out. This is the part of the diagnostics
 * that curl has no equivalent for, and in practice the part that explains a
 * surprising 401.
 */
export interface BuildTrace {
  variables: TraceVariable[]
  droppedHeaders: string[]
  droppedFields: string[]
}

export function traceRequest(request: RequestModel, set: VariableSet): BuildTrace {
  const { values, origins, secretNames } = set
  const seen = new Map<string, TraceVariable>()
  const droppedHeaders: string[] = []
  const droppedFields: string[] = []

  const displayValue = (name: string) =>
    secretNames.has(name) ? SECRET_REDACTED : (values[name] ?? '')

  const noteUsage = (input: string, where: string, includePathParams = false) => {
    for (const name of referencedNames(input, includePathParams)) {
      const existing = seen.get(name)
      if (existing) {
        if (!existing.usedIn.includes(where)) existing.usedIn.push(where)
        continue
      }
      seen.set(name, {
        name,
        value: displayValue(name),
        scope: name in values ? (origins[name] ?? null) : null,
        usedIn: [where],
      })
    }
  }

  noteUsage(request.url, 'URL', true)

  for (const header of request.headers) {
    if (!header.enabled) continue
    if (!header.name.trim() || !header.value.trim()) {
      if (header.name.trim() || header.value.trim()) {
        droppedHeaders.push(header.name.trim() || `(value "${header.value.trim()}")`)
      }
      continue
    }
    noteUsage(`${header.name} ${header.value}`, `header ${header.name.trim()}`)
  }

  if (request.body.mode === 'json' || request.body.mode === 'text') {
    noteUsage(request.body.text, 'body')
  } else if (request.body.mode === 'graphql') {
    noteUsage(request.body.graphql.query, 'GraphQL query')
    for (const row of request.body.graphql.variables) {
      if (!row.enabled) continue
      if (!row.name.trim() || !row.value.trim()) {
        if (row.name.trim() || row.value.trim()) {
          droppedFields.push(row.name.trim() || `(value "${row.value.trim()}")`)
        }
        continue
      }
      noteUsage(row.value, `GraphQL variable ${row.name.trim()}`)
    }
  } else if (request.body.mode === 'form') {
    for (const field of request.body.form) {
      if (!field.enabled) continue
      if (!field.name.trim() || !field.value.trim()) {
        if (field.name.trim() || field.value.trim()) {
          droppedFields.push(field.name.trim() || `(value "${field.value.trim()}")`)
        }
        continue
      }
      noteUsage(`${field.name} ${field.value}`, `field ${field.name.trim()}`)
    }
  }

  return { variables: [...seen.values()], droppedHeaders, droppedFields }
}

export interface ResolvedRequest {
  method: string
  url: string
  headers: [string, string][]
  body: string | null
  followRedirects: boolean
  insecure: boolean
  timeoutSecs: number
  maxResponseMb: number
  missing: string[]
  empty: string[]
}

export function resolveRequest(
  request: RequestModel,
  variables: Record<string, string>,
): ResolvedRequest {
  const missing = new Set<string>()
  const empty = new Set<string>()

  const collect = (result: Resolution) => {
    result.missing.forEach((name) => missing.add(name))
    result.empty.forEach((name) => empty.add(name))
    return result.value
  }

  const apply = (input: string) => collect(resolve(input, variables))

  // Both halves are required, matching the rule the editor enforces.
  const headers: [string, string][] = request.headers
    .filter((header) => header.enabled && header.name.trim() && header.value.trim())
    .map((header) => [apply(header.name.trim()), apply(header.value)])

  let body: string | null = null
  if (request.body.mode === 'json' || request.body.mode === 'text') {
    body = request.body.text ? apply(request.body.text) : null
  } else if (request.body.mode === 'graphql') {
    body = buildGraphqlBody(request.body.graphql.query, request.body.graphql.variables, apply)
    if (body && !headers.some(([name]) => name.toLowerCase() === 'content-type')) {
      headers.push(['Content-Type', 'application/json'])
    }
  } else if (request.body.mode === 'form') {
    const encoded = request.body.form
      .filter((field) => field.enabled && field.name.trim() && field.value.trim())
      .map(
        (field) =>
          `${encodeURIComponent(apply(field.name))}=${encodeURIComponent(apply(field.value))}`,
      )
      .join('&')
    body = encoded || null
    if (encoded && !headers.some(([name]) => name.toLowerCase() === 'content-type')) {
      headers.push(['Content-Type', 'application/x-www-form-urlencoded'])
    }
  }

  return {
    method: request.method,
    url: collect(resolveUrl(request.url.trim(), variables)),
    headers,
    body,
    followRedirects: request.options.followRedirects,
    insecure: request.options.insecure,
    timeoutSecs: request.options.timeoutSecs,
    maxResponseMb: request.options.maxResponseMb,
    missing: [...missing],
    empty: [...empty],
  }
}
