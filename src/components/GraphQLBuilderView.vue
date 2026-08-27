<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import type { GraphQLSchema } from 'graphql'
import CodeEditor from './CodeEditor.vue'
import KeyValueEditor from './KeyValueEditor.vue'
import GraphqlSchemaExplorer from './GraphqlSchemaExplorer.vue'
import SkipLinks from './SkipLinks.vue'
import ThemePicker from './ThemePicker.vue'
import TitleBar from './TitleBar.vue'
import TitleBarButton from './TitleBarButton.vue'
import { navigate } from '../composables/useRoute'
import { applyDraft, cancelDraft, graphqlBuilder, updateDraftGraphql } from '../lib/graphqlBuilder'
import {
  fetchSchema,
  getCachedSchema,
  invalidateSchema,
  schemaCacheKey,
} from '../lib/graphqlSchema'
import {
  insertArgument,
  insertField,
  insertInlineFragment,
  loadArgInsertMode,
  resolveVariableEnumOptions,
  type ArgClickTarget,
  type ArgInsertMode,
  type FieldClickTarget,
  type FragmentClickTarget,
  type RootOperation,
} from '../lib/graphqlQueryBuilder'
import { activeEnvironment, currentRequest, variables, variableSet } from '../lib/store'

const schema = shallowRef<GraphQLSchema | null>(null)
const schemaFilter = ref('')
const showArguments = ref(false)
const argInsertMode = ref<ArgInsertMode>(loadArgInsertMode())
const queryValidity = ref({ valid: true, message: '' })
const builderError = ref('')
const activeOperation = ref<RootOperation>('query')

const draft = computed(() => graphqlBuilder.draft)
const loading = computed(() => graphqlBuilder.schemaLoading)

const draftVariables = computed({
  get: () => draft.value?.graphql.variables ?? [],
  set: (rows) => {
    if (!draft.value) return
    updateDraftGraphql({ ...draft.value.graphql, variables: rows })
  },
})

const cacheKey = computed(() => schemaCacheKey(currentRequest.value, variableSet.value))

const variableEnumOptions = computed(() => {
  if (!schema.value || !draft.value) return {}
  return resolveVariableEnumOptions(draft.value.graphql.query, schema.value)
})

onMounted(async () => {
  if (!draft.value) {
    navigate('build')
    return
  }
  await loadSchema()
})

watch(cacheKey, () => {
  schema.value = getCachedSchema(cacheKey.value) ?? null
})

async function loadSchema(force = false) {
  graphqlBuilder.schemaLoading = true
  graphqlBuilder.schemaError = null
  builderError.value = ''

  if (force) invalidateSchema(cacheKey.value)

  const cached = getCachedSchema(cacheKey.value)
  if (cached && !force) {
    schema.value = cached
    graphqlBuilder.schemaCacheKey = cacheKey.value
    graphqlBuilder.schemaLoading = false
    return
  }

  const result = await fetchSchema(
    currentRequest.value,
    variableSet.value,
    activeEnvironment.value?.name ?? 'none',
  )

  graphqlBuilder.schemaLoading = false
  if (!result.ok) {
    graphqlBuilder.schemaError = result.error
    schema.value = null
    return
  }

  schema.value = result.schema
  graphqlBuilder.schemaCacheKey = result.cacheKey
}

function onQueryUpdate(query: string) {
  if (!draft.value) return
  updateDraftGraphql({ ...draft.value.graphql, query })
}

function onFieldClick(target: FieldClickTarget) {
  if (!draft.value || !schema.value) return
  builderError.value = ''

  try {
    const result = insertField(draft.value.graphql, schema.value, target, argInsertMode.value)
    updateDraftGraphql({ query: result.query, variables: result.variables })
  } catch (error) {
    builderError.value = error instanceof Error ? error.message : String(error)
  }
}

function onFragmentClick(target: FragmentClickTarget) {
  if (!draft.value || !schema.value) return
  builderError.value = ''

  try {
    const result = insertInlineFragment(
      draft.value.graphql,
      schema.value,
      target,
      argInsertMode.value,
    )
    updateDraftGraphql({ query: result.query, variables: result.variables })
  } catch (error) {
    builderError.value = error instanceof Error ? error.message : String(error)
  }
}

function onArgClick(target: ArgClickTarget) {
  if (!draft.value || !schema.value) return
  builderError.value = ''

  try {
    const result = insertArgument(draft.value.graphql, schema.value, target, argInsertMode.value)
    updateDraftGraphql({ query: result.query, variables: result.variables })
  } catch (error) {
    builderError.value = error instanceof Error ? error.message : String(error)
  }
}

function clearPanel() {
  if (!draft.value) return
  updateDraftGraphql({ query: '', variables: [] })
}

function done() {
  applyDraft()
  navigate('build')
}

function cancel() {
  cancelDraft()
  navigate('build')
}
</script>

<template>
  <div v-if="draft" class="graphql-builder">
    <SkipLinks
      :links="[
        { targetId: 'graphql-explorer', label: 'Skip to schema explorer' },
        { targetId: 'graphql-editor', label: 'Skip to query editor' },
      ]"
    />
    <TitleBar>
      <!-- <img class="logo" src="/android-chrome-192x192.png" alt="curler" width="32" height="32" /> -->
      <TitleBarButton
        back
        icon="arrow_back"
        label="Cancel"
        title="Discard and return"
        @click="cancel"
      />
      <span class="heading">GraphQL builder</span>
      <span class="faint hint">{{ draft.requestName }} — draft, not saved until you apply</span>

      <div class="spacer" />

      <TitleBarButton
        :icon="loading ? 'hourglass_top' : 'cloud_download'"
        :label="loading ? 'Fetching…' : schema ? 'Refresh schema' : 'Fetch schema'"
        :disabled="loading || !currentRequest.url.trim()"
        @click="loadSchema(true)"
      />
      <button class="primary" title="Done" @click="done">Done</button>
      <TitleBarButton
        icon="help_outline"
        label="Help"
        title="How to use curler"
        @click="navigate('help')"
      />
      <ThemePicker />
    </TitleBar>

    <p v-if="graphqlBuilder.schemaError" class="banner error" role="alert">
      {{ graphqlBuilder.schemaError }}
    </p>
    <p v-if="builderError" class="banner error" role="alert">{{ builderError }}</p>

    <div class="workspace">
      <aside id="graphql-explorer" class="explorer-pane" tabindex="-1">
        <div class="pane-toolbar">
          <input
            v-model="schemaFilter"
            class="filter"
            type="search"
            :placeholder="showArguments ? 'Filter fields and arguments…' : 'Filter fields…'"
            :aria-label="showArguments ? 'Filter fields and arguments' : 'Filter fields'"
            :disabled="!schema"
          />
        </div>
        <div v-if="loading" class="placeholder faint">Fetching schema…</div>
        <GraphqlSchemaExplorer
          v-else-if="schema"
          v-model:show-args="showArguments"
          v-model:arg-insert-mode="argInsertMode"
          v-model:active-operation="activeOperation"
          :schema="schema"
          :query="draft.graphql.query"
          :filter="schemaFilter"
          @field-click="onFieldClick"
          @arg-click="onArgClick"
          @fragment-click="onFragmentClick"
        />
        <div v-else class="placeholder faint">
          Set a URL on the request and fetch the schema to explore it here.
        </div>
      </aside>

      <main id="graphql-editor" class="editor-pane" tabindex="-1">
        <div class="pane-head">
          <span class="section-label">Query</span>
          <div class="pane-head-right">
            <span v-if="!queryValidity.valid" class="invalid" role="status">
              <span class="material-icons sm" aria-hidden="true">error_outline</span>
              {{ queryValidity.message }}
            </span>
            <span v-else-if="schema && draft.graphql.query.trim()" class="valid">
              <span class="material-icons sm">check_circle_outline</span>
              Valid query
            </span>
            <span v-else-if="queryValidity.valid && draft.graphql.query.trim()" class="valid faint">
              <span class="material-icons sm">check_circle_outline</span>
              Valid syntax
            </span>
            <button class="ghost clear-button" title="Clear Panel" @click="clearPanel">
              <span class="material-icons sm" aria-hidden="true">clear</span>
              <span class="label">Clear</span>
            </button>
          </div>
        </div>
        <div class="editor-wrap">
          <CodeEditor
            :model-value="draft.graphql.query"
            language="graphql"
            aria-label="GraphQL query"
            :schema="schema"
            :graphql-operation="activeOperation"
            placeholder="query { }"
            @update:model-value="onQueryUpdate"
            @validity="queryValidity = $event"
          />
        </div>

        <p class="section-label">Variables</p>
        <KeyValueEditor
          v-model:rows="draftVariables"
          class="variables-editor"
          :variables="variables"
          :enum-options="variableEnumOptions"
          list-id="builder-graphql-vars"
          id-prefix="builder-gql-var"
          name-placeholder="Name"
          value-placeholder='Value (JSON, e.g. "1" or 1 or true)'
        />
      </main>
    </div>
  </div>
</template>

<style scoped>
.graphql-builder {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
  background: var(--bg);
  color: var(--text);
}

/* image.logo {
  margin-right: -8px;
} */

.banner {
  margin: 0;
  padding: 8px 12px;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
}

.banner.error {
  background: color-mix(in srgb, var(--red) 12%, transparent);
  color: var(--red);
}

.workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow-x: auto;
}

.explorer-pane {
  width: 40%;
  min-width: 225px;
  max-width: 480px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.explorer-pane:focus-visible,
.editor-pane:focus-visible {
  outline: 2px solid var(--accent-dim);
  outline-offset: -2px;
}

.pane-toolbar {
  padding: 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.filter {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--text);
  font-size: 13px;
}

.editor-pane {
  flex: 1;
  min-width: 425px;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 8px;
  min-height: 0;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
}

.pane-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.clear-button {
  white-space: nowrap;
}

.section-label {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.variables-editor {
  max-height: 40%;
  padding-bottom: 40px;
}

.editor-wrap {
  flex: 1;
  min-height: 180px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.placeholder {
  padding: 16px;
  font-size: 13px;
}

.invalid {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--red);
}

.valid {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--green);
}

@media screen and (max-width: 500px) {
  .title-bar > .heading {
    display: none;
  }

  button.primary {
    padding: 2px 4px;
  }

  /* img.logo {
    display: none;
  } */
}
</style>
