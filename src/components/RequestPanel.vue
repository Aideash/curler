<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import CodeEditor from './CodeEditor.vue'
import KeyValueEditor from './KeyValueEditor.vue'
import PopMenu from './PopMenu.vue'
import VariableIssues from './VariableIssues.vue'
import { HEADER_BUNDLES, HEADER_NAMES, HEADER_PRESETS } from '../lib/presets'
import {
  TERMINAL_FLAGS,
  TERMINAL_GROUPS,
  blockedBy,
  ineffective,
  isActive,
  terminalFlag,
  terminalFlagArgs,
  type TerminalGroup,
} from '../lib/terminalFlags'
import { secretCache } from '../lib/store'
import { braceBareReferences, inspect, rowContributes, type VariableSet } from '../lib/vars'
import { parseGraphqlBody, serializeGraphqlBody } from '../lib/graphql'
import { fetchSchema, getCachedSchema, schemaCacheKey } from '../lib/graphqlSchema'
import { firstErrorMessage, validateAgainstSchema } from '../lib/graphqlValidate'
import { type CurlCopyMode } from '../lib/curl'
import { HTTP_METHODS, uid, type HttpMethod, type BodyMode, type RequestModel } from '../types'
import type { GraphQLSchema } from 'graphql'

const request = defineModel<RequestModel>('request', { required: true })

const props = withDefaults(
  defineProps<{
    variables: Record<string, string>
    sending: boolean
    environmentName?: string
    /** Full GraphQL tooling (validate, open builder). Off in compare lanes. */
    graphqlTools?: boolean
    variableSet?: VariableSet | undefined
  }>(),
  { environmentName: 'none', graphqlTools: false, variableSet: undefined },
)

const emit = defineEmits<{
  send: []
  importCurl: []
  copyCurl: [mode: CurlCopyMode]
  manageVariables: []
  openGraphqlBuilder: []
}>()

type Tab = 'headers' | 'body' | 'vars' | 'options'
const tab = ref<Tab>('headers')
const bodyEditor = ref<InstanceType<typeof CodeEditor>>()
const bodyValidity = ref({ valid: true, message: '' })
const graphqlSyntaxValidity = ref({ valid: true, message: '' })
const graphqlSchemaValidity = ref<{ valid: boolean; message: string; checked: boolean }>({
  valid: true,
  message: '',
  checked: false,
})
const graphqlSchema = shallowRef<GraphQLSchema | null>(null)
const validatingSchema = ref(false)

const graphqlCacheKey = computed(() => {
  if (!props.variableSet) return ''
  return schemaCacheKey(request.value, props.variableSet)
})

watch(graphqlCacheKey, (key) => {
  graphqlSchema.value = key ? (getCachedSchema(key) ?? null) : null
  graphqlSchemaValidity.value = { valid: true, message: '', checked: false }
})

async function validateGraphqlSchema() {
  if (!props.variableSet) return
  validatingSchema.value = true
  graphqlSchemaValidity.value = { valid: true, message: '', checked: false }

  try {
    const result = await fetchSchema(request.value, props.variableSet, props.environmentName)
    if (!result.ok) {
      graphqlSchemaValidity.value = {
        valid: false,
        message: result.error,
        checked: true,
      }
      graphqlSchema.value = null
      return
    }

    graphqlSchema.value = result.schema
    const validation = validateAgainstSchema(request.value.body.graphql.query, result.schema)
    graphqlSchemaValidity.value = {
      valid: validation.valid,
      message: validation.valid ? '' : firstErrorMessage(validation),
      checked: true,
    }
  } finally {
    validatingSchema.value = false
  }
}

function openGraphqlBuilder() {
  emit('openGraphqlBuilder')
}

const BODY_MODES: { value: BodyMode; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Raw' },
  { value: 'form', label: 'Form' },
  { value: 'graphql', label: 'GraphQL' },
]

function isModeDisabled(mode: BodyMode, method: HttpMethod) {
  if (mode === 'none') return false

  return (
    (method === 'TRACE' && mode !== 'text') ||
    (method !== 'POST' && mode === 'graphql') ||
    method === 'GET'
  )
}

const enabledHeaderCount = computed(
  () => request.value.headers.filter((h) => h.enabled && h.name.trim()).length,
)

/** Remount row editors when the backing request is swapped (sidebar switch). */
const editorKey = computed(() => request.value.id)

// Path parameters only mean anything in a URL, so only the URL is checked
// for them.
const urlIssues = computed(() => inspect(request.value.url, props.variables, true))

function braceUrlReference(name: string) {
  request.value.url = braceBareReferences(request.value.url, name)
}

const requestVarCount = computed(
  () => request.value.variables.filter((v) => rowContributes(v, secretCache)).length,
)

const canSend = computed(() => request.value.url.trim().length > 0 && !props.sending)

function applyHeader(name: string, value: string) {
  const existing = request.value.headers.find(
    (header) => header.name.toLowerCase() === name.toLowerCase(),
  )
  if (existing) {
    existing.value = value
    existing.enabled = true
  } else {
    const blank = request.value.headers.find((h) => !h.name.trim() && !h.value.trim())
    if (blank) {
      blank.name = name
      blank.value = value
      blank.enabled = true
    } else {
      request.value.headers.push({ id: uid(), name, value, enabled: true })
    }
  }
}

function applyBundle(headers: { name: string; value: string }[]) {
  headers.forEach((header) => applyHeader(header.name, header.value))
  tab.value = 'headers'
}

function setBodyMode(mode: BodyMode) {
  const body = request.value.body
  const from = body.mode

  if (from === 'graphql' && (mode === 'json' || mode === 'text')) {
    body.text = serializeGraphqlBody(body.graphql, mode === 'json')
  } else if ((from === 'json' || from === 'text') && mode === 'graphql') {
    const parsed = parseGraphqlBody(body.text)
    if (parsed) {
      body.graphql.query = parsed.query
      body.graphql.variables = parsed.variables
    }
  }

  body.mode = mode
  if (mode === 'json' || mode === 'graphql') {
    applyHeader('Content-Type', 'application/json')
  }
}

function setMethod(method: HttpMethod) {
  request.value.method = method
  if (isModeDisabled(request.value.body.mode, method)) {
    setBodyMode('none')
  }
}

function formatBody() {
  bodyEditor.value?.format()
}

function flagsIn(group: TerminalGroup) {
  return TERMINAL_FLAGS.filter((flag) => flag.group === group)
}

function labelsFor(ids: string[]): string {
  return ids.map((id) => terminalFlag(id)?.label ?? id).join(' and ')
}

function toggleFlag(id: string, on: boolean) {
  if (on) request.value.terminalFlags[id] = true
  else delete request.value.terminalFlags[id]
}

function setFlagValue(id: string, value: string) {
  if (value.trim()) request.value.terminalFlags[id] = value
  else delete request.value.terminalFlags[id]
}

/** What the flags will look like once appended, so the effect is visible. */
const flagPreview = computed(() =>
  terminalFlagArgs(request.value.terminalFlags)
    .map((arg) => (arg.value === undefined ? arg.flag : `${arg.flag} ${arg.value}`))
    .join(' '),
)
</script>

<template>
  <section id="request-panel" class="request" tabindex="-1">
    <div class="url-bar">
      <select
        id="request-method"
        :value="request.method"
        class="method"
        :class="request.method.toLowerCase()"
        @input="setMethod(($event.target as HTMLSelectElement).value as HttpMethod)"
      >
        <option v-for="method in HTTP_METHODS" :key="method" :value="method">
          {{ method }}
        </option>
      </select>

      <div class="url-field">
        <input
          id="request-url"
          v-model="request.url"
          class="mono"
          placeholder="https://api.example.com/v1/things  or  ${BASE_URL}/things/:id"
          spellcheck="false"
          @keydown.enter="canSend && emit('send')"
        />
        <VariableIssues class="url-warn" :issues="urlIssues" @fix="braceUrlReference" />
      </div>

      <button class="primary send" :disabled="!canSend" @click="emit('send')">
        <span class="material-icons sm">{{ sending ? 'hourglass_top' : 'send' }}</span>
        {{ sending ? 'Sending…' : 'Send' }}
      </button>
    </div>

    <div class="toolbar">
      <div class="tabs">
        <button class="ghost tab" :class="{ active: tab === 'headers' }" @click="tab = 'headers'">
          Headers
          <span v-if="enabledHeaderCount" class="badge">{{ enabledHeaderCount }}</span>
        </button>
        <button class="ghost tab" :class="{ active: tab === 'body' }" @click="tab = 'body'">
          Body
          <span v-if="request.body.mode !== 'none'" class="badge">
            {{ request.body.mode }}
          </span>
        </button>
        <button class="ghost tab" :class="{ active: tab === 'vars' }" @click="tab = 'vars'">
          Vars
          <span v-if="requestVarCount" class="badge">{{ requestVarCount }}</span>
        </button>
        <button class="ghost tab" :class="{ active: tab === 'options' }" @click="tab = 'options'">
          Options
        </button>
      </div>

      <div class="toolbar-actions">
        <button class="ghost" title="Paste a curl command" @click="emit('importCurl')">
          <span class="material-icons sm">content_paste_go</span>
          Import curl
        </button>
        <PopMenu icon="content_copy" label="Copy as curl" :width="275">
          <template #default="{ close }">
            <button
              class="preset-item copy-type"
              title="Ready to run - Variables replaced with their values"
              @click="(emit('copyCurl', 'ready'), close())"
            >
              <span class="preset-label">Ready to run</span>
              <span class="preset-desc">Variables replaced with their values</span>
            </button>
            <button
              class="preset-item copy-type"
              title="Shareable - Public vars expanded, secrets left as placeholders"
              @click="(emit('copyCurl', 'shareable'), close())"
            >
              <span class="preset-label">Shareable</span>
              <span class="preset-desc">Public vars expanded, secrets left as placeholders</span>
            </button>
            <button
              class="preset-item copy-type"
              title="General - Keeps ${VARIABLE} placeholders"
              @click="(emit('copyCurl', 'general'), close())"
            >
              <span class="preset-label">General</span>
              <span class="preset-desc">Keeps ${VARIABLE} placeholders</span>
            </button>
          </template>
        </PopMenu>
      </div>
    </div>

    <div class="panel-body">
      <!-- Headers ------------------------------------------------------- -->
      <div v-show="tab === 'headers'" class="pane">
        <div class="pane-head">
          <span class="muted">Request headers</span>
          <PopMenu icon="bolt" label="Quick add" :width="340">
            <template #default="{ close }">
              <div class="preset-section">Combinations</div>
              <button
                v-for="bundle in HEADER_BUNDLES"
                :key="bundle.label"
                class="preset-item"
                @click="(applyBundle(bundle.headers), close())"
              >
                <span class="preset-label">{{ bundle.label }}</span>
                <span class="preset-desc">{{ bundle.description }}</span>
              </button>
              <div class="preset-section">Single headers</div>
              <button
                v-for="(preset, index) in HEADER_PRESETS"
                :key="index"
                class="preset-item"
                @click="(applyBundle([preset]), close())"
              >
                <span class="preset-label mono">{{ preset.name }}</span>
                <span class="preset-desc mono">{{ preset.value || '—' }}</span>
              </button>
            </template>
          </PopMenu>
        </div>
        <KeyValueEditor
          :key="editorKey"
          v-model:rows="request.headers"
          :name-options="HEADER_NAMES"
          :variables="variables"
          list-id="header-names"
          id-prefix="header"
          name-placeholder="Header"
        />
      </div>

      <!-- Body ---------------------------------------------------------- -->
      <div v-show="tab === 'body'" class="pane">
        <div class="pane-head">
          <div class="mode-switch">
            <button
              v-for="mode in BODY_MODES"
              :key="mode.value"
              class="ghost mode"
              :class="{ active: request.body.mode === mode.value }"
              :disabled="isModeDisabled(mode.value, request.method)"
              @click="setBodyMode(mode.value)"
            >
              {{ mode.label }}
            </button>
          </div>
          <div class="pane-head-right">
            <span
              v-if="request.body.mode === 'json' && !bodyValidity.valid"
              class="invalid"
              :title="bodyValidity.message ?? 'Invalid'"
            >
              <span class="material-icons sm">error_outline</span>
              {{ bodyValidity.message }}
            </span>
            <span
              v-else-if="request.body.mode === 'json' && request.body.text.trim()"
              class="valid"
            >
              <span class="material-icons sm">check_circle_outline</span>
              Valid JSON
            </span>
            <button v-if="request.body.mode === 'json'" class="ghost" @click="formatBody">
              <span class="material-icons sm">format_indent_increase</span>
              Format
            </button>
            <template v-if="request.body.mode === 'graphql'">
              <span
                v-if="!graphqlSyntaxValidity.valid"
                class="invalid"
                :title="graphqlSyntaxValidity.message ?? 'Invalid'"
              >
                <span class="material-icons sm">error_outline</span>
                {{ graphqlSyntaxValidity.message }}
              </span>
              <span
                v-else-if="graphqlSchemaValidity.checked && !graphqlSchemaValidity.valid"
                class="invalid"
                :title="graphqlSchemaValidity.message ?? 'Invalid'"
              >
                <span class="material-icons sm">error_outline</span>
                {{ graphqlSchemaValidity.message }}
              </span>
              <span
                v-else-if="
                  graphqlSchemaValidity.checked &&
                  graphqlSchemaValidity.valid &&
                  request.body.graphql.query.trim()
                "
                class="valid"
              >
                <span class="material-icons sm">check_circle_outline</span>
                Valid query
              </span>
              <span
                v-else-if="graphqlSyntaxValidity.valid && request.body.graphql.query.trim()"
                class="valid faint"
              >
                <span class="material-icons sm">check_circle_outline</span>
                Valid syntax
              </span>
              <button
                v-if="graphqlTools"
                class="ghost"
                :disabled="validatingSchema || !request.url.trim()"
                :title="request.url.trim() ? 'Validate against server schema' : 'Set a URL first'"
                @click="validateGraphqlSchema"
              >
                <span class="material-icons sm">{{
                  validatingSchema ? 'hourglass_top' : 'rule'
                }}</span>
                {{ validatingSchema ? 'Validating…' : 'Validate' }}
              </button>
              <button
                v-if="graphqlTools"
                class="ghost"
                title="Open the GraphQL query builder"
                @click="openGraphqlBuilder"
              >
                <span class="material-icons sm">account_tree</span>
                Builder
              </button>
            </template>
          </div>
        </div>

        <p v-if="request.body.mode === 'none'" class="empty">
          This request has no body. Pick JSON, Raw, Form or GraphQL to add one.
        </p>

        <div v-else-if="request.body.mode === 'form'" class="form-body">
          <KeyValueEditor
            :key="editorKey"
            v-model:rows="request.body.form"
            :variables="variables"
            list-id="form-names"
            id-prefix="form-field"
            name-placeholder="Field"
          />
        </div>

        <div v-else-if="request.body.mode === 'graphql'" class="graphql-body">
          <p class="section-label">Query</p>
          <div class="editor-wrap graphql-query">
            <CodeEditor
              id="request-graphql-query"
              v-model="request.body.graphql.query"
              language="graphql"
              :schema="graphqlSchema"
              placeholder="query Hero($id: ID!) {&#10;  hero(id: $id) {&#10;    name&#10;  }&#10;}"
              @validity="graphqlSyntaxValidity = $event"
            />
          </div>
          <p class="section-label">Variables</p>
          <KeyValueEditor
            :key="editorKey"
            v-model:rows="request.body.graphql.variables"
            :variables="variables"
            list-id="graphql-variable-names"
            id-prefix="graphql-variable"
            name-placeholder="Name"
            value-placeholder='Value (JSON, e.g. "1" or 1 or true)'
          />
        </div>

        <div v-else class="editor-wrap">
          <CodeEditor
            id="request-body"
            ref="bodyEditor"
            v-model="request.body.text"
            :language="request.body.mode === 'json' ? 'json' : 'text'"
            :placeholder="
              request.body.mode === 'json'
                ? '{\n  &quot;key&quot;: &quot;value&quot;\n}'
                : 'Request body'
            "
            @validity="bodyValidity = $event"
          />
        </div>
      </div>

      <!-- Vars ---------------------------------------------------------- -->
      <div v-show="tab === 'vars'" class="pane">
        <div class="pane-head">
          <span class="muted">Variables for this request only</span>
          <button class="ghost" @click="emit('manageVariables')">
            <span class="material-icons sm">tune</span>
            Wider scopes
          </button>
        </div>
        <p class="pane-hint faint">
          These override anything of the same name in the collection, environment or globals. Toggle
          rows on and off to switch between values — handy for a
          <code>:id</code> path parameter with a few candidates.
        </p>
        <KeyValueEditor
          :key="editorKey"
          v-model:rows="request.variables"
          list-id="request-variable-names"
          id-prefix="request-var"
          name-placeholder="Variable name"
          value-placeholder="Value"
          :resolves="false"
        />
      </div>

      <!-- Options ------------------------------------------------------- -->
      <div v-show="tab === 'options'" class="pane option-list">
        <label class="option">
          <input
            id="option-follow-redirects"
            v-model="request.options.followRedirects"
            type="checkbox"
          />
          <span>
            <strong>Follow redirects</strong>
            <em class="faint">Equivalent to curl -L, up to 10 hops</em>
          </span>
        </label>
        <label class="option">
          <input id="option-insecure" v-model="request.options.insecure" type="checkbox" />
          <span>
            <strong>Skip TLS verification</strong>
            <em class="faint">Equivalent to curl -k, for self-signed certificates</em>
          </span>
        </label>
        <label class="option">
          <input
            id="option-timeout"
            v-model.number="request.options.timeoutSecs"
            type="number"
            min="1"
            max="600"
            class="number"
          />
          <span>
            <strong>Timeout (seconds)</strong>
            <em class="faint">Equivalent to curl -m</em>
          </span>
        </label>
        <label class="option">
          <input
            id="option-max-response-mb"
            v-model.number="request.options.maxResponseMb"
            type="number"
            min="1"
            max="2048"
            class="number"
          />
          <span>
            <strong>Response size cap (MB)</strong>
            <em class="faint">
              Stops reading past this much rather than buffering the whole thing. A truncated
              response says so in Diagnostics.
            </em>
          </span>
        </label>

        <!-- Terminal-only flags ---------------------------------------- -->
        <div class="terminal">
          <h3>
            <span class="material-icons sm">terminal</span>
            Terminal-only flags
          </h3>
          <p class="faint terminal-hint">
            Added to every <strong>Copy as curl</strong> form and nothing else. They have no effect
            on requests sent from here — there is no progress meter to quieten and no file to write.
            Flags that contradict each other cannot both be picked.
          </p>

          <div class="terminal-groups">
            <div v-for="group in TERMINAL_GROUPS" :key="group.id" class="flag-group">
              <div class="flag-group-label">{{ group.label }}</div>
              <div
                v-for="flag in flagsIn(group.id)"
                :key="flag.id"
                class="flag"
                :class="{ blocked: blockedBy(request.terminalFlags, flag.id).length }"
              >
                <label class="flag-main">
                  <input
                    v-if="flag.kind === 'boolean'"
                    :id="`flag-${flag.id}`"
                    type="checkbox"
                    :checked="isActive(request.terminalFlags, flag.id)"
                    :disabled="blockedBy(request.terminalFlags, flag.id).length > 0"
                    @change="toggleFlag(flag.id, ($event.target as HTMLInputElement).checked)"
                  />
                  <input
                    v-else
                    :id="`flag-${flag.id}`"
                    class="mono flag-value"
                    :value="
                      typeof request.terminalFlags[flag.id] === 'string'
                        ? request.terminalFlags[flag.id]
                        : ''
                    "
                    :placeholder="flag.placeholder"
                    :disabled="blockedBy(request.terminalFlags, flag.id).length > 0"
                    spellcheck="false"
                    @input="setFlagValue(flag.id, ($event.target as HTMLInputElement).value)"
                  />
                  <span class="flag-text">
                    <span class="flag-title">
                      {{ flag.label }}
                      <code class="mono">{{ flag.short ?? flag.flag }}</code>
                    </span>
                    <em class="faint">{{ flag.description }}</em>
                    <em
                      v-if="blockedBy(request.terminalFlags, flag.id).length"
                      class="blocked-note"
                    >
                      Unavailable while
                      {{ labelsFor(blockedBy(request.terminalFlags, flag.id)) }} is on.
                    </em>
                    <em
                      v-else-if="ineffective(request.terminalFlags, flag.id).length"
                      class="blocked-note"
                    >
                      Does nothing without
                      {{ labelsFor(ineffective(request.terminalFlags, flag.id)) }}.
                    </em>
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div class="preview">
            <span class="faint">Appended to Copy as curl:</span>
            <code v-if="flagPreview" class="mono">{{ flagPreview }}</code>
            <span v-else class="faint">nothing yet</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.request {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-bottom: 1px solid var(--border);
}

.request:focus-visible {
  outline: 2px solid var(--accent-dim);
  outline-offset: -2px;
}

.url-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
}

/*
 * The method and Send both hold a fixed width, so past this point they leave
 * the URL too little to read and it takes a line of its own. That puts it ahead
 * of the method in reading order but not in the tab order, which is a fair
 * trade for the field the row exists to serve.
 */
@media screen and (max-width: 560px) {
  .url-bar {
    flex-wrap: wrap;
    justify-content: space-between;
  }

  /* A minimum rather than a basis, which the shorthand further down resets. */
  .url-field {
    order: -1;
    min-width: 100%;
  }

  .pane-head button {
    padding: 2px 4px;
  }
}

.method {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 12.5px;
  min-width: 104px;
  text-align: center;
}

.method.get {
  color: var(--green);
}
.method.post {
  color: var(--accent);
}
.method.put {
  color: var(--amber);
}
.method.patch {
  color: var(--purple);
}
.method.delete {
  color: var(--red);
}
.method.options {
  color: var(--cyan);
}
.method.trace {
  color: var(--pink);
}

.url-field {
  position: relative;
  flex: 1;
  display: flex;
}

.url-field input {
  width: 100%;
}

.url-warn {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-family: var(--mono);
  font-size: 11px;
  color: var(--amber);
  pointer-events: none;
  background: var(--bg-input);
  padding-left: 6px;
}

.send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 104px;
}

.request .material-icons {
  vertical-align: 0;
}

.toolbar-actions button,
.pane-head-right button,
.valid,
.invalid {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.tab {
  border-radius: 0;
  padding: 8px 12px;
  border-bottom: 2px solid transparent;
}

.tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.preset-item.copy-type {
  flex-direction: column;
  gap: 2px;
}

.copy-type .preset-desc {
  font-size: 10px;
}

.badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 9px;
  background: var(--bg-hover);
  color: var(--text-dim);
  font-size: 11px;
  font-family: var(--mono);
}

.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.panel-body {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.pane {
  padding: 12px 16px 16px;
  overflow: auto;
  max-height: 320px;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  min-height: 30px;
  flex-wrap: wrap;
}

.pane-head-right {
  display: flex;
  align-items: center;
  justify-content: end;
  gap: 10px;
  max-width: 100%;
}

.pane-hint {
  font-size: 12px;
  line-height: 1.5;
  margin: -2px 0 12px;
}

.pane-hint code {
  font-family: var(--mono);
}

.pane-head button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.preset-section {
  padding: 8px 10px 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.preset-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 4px;
  padding: 6px 10px;
}

.preset-item:hover {
  background: var(--bg-hover);
  border-color: transparent;
}

.preset-label {
  white-space: nowrap;
}

.preset-desc {
  color: var(--text-faint);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mode-switch {
  display: flex;
  gap: 2px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 2px;
}

.mode {
  padding: 3px 12px;
  border-radius: 4px;
  font-size: 13px;
}

.mode.active {
  background: var(--bg-hover);
  color: var(--text);
}

.valid {
  color: var(--green);
}

.invalid {
  color: var(--red);
  font-family: var(--mono);
  max-width: 460px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.valid,
.invalid {
  min-width: 15px;
  font-size: 12px;
}

.editor-wrap {
  height: 240px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.graphql-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.graphql-body .section-label {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.graphql-query {
  height: 180px;
}

.empty {
  color: var(--text-faint);
  margin: 24px 0;
  text-align: center;
}

/*
 * Not ".options": the method select carries its method as a lowercased class, so
 * anything named after an HTTP method lands on it whenever that method is picked.
 */
.option-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}

.option input[type='checkbox'] {
  margin-top: 2px;
  accent-color: var(--accent);
}

.option span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.option em {
  font-style: normal;
  font-size: 12px;
}

.number {
  width: 80px;
  flex: none;
}

/* Terminal-only flags --------------------------------------------------- */

.terminal {
  margin-top: 6px;
  padding-top: 16px;
  padding-left: 10px;
  border-top: 1px solid var(--border-strong);
  border-left: 1px solid var(--border-strong);
}

.terminal-groups {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
}

@media screen and (max-width: 1960px) and (min-width: 980px) {
  .terminal-groups {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media screen and (max-width: 980px) {
  .terminal-groups {
    grid-template-columns: repeat(1, 1fr);
  }
}

.terminal h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dim);
}

.terminal-hint {
  margin: 0 0 16px;
  font-size: 12px;
  line-height: 1.55;
  max-width: 62ch;
}

.flag-group {
  margin-bottom: 14px;
}

.flag-group-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-faint);
  padding-bottom: 6px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--border);
}

.flag-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 4px 0;
  cursor: pointer;
}

.flag.blocked .flag-main {
  cursor: not-allowed;
}

.flag.blocked .flag-title,
.flag.blocked .faint {
  opacity: 0.5;
}

.flag-main input[type='checkbox'] {
  margin-top: 3px;
  accent-color: var(--accent);
  flex: none;
}

.flag-value {
  width: 150px;
  flex: none;
  font-size: 12px;
  padding: 3px 7px;
}

.flag-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.flag-title {
  display: flex;
  align-items: baseline;
  gap: 7px;
  font-size: 13px;
}

.flag-title code {
  font-size: 11.5px;
  color: var(--text-faint);
  background: var(--bg-input);
  padding: 0 5px;
  border-radius: 3px;
}

.flag-text em {
  font-style: normal;
  font-size: 12px;
}

.blocked-note {
  color: var(--amber);
  opacity: 1 !important;
}

.preview {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  padding: 9px 12px;
  background: var(--bg-input);
  border-radius: var(--radius);
  font-size: 12px;
}

.preview code {
  color: var(--syntax-string);
  word-break: break-all;
}
</style>
