<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CodeEditor from './CodeEditor.vue'
import DiagnosticsView from './DiagnosticsView.vue'
import { copyText } from '../lib/clipboard'
import {
  formatBytes,
  isJsonResponse,
  prettyBody,
  statusClass as statusClassFor,
} from '../lib/response'
import type { BuildTrace } from '../lib/vars'
import type { HttpResponse } from '../types'

const props = withDefaults(
  defineProps<{
    response: HttpResponse | null
    error: string | null
    sending: boolean
    trace: BuildTrace | null
    /** Distinguishes "we refused to send" from "the server rejected it". */
    errorTitle?: string
    errorChip?: string
  }>(),
  { errorTitle: 'Request failed', errorChip: 'Failed' },
)

type Tab = 'body' | 'headers' | 'diagnostics'
const tab = ref<Tab>('body')
const pretty = ref(true)

const isJson = computed(() => isJsonResponse(props.response))

const displayBody = computed(() => {
  const body = props.response?.body ?? ''
  if (!pretty.value || !isJson.value) return body
  return prettyBody(body)
})

const statusClass = computed(() => statusClassFor(props.response?.status))

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copyBody() {
  try {
    await copyText(displayBody.value)
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1600)
  } catch {
    copied.value = false
  }
}

watch(
  () => props.response,
  () => {
    // Diagnostics is a deliberate choice, usually made because something is
    // wrong, so leave it selected across sends rather than snapping back.
    if (tab.value !== 'diagnostics') tab.value = 'body'
  },
)
</script>

<template>
  <section class="response">
    <div class="status-bar">
      <template v-if="response">
        <span class="chip" :class="statusClass">
          {{ response.status }} {{ response.statusText }}
        </span>
        <span class="metric">
          <span class="material-icons sm">schedule</span>{{ response.elapsedMs }} ms
        </span>
        <span class="metric">
          <span class="material-icons sm">data_usage</span>{{ formatBytes(response.bytes) }}
        </span>
        <span v-if="response.redirectChain.length" class="metric">
          <span class="material-icons sm">alt_route</span>
          {{ response.redirectChain.length }} redirect{{ response.redirectChain.length > 1 ? 's' : '' }}
        </span>
        <span class="final-url mono faint" :title="response.finalUrl">
          {{ response.finalUrl }}
        </span>
      </template>
      <span v-else-if="sending" class="muted">Sending…</span>
      <span v-else-if="error" class="chip red">{{ errorChip }}</span>
      <span v-else class="faint">No response yet</span>

      <div class="spacer" />

      <template v-if="response">
        <div class="tabs">
          <button class="ghost tab" :class="{ active: tab === 'body' }" @click="tab = 'body'">
            Body
          </button>
          <button class="ghost tab" :class="{ active: tab === 'headers' }" @click="tab = 'headers'">
            Headers
            <span class="badge">{{ response.headers.length }}</span>
          </button>
          <button
            class="ghost tab"
            :class="{ active: tab === 'diagnostics' }"
            @click="tab = 'diagnostics'"
          >
            Diagnostics
            <span v-if="response.truncated" class="material-icons sm warn-dot">content_cut</span>
          </button>
        </div>
        <label v-if="isJson && tab === 'body'" class="pretty">
          <input id="response-pretty" v-model="pretty" type="checkbox" />
          Pretty
        </label>
        <button v-if="tab === 'body'" class="ghost copy" @click="copyBody">
          <span class="material-icons sm">{{ copied ? 'check' : 'content_copy' }}</span>
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </template>
    </div>

    <div class="content">
      <div v-if="error" class="error">
        <strong>
          <span class="material-icons sm">error_outline</span>
          {{ errorTitle }}
        </strong>
        <p>{{ error }}</p>
      </div>

      <div v-else-if="!response" class="placeholder faint">
        Send a request to see the response here.
      </div>

      <DiagnosticsView
        v-else-if="tab === 'diagnostics'"
        :diagnostics="response.diagnostics"
        :trace="trace"
      />

      <div v-else-if="tab === 'headers'" class="headers">
        <div v-for="([name, value], index) in response.headers" :key="index" class="header-row">
          <span class="header-name mono">{{ name }}</span>
          <span class="header-value mono">{{ value }}</span>
        </div>
      </div>

      <div v-else class="body-wrap">
        <p v-if="response.bodyIsBinary" class="placeholder faint">{{ response.body }}</p>
        <p v-else-if="!response.body" class="placeholder faint">Empty response body.</p>
        <CodeEditor
          v-else
          :model-value="displayBody"
          :language="isJson ? 'json' : 'text'"
          readonly
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.response {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/*
 * Wrapping at every width rather than under a breakpoint, because what this row
 * has to fit into is the viewport less the sidebar, and the sidebar is worth
 * 212px depending on whether it is railed.
 */
.status-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  min-height: 44px;
}

/* The metrics carry their own units, so the icons are what can go once the
   window is narrow enough for the row to be breaking up anyway. */
@media screen and (max-width: 950px) {
  .metric .material-icons {
    display: none;
  }
}

.chip {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 4px;
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
}

.chip.green { color: var(--green); border-color: var(--green-border); }
.chip.amber { color: var(--amber); border-color: var(--amber-border); }
.chip.red { color: var(--red); border-color: var(--red-border); }
.chip.purple { color: var(--purple); border-color: var(--purple-border); }
.chip.dim { color: var(--text-dim); }

/* Short enough to be worth keeping whole: given the chance these break between
   the number and its unit. */
.metric {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-dim);
}

.response .material-icons {
  vertical-align: 0;
}

.copy {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 82px;
  justify-content: center;
}

.final-url {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spacer {
  flex: 1;
}

.tabs {
  display: flex;
  gap: 2px;
}

.tab {
  padding: 5px 10px;
  border-radius: 4px;
}

.tab.active {
  background: var(--bg-hover);
  color: var(--text);
}

.badge {
  margin-left: 6px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-faint);
}

.warn-dot {
  margin-left: 5px;
  color: var(--amber);
  vertical-align: -3px;
}

.pretty {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
}

.pretty input {
  accent-color: var(--accent);
}

.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.body-wrap {
  height: 100%;
}

.placeholder {
  padding: 32px;
  text-align: center;
}

.error {
  padding: 20px 24px;
}

.error strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--red);
}

.error p {
  margin: 8px 0 0;
  color: var(--text-dim);
  white-space: pre-wrap;
}

.headers {
  padding: 12px 16px;
}

.header-row {
  display: grid;
  grid-template-columns: minmax(160px, 260px) 1fr;
  gap: 16px;
  padding: 5px 0;
  border-bottom: 1px solid var(--border);
}

.header-name {
  color: var(--accent);
}

.header-value {
  color: var(--text-dim);
  word-break: break-all;
}
</style>
