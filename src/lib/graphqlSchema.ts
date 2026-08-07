import {
  buildClientSchema,
  getIntrospectionQuery,
  type GraphQLSchema,
  type IntrospectionQuery,
} from 'graphql'
import { type RequestModel } from '../types'
import { newRequest } from './store'
import { performSend } from './send'
import { resolveUrl, type VariableSet } from './vars'

const cache = new Map<string, GraphQLSchema>()
const inFlight = new Map<string, Promise<GraphQLSchema>>()

export function schemaCacheKey(request: RequestModel, variableSet: VariableSet): string {
  return resolveUrl(request.url.trim(), variableSet.values).value
}

export function getCachedSchema(key: string): GraphQLSchema | undefined {
  return cache.get(key)
}

export function invalidateSchema(key: string) {
  cache.delete(key)
}

export function clearSchemaCache() {
  cache.clear()
}

export type FetchSchemaResult =
  { ok: true; schema: GraphQLSchema; cacheKey: string } | { ok: false; error: string }

async function introspect(
  request: RequestModel,
  variableSet: VariableSet,
  environmentName: string,
  cacheKey: string,
): Promise<GraphQLSchema> {
  const introspectionRequest = newRequest({
    ...JSON.parse(JSON.stringify(request)),
    method: 'POST',
    body: {
      mode: 'graphql',
      text: '',
      form: [],
      multipart: [],
      graphql: {
        query: getIntrospectionQuery(),
        variables: [],
      },
    },
  })

  const outcome = await performSend(introspectionRequest, variableSet, environmentName)

  if (outcome.error) throw new Error(outcome.error)
  if (!outcome.response) throw new Error('No response from server')

  const { status, statusText, body } = outcome.response
  if (status >= 400) {
    throw new Error(`HTTP ${status}${statusText ? ` ${statusText}` : ''}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('Introspection response is not JSON')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid introspection response')
  }

  const record = parsed as Record<string, unknown>
  if (Array.isArray(record.errors) && record.errors.length > 0) {
    const first = record.errors[0]
    const message =
      first && typeof first === 'object' && 'message' in first
        ? String((first as { message: unknown }).message)
        : 'Introspection query failed'
    throw new Error(message)
  }

  if (!record.data || typeof record.data !== 'object') {
    throw new Error('Introspection response has no data')
  }

  const schema = buildClientSchema(record.data as IntrospectionQuery)
  cache.set(cacheKey, schema)
  return schema
}

/** Fetch schema via introspection, with in-memory cache and deduplication. */
export async function fetchSchema(
  request: RequestModel,
  variableSet: VariableSet,
  environmentName: string,
): Promise<FetchSchemaResult> {
  const cacheKey = schemaCacheKey(request, variableSet)
  const cached = cache.get(cacheKey)
  if (cached) return { ok: true, schema: cached, cacheKey }

  let pending = inFlight.get(cacheKey)
  if (!pending) {
    pending = introspect(request, variableSet, environmentName, cacheKey)
    inFlight.set(cacheKey, pending)
    pending.finally(() => inFlight.delete(cacheKey))
  }

  try {
    const schema = await pending
    return { ok: true, schema, cacheKey }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
