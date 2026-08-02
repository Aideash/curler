<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import BuildSidebar from './BuildSidebar.vue'
import RequestPanel from './RequestPanel.vue'
import ResponsePanel from './ResponsePanel.vue'
import CurlImportDialog from './CurlImportDialog.vue'
import VariablesDialog from './VariablesDialog.vue'
import ModalShell from './ModalShell.vue'
import ThemePicker from './ThemePicker.vue'
import { toCurl } from '../lib/curl'
import { copyText } from '../lib/clipboard'
import { performSend } from '../lib/send'
import { startComparison } from '../lib/compare'
import { navigate } from '../composables/useRoute'
import { describeIssues, resolveRequest, type BuildTrace } from '../lib/vars'
import {
  activeEnvironment,
  currentRequest,
  isScratch,
  replaceCurrent,
  saveCurrentTo,
  state,
  variables,
  variableSet,
} from '../lib/store'
import type { EditableScope, HttpResponse, RequestModel } from '../types'

const sending = ref(false)
const response = ref<HttpResponse | null>(null)
const error = ref<string | null>(null)
const errorTitle = ref('Request failed')
const errorChip = ref('Failed')
const toast = ref('')
const toastKind = ref<'ok' | 'error'>('ok')

const showImport = ref(false)
const showVariables = ref(false)
const variablesScope = ref<EditableScope>('request')

function openVariables(scope: EditableScope = 'request') {
  variablesScope.value = scope
  showVariables.value = true
}
const trace = ref<BuildTrace | null>(null)
const showSave = ref(false)
const saveName = ref('')
const saveCollectionId = ref('')

const variableWarnings = computed(() => {
  const resolved = resolveRequest(currentRequest.value, variables.value)
  return [
    ...resolved.missing.map((name) => ({ name, kind: 'missing' as const })),
    ...resolved.empty.map((name) => ({ name, kind: 'empty' as const })),
  ]
})

let toastTimer: ReturnType<typeof setTimeout> | undefined
function flash(message: string, kind: 'ok' | 'error' = 'ok') {
  toast.value = message
  toastKind.value = kind
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), kind === 'error' ? 6000 : 2200)
}

async function send() {
  sending.value = true
  error.value = null
  response.value = null

  try {
    const outcome = await performSend(
      currentRequest.value,
      variableSet.value,
      activeEnvironment.value?.name ?? 'none',
    )
    response.value = outcome.response
    error.value = outcome.error
    errorTitle.value = outcome.errorTitle
    errorChip.value = outcome.errorChip
    trace.value = outcome.trace
  } finally {
    sending.value = false
  }
}

async function copyAsCurl(resolved: boolean) {
  const command = toCurl(
    currentRequest.value,
    resolved ? variables.value : undefined,
    variables.value,
  )
  try {
    await copyText(command)
    flash(resolved ? 'Copied, variables resolved' : 'Copied with placeholders')
  } catch (caught) {
    flash(`Copy failed: ${caught instanceof Error ? caught.message : String(caught)}`, 'error')
  }
}

function onImported(request: RequestModel) {
  replaceCurrent(request)
  showImport.value = false
  flash('Imported curl command')
}

function openSave() {
  saveName.value = currentRequest.value.name
  saveCollectionId.value = state.collections[0]?.id ?? ''
  showSave.value = true
}

function confirmSave() {
  if (!saveCollectionId.value) return
  saveCurrentTo(saveCollectionId.value, saveName.value)
  showSave.value = false
  flash('Request saved')
}

/**
 * Reset the response panel to its initial state.
 */
function resetResponse() {
  response.value = null
  error.value = null
  errorTitle.value = ''
  errorChip.value = ''
}

/**
 * Carries whatever is on screen over to the comparison, saved or not, as both
 * lanes. Two copies of the same request with one environment changed is the
 * case this exists for, and it saves rebuilding the request twice.
 */
function openCompare() {
  startComparison(currentRequest.value, state.activeRequestId)
  navigate('compare')
}

function onKeydown(event: KeyboardEvent) {
  const meta = event.metaKey || event.ctrlKey
  if (meta && event.key === 'Enter') {
    event.preventDefault()
    if (currentRequest.value.url.trim()) send()
  } else if (meta && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (isScratch.value) openSave()
    else flash('Saved automatically')
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app">
    <BuildSidebar @manage-variables="openVariables" />

    <main class="main">
      <div class="title-bar">
        <input
          v-if="!isScratch"
          id="request-name"
          v-model="currentRequest.name"
          class="title-input"
          placeholder="Request name"
        />
        <span v-else class="title-input unsaved faint">Unsaved request</span>

        <span
          v-if="variableWarnings.length"
          class="missing"
          :title="describeIssues(variableWarnings)"
        >
          <span class="material-icons sm">warning_amber</span>
          {{
            variableWarnings
              .map((issue) => (issue.kind === 'empty' ? `$${issue.name} empty` : `$${issue.name}`))
              .join('  ')
          }}
        </span>

        <div class="spacer" />
        <span v-if="toast" class="toast" :class="toastKind">
          <span class="material-icons sm">
            {{ toastKind === 'error' ? 'error_outline' : 'check_circle_outline' }}
          </span>
          {{ toast }}
        </span>
        <button
          class="ghost"
          title="Compare this request against itself in another environment, or against another request"
          @click="openCompare"
        >
          <span class="material-icons sm">compare_arrows</span>
          Compare
        </button>
        <span
          v-if="!state.persistable && state.loaded"
          class="not-saving"
          :title="state.error ?? ''"
        >
          <span class="material-icons sm">cloud_off</span>
          Not saving
        </span>
        <button v-else-if="isScratch" class="ghost" @click="openSave">
          <span class="material-icons sm">bookmark_add</span>
          Save
        </button>
        <span v-else class="faint autosaved">
          <span class="material-icons sm">cloud_done</span>
          Saved
        </span>
        <ThemePicker />
      </div>

      <RequestPanel
        :request="currentRequest"
        :variables="variables"
        :sending="sending"
        @send="send"
        @import-curl="showImport = true"
        @copy-curl="copyAsCurl"
        @manage-variables="openVariables('collection')"
      />

      <ResponsePanel
        :response="response"
        :error="error"
        :sending="sending"
        :trace="trace"
        :error-title="errorTitle"
        :error-chip="errorChip"
        @reset="resetResponse"
      />
    </main>

    <CurlImportDialog v-if="showImport" @close="showImport = false" @imported="onImported" />

    <VariablesDialog
      v-if="showVariables"
      :initial-scope="variablesScope"
      @close="showVariables = false"
    />

    <ModalShell v-if="showSave" title="Save request" width="440px" @close="showSave = false">
      <label class="field">
        <span class="faint">Name</span>
        <input id="save-request-name" v-model="saveName" placeholder="Create widget" autofocus />
      </label>
      <label class="field">
        <span class="faint">Collection</span>
        <select id="save-collection" v-model="saveCollectionId">
          <option
            v-for="collection in state.collections"
            :key="collection.id"
            :value="collection.id"
          >
            {{ collection.name }}
          </option>
        </select>
      </label>
      <template #footer>
        <button @click="showSave = false">Cancel</button>
        <button class="primary" :disabled="!saveCollectionId" @click="confirmSave">Save</button>
      </template>
    </ModalShell>
  </div>
</template>

<style scoped>
/* Positioned so the narrow-layout sidebar overlays this shell rather than the
   viewport, which it would otherwise fall back to. */
.app {
  position: relative;
  display: flex;
  height: 100%;
  min-height: 0;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* Where the sidebar leaves the flow and becomes an overlay, so only the rail
   it collapses to is worth reserving. Kept in step with Sidebar's own query. */
@media screen and (max-width: 750px) {
  .main {
    margin-left: var(--rail-width);
  }
}

.title-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  min-height: 46px;
}

.title-input {
  background: transparent;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  padding: 4px 8px;
  max-width: 320px;
}

.title-input:hover:not(.unsaved) {
  border-color: var(--border);
}

.unsaved {
  font-weight: 500;
}

.missing {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--amber);
  border: 1px solid var(--amber-border);
  border-radius: 4px;
  padding: 2px 8px;
}

.spacer {
  flex: 1;
}

.toast {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--green);
}

.toast.error {
  color: var(--red);
}

.autosaved {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}

.not-saving {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 999px;
  color: var(--red);
  border: 1px solid var(--red-border);
  cursor: help;
}

.title-bar .material-icons {
  vertical-align: 0;
}

.title-bar button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}

.field span {
  font-size: 12px;
}
</style>
