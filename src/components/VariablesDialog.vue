<script setup lang="ts">
import { computed, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import KeyValueEditor from './KeyValueEditor.vue'
import {
  activeCollection,
  addEnvironment,
  currentRequest,
  deleteEnvironment,
  isScratch,
  state,
  variableSet,
} from '../lib/store'
import { DEFAULT_VARIABLE_NAME } from '../lib/presets'
import { SCOPE_LABELS, type EditableScope, type KeyValue } from '../types'

const emit = defineEmits<{ close: [] }>()

const props = withDefaults(defineProps<{ initialScope?: EditableScope }>(), {
  initialScope: 'request',
})

const scope = ref<EditableScope>(props.initialScope)

const environment = computed(() =>
  state.environments.find((item) => item.id === state.activeEnvironmentId),
)

interface ScopeInfo {
  id: EditableScope
  icon: string
  rows: KeyValue[] | null
  /** Why this scope is unavailable, if it is. */
  blocked: string
  blurb: string
}

const scopes = computed<ScopeInfo[]>(() => [
  {
    id: 'request',
    icon: 'description',
    rows: currentRequest.value.variables,
    blocked: '',
    blurb: isScratch.value
      ? 'Only this request can see these. They travel with it when you save it.'
      : `Only "${currentRequest.value.name}" can see these.`,
  },
  {
    id: 'collection',
    icon: 'folder',
    rows: activeCollection.value?.variables ?? null,
    blocked: isScratch.value
      ? 'Save this request into a collection first, and its collection variables will appear here.'
      : '',
    blurb: `Shared by every request in "${activeCollection.value?.name ?? ''}". A good home for an API key.`,
  },
  {
    id: 'environment',
    icon: 'swap_horiz',
    rows: environment.value?.variables ?? null,
    blocked: '',
    blurb: 'Swapped as a set from the sidebar. Put anything that differs between dev and prod here.',
  },
  {
    id: 'global',
    icon: 'public',
    rows: state.globals,
    blocked: '',
    blurb: 'Visible to every request in every collection, whatever the environment.',
  },
])

const current = computed(() => scopes.value.find((item) => item.id === scope.value)!)

/** How many rows in a scope are actually usable, for the tab counts. */
function usableCount(rows: KeyValue[] | null): number {
  if (!rows) return 0
  return rows.filter((row) => row.enabled && row.name.trim() && row.value.trim()).length
}

/**
 * Names this scope defines that never win, because a narrower scope claims
 * them. Worth surfacing, since editing the shadowed row has no visible effect.
 */
const shadowed = computed(() => {
  const rows = current.value.rows ?? []
  const names = new Set<string>()
  for (const row of rows) {
    const name = row.name.trim()
    if (!row.enabled || !name || !row.value.trim()) continue
    const winner = variableSet.value.origins[name]
    if (winner && winner !== scope.value) names.add(`${name} (${SCOPE_LABELS[winner]})`)
  }
  return [...names]
})

const builtins = computed(() => Object.entries(state.builtins))

/**
 * `API_KEY` is a sensible guess in the shared scopes, but a request-level
 * variable is far more likely to be something like an id.
 */
const defaultName = computed(() =>
  scope.value === 'request' ? '' : DEFAULT_VARIABLE_NAME,
)

function promptEnvironment() {
  const name = window.prompt('Environment name', 'Staging')
  if (name !== null) {
    addEnvironment(name)
    scope.value = 'environment'
  }
}

function confirmDeleteEnvironment() {
  if (!environment.value) return
  if (state.environments.length <= 1) {
    window.alert('There has to be at least one environment.')
    return
  }
  if (window.confirm(`Delete the environment "${environment.value.name}"?`)) {
    deleteEnvironment(environment.value.id)
  }
}
</script>

<template>
  <ModalShell title="Variables" width="720px" @close="emit('close')">
    <nav class="scope-tabs">
      <button
        v-for="item in scopes"
        :key="item.id"
        class="ghost scope-tab"
        :class="{ active: scope === item.id, unavailable: item.blocked }"
        @click="scope = item.id"
      >
        <span class="material-icons sm">{{ item.icon }}</span>
        {{ SCOPE_LABELS[item.id] }}
        <span v-if="usableCount(item.rows)" class="badge">{{ usableCount(item.rows) }}</span>
      </button>
    </nav>

    <div v-if="scope === 'environment'" class="env-bar">
      <select id="variables-environment" v-model="state.activeEnvironmentId">
        <option v-for="item in state.environments" :key="item.id" :value="item.id">
          {{ item.name }}
        </option>
      </select>
      <input
        v-if="environment"
        id="variables-environment-name"
        v-model="environment.name"
        class="rename"
        placeholder="Environment name"
      />
      <button @click="promptEnvironment">
        <span class="material-icons sm">add</span>
        New
      </button>
      <button
        class="danger"
        :disabled="state.environments.length <= 1"
        :title="state.environments.length <= 1 ? 'The last environment cannot be deleted' : 'Delete this environment'"
        @click="confirmDeleteEnvironment"
      >
        <span class="material-icons sm">delete_outline</span>
      </button>
    </div>

    <p class="blurb faint">{{ current.blurb }}</p>

    <p v-if="current.blocked" class="empty faint">{{ current.blocked }}</p>

    <KeyValueEditor
      v-else-if="current.rows"
      :key="scope"
      :rows="current.rows"
      list-id="variable-names"
      :id-prefix="`variable-${scope}`"
      name-placeholder="Variable name"
      value-placeholder="Value"
      :default-name="defaultName"
      :resolves="false"
    />

    <p v-if="shadowed.length" class="notice">
      <span class="material-icons sm">layers</span>
      Overridden by a narrower scope, so these rows have no effect right now:
      <span class="mono">{{ shadowed.join(', ') }}</span>
    </p>

    <details class="builtins">
      <summary>
        Built-in variables
        <span class="faint">({{ builtins.length }}, read-only)</span>
      </summary>
      <p class="faint">
        Read from the environment of the server process, so <code>${USER}</code> works
        without you defining it. Define a variable of the same name in any scope above to
        override one.
      </p>
      <div v-for="([name, value]) in builtins" :key="name" class="builtin-row">
        <span class="mono">{{ name }}</span>
        <span class="mono faint">{{ value }}</span>
      </div>
    </details>

    <template #footer>
      <button class="primary" @click="emit('close')">Done</button>
    </template>
  </ModalShell>
</template>

<style scoped>
.scope-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--border);
}

.scope-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 0;
  padding: 8px 12px;
  border-bottom: 2px solid transparent;
}

.scope-tab .material-icons {
  vertical-align: 0;
}

.scope-tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.scope-tab.unavailable {
  opacity: 0.55;
}

.badge {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-faint);
}

.env-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.env-bar select {
  min-width: 150px;
}

.env-bar button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.env-bar .material-icons {
  vertical-align: 0;
}

.rename {
  flex: 1;
}

.blurb {
  font-size: 12px;
  line-height: 1.5;
  margin: 0 0 14px;
}

.empty {
  text-align: center;
  padding: 24px 0;
  line-height: 1.5;
}

.notice {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  margin: 14px 0 0;
  padding: 8px 12px;
  border: 1px solid var(--amber-border);
  border-radius: var(--radius);
  color: var(--amber);
  font-size: 12px;
  line-height: 1.5;
}

.notice .material-icons {
  vertical-align: -3px;
}

.builtins {
  margin-top: 18px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
  font-size: 12px;
}

.builtins summary {
  cursor: pointer;
  user-select: none;
}

.builtins p {
  line-height: 1.5;
  margin: 8px 0 10px;
}

.builtins code {
  font-family: var(--mono);
}

.builtin-row {
  display: grid;
  grid-template-columns: minmax(90px, 160px) 1fr;
  gap: 12px;
  padding: 3px 0;
}

.builtin-row span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
