import { uid, type GraphqlBody, type KeyValue } from '../types'

export interface ParsedGraphqlBody {
  query: string
  variables: KeyValue[]
}

/**
 * True when `text` parses as JSON with a string `query` field — the shape every
 * GraphQL HTTP client posts.
 */
export function isGraphqlPayload(text: string): boolean {
  return parseGraphqlBody(text) !== null
}

/** How a parsed JSON value is shown in the variables table. */
function serializeVariableValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * Splits an imported JSON body into the query editor and variables table.
 * Returns null when the payload is not GraphQL-shaped.
 */
export function parseGraphqlBody(text: string): ParsedGraphqlBody | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (typeof record.query !== 'string') return null

  const variables: KeyValue[] = []
  const raw = record.variables
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      variables.push({
        id: uid(),
        name,
        value: serializeVariableValue(value),
        enabled: true,
      })
    }
  }

  return { query: record.query, variables }
}

/**
 * Coerces a table cell to a JSON value. After `${VAR}` substitution the text
 * is parsed as JSON when it can be; otherwise it is treated as a plain string,
 * which is how `"1"`, `1`, and `true` can all be entered deliberately.
 */
function coerceVariableValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return raw
  }
}

/**
 * Builds the JSON body GraphQL endpoints expect. Returns null when there is
 * nothing to send — no query and no variables.
 */
export function buildGraphqlBody(
  query: string,
  rows: KeyValue[],
  apply: (input: string) => string,
): string | null {
  const trimmedQuery = query.trim()
  const variables: Record<string, unknown> = {}

  for (const row of rows) {
    if (!row.enabled || !row.name.trim() || !row.value.trim()) continue
    variables[row.name.trim()] = coerceVariableValue(apply(row.value))
  }

  if (!trimmedQuery && Object.keys(variables).length === 0) return null

  const payload: Record<string, unknown> = {}
  if (trimmedQuery) payload.query = apply(trimmedQuery)
  if (Object.keys(variables).length > 0) payload.variables = variables

  return JSON.stringify(payload)
}

/**
 * Serialises a GraphQL body to the JSON wire form. Pass `pretty` when the
 * result is going into the JSON editor.
 */
export function serializeGraphqlBody(
  graphql: GraphqlBody,
  pretty = false,
  apply: (input: string) => string = (value) => value,
): string {
  const raw = buildGraphqlBody(graphql.query, graphql.variables, apply)
  if (!raw) return ''
  if (!pretty) return raw
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}
