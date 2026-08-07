import { computed, reactive, watch } from 'vue'
import {
  DEFAULT_MAX_RESPONSE_MB,
  newRequest,
  uid,
  type Collection,
  type Environment,
  type KeyValue,
  type RequestBody,
  type RequestModel,
} from '../types'
import { reorderItems } from '../composables/useReorderList'
import {
  readBuiltins,
  readSecrets,
  readWorkspace,
  writeSecret,
  writeWorkspace,
  deleteSecret,
  copySecret,
} from './backend'
import { braceBareReferences, mergeScopes, type VariableSet } from './vars'

interface State {
  loaded: boolean
  /**
   * False until the workspace has been read successfully. Autosave is gated on
   * it, because a workspace we could not read is one we must never write over.
   */
  persistable: boolean
  error: string | null
  workspacePath: string
  /** Stable id for OS keychain entries. */
  workspaceId: string
  collections: Collection[]
  environments: Environment[]
  activeEnvironmentId: string | null
  globals: KeyValue[]
  /** Read-only, supplied by the server from its own environment. */
  builtins: Record<string, string>
  /** Null while editing an unsaved request. */
  activeRequestId: string | null
  scratch: RequestModel
}

const state = reactive<State>({
  loaded: false,
  persistable: false,
  error: null,
  workspacePath: '',
  workspaceId: '',
  collections: [],
  environments: [],
  activeEnvironmentId: null,
  globals: [],
  builtins: {},
  activeRequestId: null,
  scratch: newRequest(),
})

/** Decrypted secret values, keyed by variable row id. Never persisted. */
export const secretCache = reactive<Record<string, string>>({})

const secretSaveTimers: Record<string, ReturnType<typeof setTimeout>> = {}

function visitVariableRows(visitor: (rows: KeyValue[]) => void) {
  visitor(state.globals)
  for (const environment of state.environments) visitor(environment.variables)
  for (const collection of state.collections) {
    visitor(collection.variables)
    for (const request of collection.requests) visitor(request.variables)
  }
}

function secretIdsFromRows(rows: KeyValue[]): string[] {
  return rows.filter((row) => row.secret).map((row) => row.id)
}

function sanitizeRows(rows: KeyValue[]): KeyValue[] {
  return rows.map((row) => (row.secret ? { ...row, value: '' } : row))
}

function ensureWorkspaceId() {
  if (!state.workspaceId) state.workspaceId = uid()
}

function defaultWorkspace() {
  ensureWorkspaceId()
  // The editor appends its own pre-filled API_KEY row, so seeding one here too
  // would only create a duplicate.
  const environment: Environment = {
    id: uid(),
    name: 'Local',
    variables: [{ id: uid(), name: 'BASE_URL', value: 'http://localhost:8080', enabled: true }],
  }
  state.collections = [{ id: uid(), name: 'My requests', requests: [], variables: [] }]
  state.environments = [environment]
  state.activeEnvironmentId = environment.id
  state.globals = []
}

/**
 * Brings a request forward to `${NAME}`-only references. A bare `$NAME` used to
 * resolve and now does not, so a request saved before the change would quietly
 * send the literal text; rewriting it on load is what keeps that from happening
 * to a request nobody has opened in months.
 *
 * The body is left alone on purpose. It is the one place a bare `$` is likely
 * to be deliberate — a GraphQL query declares `$id` and means it — and there is
 * no way to tell that apart from an old reference, so the editor asks rather
 * than guessing.
 *
 * Header and form rows have both halves rewritten, since `resolveRequest`
 * substitutes names as well as values. Variable rows are left out entirely: a
 * variable's value is replacement text, never resolved in its own right.
 *
 * Kept permanently rather than run once: it is idempotent, and a workspace can
 * arrive from anywhere, including a hand edit or another machine.
 */
export function braceRequestReferences(request: RequestModel) {
  request.url = braceBareReferences(request.url ?? '')

  for (const rows of [
    request.headers,
    request.body?.form,
    request.body?.multipart,
    request.body?.graphql?.variables,
  ]) {
    for (const row of rows ?? []) {
      row.name = braceBareReferences(row.name)
      row.value = braceBareReferences(row.value)
    }
  }
}

/**
 * Workspaces written before variable scopes existed have no `globals`, and no
 * variable list on collections or requests. Fill them in rather than letting
 * undefined reach the editor.
 */
function migrate(parsed: Record<string, unknown>) {
  const collections = (parsed.collections ?? []) as Collection[]
  for (const collection of collections) {
    collection.variables ??= []
    collection.requests ??= []
    for (const request of collection.requests) {
      request.variables ??= []
      request.terminalFlags ??= {}
      // A hand-edited workspace may be missing options entirely, and throwing
      // here would take the whole load down with it.
      request.options ??= {
        followRedirects: true,
        insecure: false,
        timeoutSecs: 30,
        maxResponseMb: DEFAULT_MAX_RESPONSE_MB,
      }
      request.options.maxResponseMb ??= DEFAULT_MAX_RESPONSE_MB
      request.body.graphql ??= { query: '', variables: [] }
      request.body.graphql.variables ??= []
      request.body.graphql.query ??= ''
      request.body.multipart ??= []
      const legacy = request.body as RequestBody & { graphqlVariables?: KeyValue[] }
      if (legacy.graphqlVariables?.length && !request.body.graphql.variables.length) {
        request.body.graphql.variables = legacy.graphqlVariables
      }
      if (request.body.mode === 'graphql' && request.body.text && !request.body.graphql.query) {
        request.body.graphql.query = request.body.text
      }
      delete (request.body as unknown as Record<string, unknown>).graphqlVariables
      braceRequestReferences(request)
    }
  }

  state.collections = collections
  state.environments = (parsed.environments ?? []) as Environment[]
  state.activeEnvironmentId = (parsed.activeEnvironmentId ?? null) as string | null
  state.globals = (parsed.globals ?? []) as KeyValue[]
  state.workspaceId = (parsed.workspaceId as string) ?? uid()

  visitVariableRows((rows) => {
    for (const row of rows) {
      if (row.secret) row.value = ''
    }
  })

  // There is no "no environment" choice any more, so make sure one is active.
  if (!state.environments.length) {
    state.environments = [{ id: uid(), name: 'Local', variables: [] }]
  }
  if (!state.environments.some((item) => item.id === state.activeEnvironmentId)) {
    state.activeEnvironmentId = state.environments[0].id
  }
}

async function adoptPlaintextSecrets() {
  const pending: Promise<void>[] = []
  visitVariableRows((rows) => {
    for (const row of rows) {
      if (!row.secret || !row.value) continue
      secretCache[row.id] = row.value
      pending.push(writeSecret(row.id, row.value))
      row.value = ''
    }
  })
  await Promise.all(pending)
}

async function loadSecretCache() {
  try {
    const values = await readSecrets()
    for (const [id, value] of Object.entries(values)) {
      if (value !== null) secretCache[id] = value
    }
  } catch {
    // Keychain may be unavailable; secrets resolve empty until it is.
  }
}

function purgeSecretCache(ids: string[]) {
  for (const id of ids) delete secretCache[id]
}

async function removeSecrets(ids: string[]) {
  purgeSecretCache(ids)
  await Promise.all(ids.map((id) => deleteSecret(id).catch(() => undefined)))
}

function rekeySecretRows(rows: KeyValue[]): Map<string, string> {
  const pairs = new Map<string, string>()
  for (const row of rows) {
    if (!row.secret) continue
    const fromId = row.id
    row.id = uid()
    row.value = ''
    pairs.set(fromId, row.id)
  }
  return pairs
}

async function copySecretPairs(pairs: Map<string, string>) {
  for (const [fromId, toId] of pairs) {
    try {
      const copied = await copySecret(fromId, toId)
      if (copied && fromId in secretCache) secretCache[toId] = secretCache[fromId]
    } catch {
      // The copy still works from keychain even when the cache missed it.
    }
  }
}

export async function initStore() {
  try {
    const { contents, path } = await readWorkspace()
    state.workspacePath = path
    if (contents) migrate(JSON.parse(contents))
    else defaultWorkspace()
    ensureWorkspaceId()
    await adoptPlaintextSecrets()
    await loadSecretCache()
    state.persistable = true
  } catch (error) {
    /**
     * A read that fails says nothing about what is on disk -- the API server
     * being mid-restart looks exactly like a workspace that is empty. Seeding
     * defaults and letting autosave write them back is how you turn a two
     * second outage into permanent data loss, so editing stays possible but
     * saving does not until a load succeeds.
     */
    state.error =
      `${error instanceof Error ? error.message : String(error)} — ` +
      'nothing will be saved until your workspace loads. Reload the page once ' +
      'the server is back.'
    defaultWorkspace()
    state.persistable = false
  } finally {
    state.loaded = true
  }

  // Built-ins are a convenience, not a requirement: a failure here should not
  // stop the workspace from loading.
  try {
    state.builtins = await readBuiltins()
  } catch {
    state.builtins = {}
  }
}

/** Reload from disk after an out-of-band change such as restoring a backup. */
export async function reloadWorkspace() {
  clearTimeout(saveTimer)
  const { contents, path } = await readWorkspace()
  state.workspacePath = path
  if (contents) migrate(JSON.parse(contents))
  else defaultWorkspace()
  ensureWorkspaceId()
  state.activeRequestId = null
  state.scratch = newRequest()
  await loadSecretCache()
  state.error = null
  state.persistable = true
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

function workspaceSnapshot() {
  return {
    workspaceId: state.workspaceId,
    collections: state.collections.map((collection) => ({
      ...collection,
      variables: sanitizeRows(collection.variables),
      requests: collection.requests.map((request) => ({
        ...request,
        variables: sanitizeRows(request.variables),
      })),
    })),
    environments: state.environments.map((environment) => ({
      ...environment,
      variables: sanitizeRows(environment.variables),
    })),
    activeEnvironmentId: state.activeEnvironmentId,
    globals: sanitizeRows(state.globals),
  }
}

function persist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    // Re-checked at flush time: the gate may have closed during the debounce.
    if (!state.persistable) return
    try {
      ensureWorkspaceId()
      const snapshot = workspaceSnapshot()
      await writeWorkspace(JSON.stringify(snapshot, null, 2))
      state.error = null
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error)
    }
  }, 400)
}

export function queueSecretSave(rowId: string, value: string) {
  secretCache[rowId] = value
  clearTimeout(secretSaveTimers[rowId])
  secretSaveTimers[rowId] = setTimeout(() => {
    writeSecret(rowId, value).catch((error) => {
      state.error = error instanceof Error ? error.message : String(error)
    })
  }, 400)
}

export async function enableRowSecret(row: KeyValue): Promise<void> {
  const value = row.value.trim() !== '' ? row.value : (secretCache[row.id] ?? '')
  await writeSecret(row.id, value)
  row.secret = true
  row.value = ''
  row.defined = true
  secretCache[row.id] = value
}

export async function disableRowSecret(row: KeyValue): Promise<void> {
  const value = secretCache[row.id] ?? (await readSecrets([row.id]))[row.id] ?? ''
  await deleteSecret(row.id)
  delete secretCache[row.id]
  row.secret = false
  row.value = value
}

export async function removeRowSecret(rowId: string): Promise<void> {
  delete secretCache[rowId]
  clearTimeout(secretSaveTimers[rowId])
  await deleteSecret(rowId).catch(() => undefined)
}

export function resolvedRowValue(row: KeyValue): string {
  return row.secret ? (secretCache[row.id] ?? '') : row.value
}

watch(
  () => [
    state.workspaceId,
    state.collections,
    state.environments,
    state.activeEnvironmentId,
    state.globals,
  ],
  () => {
    if (state.loaded && state.persistable) persist()
  },
  { deep: true },
)

export const activeEnvironment = computed(
  () => state.environments.find((item) => item.id === state.activeEnvironmentId) ?? null,
)

function findRequest(id: string): RequestModel | null {
  for (const collection of state.collections) {
    const match = collection.requests.find((request) => request.id === id)
    if (match) return match
  }
  return null
}

/** The collection holding the request being edited, if it is a saved one. */
export const activeCollection = computed<Collection | null>(() =>
  collectionOfRequest(state.activeRequestId),
)

/** The request the editor is bound to: a saved one, or the unsaved scratch. */
export const currentRequest = computed<RequestModel>(() => {
  if (state.activeRequestId) {
    const found = findRequest(state.activeRequestId)
    if (found) return found
  }
  return state.scratch
})

export const isScratch = computed(() => state.activeRequestId === null)

function builtinRows(): KeyValue[] {
  return Object.entries(state.builtins).map(([name, value]) => ({
    id: `builtin:${name}`,
    name,
    value,
    enabled: true,
  }))
}

/**
 * Every scope folded into one table, narrowest definition winning. The
 * environment is a parameter rather than the active one, because a comparison
 * lane resolves against an environment of its own choosing without disturbing
 * what the sidebar has selected.
 */
export function buildVariableSet(
  request: RequestModel,
  collection: Collection | null,
  environment: Environment | null,
): VariableSet {
  return mergeScopes(
    [
      { scope: 'request', rows: request.variables },
      { scope: 'collection', rows: collection?.variables ?? [] },
      { scope: 'environment', rows: environment?.variables ?? [] },
      { scope: 'global', rows: state.globals },
      { scope: 'builtin', rows: builtinRows() },
    ],
    secretCache,
  )
}

export const variableSet = computed<VariableSet>(() =>
  buildVariableSet(currentRequest.value, activeCollection.value, activeEnvironment.value),
)

/** The collection holding a given saved request, by id. */
export function collectionOfRequest(id: string | null): Collection | null {
  if (!id) return null
  return (
    state.collections.find((collection) =>
      collection.requests.some((request) => request.id === id),
    ) ?? null
  )
}

export function environmentById(id: string | null): Environment | null {
  if (!id) return null
  return state.environments.find((item) => item.id === id) ?? null
}

export const variables = computed(() => variableSet.value.values)

export function selectRequest(id: string) {
  state.activeRequestId = id
}

export function newScratchRequest(seed?: RequestModel) {
  state.scratch = seed ? { ...seed, id: uid() } : newRequest()
  state.activeRequestId = null
}

export function replaceCurrent(request: RequestModel) {
  if (state.activeRequestId) {
    const existing = findRequest(state.activeRequestId)
    if (existing) {
      Object.assign(existing, { ...request, id: existing.id, name: existing.name })
      return
    }
  }
  state.scratch = { ...request, id: uid() }
}

export function saveCurrentTo(collectionId: string, name: string) {
  const collection = state.collections.find((item) => item.id === collectionId)
  if (!collection) return
  const snapshot: RequestModel = JSON.parse(JSON.stringify(currentRequest.value))
  snapshot.id = uid()
  snapshot.name = name.trim() || 'Untitled request'
  collection.requests.push(snapshot)
  state.activeRequestId = snapshot.id
}

export function renameRequest(id: string, name: string) {
  const request = findRequest(id)
  if (request) request.name = name.trim() || 'Untitled request'
}

export function duplicateRequest(id: string) {
  for (const collection of state.collections) {
    const index = collection.requests.findIndex((request) => request.id === id)
    if (index !== -1) {
      const copy: RequestModel = JSON.parse(JSON.stringify(collection.requests[index]))
      copy.id = uid()
      copy.name = `${copy.name} copy`
      const pairs = rekeySecretRows(copy.variables)
      collection.requests.splice(index + 1, 0, copy)
      state.activeRequestId = copy.id
      void copySecretPairs(pairs)
      return
    }
  }
}

export function reorderRequest(collectionId: string, fromIndex: number, toIndex: number) {
  const collection = state.collections.find((item) => item.id === collectionId)
  if (!collection) return
  reorderItems(collection.requests, fromIndex, toIndex)
}

export function deleteRequest(id: string) {
  for (const collection of state.collections) {
    const index = collection.requests.findIndex((request) => request.id === id)
    if (index !== -1) {
      const request = collection.requests[index]
      const ids = secretIdsFromRows(request.variables)
      collection.requests.splice(index, 1)
      if (state.activeRequestId === id) state.activeRequestId = null
      void removeSecrets(ids)
      return
    }
  }
}

export function addCollection(name: string) {
  state.collections.push({
    id: uid(),
    name: name.trim() || 'New collection',
    requests: [],
    variables: [],
  })
}

export function renameCollection(id: string, name: string) {
  const collection = state.collections.find((item) => item.id === id)
  if (collection) collection.name = name.trim() || 'Untitled collection'
}

export function deleteCollection(id: string) {
  const index = state.collections.findIndex((item) => item.id === id)
  if (index === -1) return
  const collection = state.collections[index]
  const ids = secretIdsFromRows(collection.variables)
  for (const request of collection.requests) ids.push(...secretIdsFromRows(request.variables))
  state.collections.splice(index, 1)
  void removeSecrets(ids)
}

export function addEnvironment(name: string) {
  const environment: Environment = {
    id: uid(),
    name: name.trim() || 'New environment',
    variables: [],
  }
  state.environments.push(environment)
  state.activeEnvironmentId = environment.id
}

export function deleteEnvironment(id: string) {
  // Something always has to be selected, so refuse to remove the last one.
  if (state.environments.length <= 1) return
  const index = state.environments.findIndex((item) => item.id === id)
  if (index === -1) return
  const ids = secretIdsFromRows(state.environments[index].variables)
  state.environments.splice(index, 1)
  if (state.activeEnvironmentId === id) {
    state.activeEnvironmentId = state.environments[0].id
  }
  void removeSecrets(ids)
}

export { state }
