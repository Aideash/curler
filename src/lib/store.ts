import { computed, reactive, watch } from 'vue'
import {
  DEFAULT_MAX_RESPONSE_MB,
  newRequest,
  uid,
  type Collection,
  type Environment,
  type KeyValue,
  type RequestModel,
} from '../types'
import { readBuiltins, readWorkspace, writeWorkspace } from './backend'
import { mergeScopes, type VariableSet } from './vars'

interface State {
  loaded: boolean
  /**
   * False until the workspace has been read successfully. Autosave is gated on
   * it, because a workspace we could not read is one we must never write over.
   */
  persistable: boolean
  error: string | null
  workspacePath: string
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
  collections: [],
  environments: [],
  activeEnvironmentId: null,
  globals: [],
  builtins: {},
  activeRequestId: null,
  scratch: newRequest(),
})

function defaultWorkspace() {
  // The editor appends its own pre-filled API_KEY row, so seeding one here too
  // would only create a duplicate.
  const environment: Environment = {
    id: uid(),
    name: 'Local',
    variables: [
      { id: uid(), name: 'BASE_URL', value: 'http://localhost:8080', enabled: true },
    ],
  }
  state.collections = [{ id: uid(), name: 'My requests', requests: [], variables: [] }]
  state.environments = [environment]
  state.activeEnvironmentId = environment.id
  state.globals = []
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
    }
  }

  state.collections = collections
  state.environments = (parsed.environments ?? []) as Environment[]
  state.activeEnvironmentId = (parsed.activeEnvironmentId ?? null) as string | null
  state.globals = (parsed.globals ?? []) as KeyValue[]

  // There is no "no environment" choice any more, so make sure one is active.
  if (!state.environments.length) {
    state.environments = [{ id: uid(), name: 'Local', variables: [] }]
  }
  if (!state.environments.some((item) => item.id === state.activeEnvironmentId)) {
    state.activeEnvironmentId = state.environments[0].id
  }
}

export async function initStore() {
  try {
    const { contents, path } = await readWorkspace()
    state.workspacePath = path
    if (contents) migrate(JSON.parse(contents))
    else defaultWorkspace()
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

let saveTimer: ReturnType<typeof setTimeout> | undefined

function persist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    // Re-checked at flush time: the gate may have closed during the debounce.
    if (!state.persistable) return
    try {
      await writeWorkspace(
        JSON.stringify(
          {
            collections: state.collections,
            environments: state.environments,
            activeEnvironmentId: state.activeEnvironmentId,
            globals: state.globals,
          },
          null,
          2,
        ),
      )
      state.error = null
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error)
    }
  }, 400)
}

watch(
  () => [
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
export const activeCollection = computed<Collection | null>(() => {
  if (!state.activeRequestId) return null
  return (
    state.collections.find((collection) =>
      collection.requests.some((request) => request.id === state.activeRequestId),
    ) ?? null
  )
})

/** The request the editor is bound to: a saved one, or the unsaved scratch. */
export const currentRequest = computed<RequestModel>(() => {
  if (state.activeRequestId) {
    const found = findRequest(state.activeRequestId)
    if (found) return found
  }
  return state.scratch
})

export const isScratch = computed(() => state.activeRequestId === null)

/** Every scope folded into one table, narrowest definition winning. */
export const variableSet = computed<VariableSet>(() =>
  mergeScopes([
    { scope: 'request', rows: currentRequest.value.variables },
    { scope: 'collection', rows: activeCollection.value?.variables ?? [] },
    { scope: 'environment', rows: activeEnvironment.value?.variables ?? [] },
    { scope: 'global', rows: state.globals },
    {
      scope: 'builtin',
      rows: Object.entries(state.builtins).map(([name, value]) => ({
        id: `builtin:${name}`,
        name,
        value,
        enabled: true,
      })),
    },
  ]),
)

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
      collection.requests.splice(index + 1, 0, copy)
      state.activeRequestId = copy.id
      return
    }
  }
}

export function deleteRequest(id: string) {
  for (const collection of state.collections) {
    const index = collection.requests.findIndex((request) => request.id === id)
    if (index !== -1) {
      collection.requests.splice(index, 1)
      if (state.activeRequestId === id) state.activeRequestId = null
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
  if (index !== -1) state.collections.splice(index, 1)
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
  state.environments.splice(index, 1)
  if (state.activeEnvironmentId === id) {
    state.activeEnvironmentId = state.environments[0].id
  }
}

export { state }
