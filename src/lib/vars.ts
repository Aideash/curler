import type { KeyValue, RequestModel, Scope } from '../types'

/** Matches `${NAME}` and bare `$NAME` references. */
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g

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

export type VariableIssue = { name: string; kind: 'missing' | 'empty' }

/** A resolved set of variables, with the scope each name came from. */
export interface VariableSet {
  values: Record<string, string>
  origins: Record<string, Scope>
}

export const EMPTY_VARIABLE_SET: VariableSet = { values: {}, origins: {} }

/**
 * Folds the scopes into one lookup table. Sources are supplied narrowest
 * first, and the first definition of a name wins, so a request-level value
 * quietly takes precedence over the collection or environment it sits in.
 */
export function mergeScopes(sources: { scope: Scope; rows: KeyValue[] }[]): VariableSet {
  const values: Record<string, string> = {}
  const origins: Record<string, Scope> = {}

  const claim = (scope: Scope, name: string, value: string) => {
    if (name in values) return
    values[name] = value
    origins[name] = scope
  }

  // Rows carrying an actual value are considered first, across every scope.
  // The editor keeps a blank trailing row at the bottom of each list, and a
  // half-typed name in one of those must not blank out a real value further
  // out. Blank rows only get to define a name nothing else defines, where
  // they still serve a purpose: reporting it as empty rather than missing.
  for (const pass of [1, 2]) {
    for (const { scope, rows } of sources) {
      for (const row of rows) {
        if (!row.enabled) continue
        const name = row.name.trim()
        if (!name) continue
        const blank = row.value === ''
        if (blank === (pass === 1)) continue
        claim(scope, name, row.value)
      }
    }
  }

  return { values, origins }
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

  let value = input.replace(REFERENCE, (match, braced, bare) =>
    take(braced ?? bare, match),
  )

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

export function referencedNames(input: string, includePathParams = false): string[] {
  const names: string[] = []
  for (const match of input.matchAll(REFERENCE)) {
    const name = match[1] ?? match[2]
    if (!names.includes(name)) names.push(name)
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
 */
export function inspect(
  input: string,
  variables: Record<string, string>,
  includePathParams = false,
): VariableIssue[] {
  const issues: VariableIssue[] = []
  for (const name of referencedNames(input, includePathParams)) {
    if (!(name in variables)) issues.push({ name, kind: 'missing' })
    else if (variables[name].trim() === '') issues.push({ name, kind: 'empty' })
  }
  return issues
}

export function describeIssues(issues: VariableIssue[]): string {
  return issues
    .map((issue) =>
      issue.kind === 'missing'
        ? `$${issue.name} is not defined in any scope`
        : `$${issue.name} is defined but empty`,
    )
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

function noteUsage(
  seen: Map<string, TraceVariable>,
  input: string,
  where: string,
  variables: Record<string, string>,
  origins: Record<string, Scope>,
  includePathParams = false,
) {
  for (const name of referencedNames(input, includePathParams)) {
    const existing = seen.get(name)
    if (existing) {
      if (!existing.usedIn.includes(where)) existing.usedIn.push(where)
      continue
    }
    seen.set(name, {
      name,
      value: variables[name] ?? '',
      scope: name in variables ? (origins[name] ?? null) : null,
      usedIn: [where],
    })
  }
}

export function traceRequest(
  request: RequestModel,
  set: VariableSet,
): BuildTrace {
  const { values, origins } = set
  const seen = new Map<string, TraceVariable>()
  const droppedHeaders: string[] = []
  const droppedFields: string[] = []

  noteUsage(seen, request.url, 'URL', values, origins, true)

  for (const header of request.headers) {
    if (!header.enabled) continue
    if (!header.name.trim() || !header.value.trim()) {
      if (header.name.trim() || header.value.trim()) {
        droppedHeaders.push(header.name.trim() || `(value "${header.value.trim()}")`)
      }
      continue
    }
    noteUsage(seen, `${header.name} ${header.value}`, `header ${header.name.trim()}`, values, origins)
  }

  if (request.body.mode === 'json' || request.body.mode === 'text') {
    noteUsage(seen, request.body.text, 'body', values, origins)
  } else if (request.body.mode === 'form') {
    for (const field of request.body.form) {
      if (!field.enabled) continue
      if (!field.name.trim() || !field.value.trim()) {
        if (field.name.trim() || field.value.trim()) {
          droppedFields.push(field.name.trim() || `(value "${field.value.trim()}")`)
        }
        continue
      }
      noteUsage(seen, `${field.name} ${field.value}`, `field ${field.name.trim()}`, values, origins)
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
