<script setup lang="ts">
import { computed, ref } from 'vue'
import CodeEditor from './CodeEditor.vue'
import PopMenu from './PopMenu.vue'
import { copyText } from '../lib/clipboard'
import { formatBytes, isJsonResponse, prettyBody, statusClass } from '../lib/response'
import { normalizeJson } from '../lib/diff'
import {
  duplicateLane,
  laneEnvironment,
  laneIsStale,
  removeLane,
  seedLane,
  sendLane,
  type Lane,
} from '../lib/compare'
import { state } from '../lib/store'
import { HTTP_METHODS } from '../types'

const props = defineProps<{
  lane: Lane
  /** Number of lanes on screen, so the last two cannot be closed. */
  laneCount: number
  /** Sorts JSON keys in the displayed body, matching what the diff compares. */
  normalize: boolean
  canAdd: boolean
}>()

const emit = defineEmits<{ edit: [] }>()

/** Stem for this lane's element ids. Positional, like the label it comes from. */
const idStem = computed(() => `lane-${props.lane.label.toLowerCase()}`)

const response = computed(() => props.lane.outcome?.response ?? null)
const error = computed(() => props.lane.outcome?.error ?? null)
const isJson = computed(() => isJsonResponse(response.value))
const stale = computed(() => laneIsStale(props.lane))

const pretty = ref(true)

const displayBody = computed(() => {
  const body = response.value?.body ?? ''
  if (!body) return body
  if (props.normalize && isJson.value) return normalizeJson(body)
  if (pretty.value && isJson.value) return prettyBody(body)
  return body
})

const environmentName = computed(() => laneEnvironment(props.lane)?.name ?? 'No environment')

const sourceName = computed(() => {
  if (!props.lane.sourceRequestId) return null
  for (const collection of state.collections) {
    const found = collection.requests.find((item) => item.id === props.lane.sourceRequestId)
    if (found) return `${collection.name} / ${found.name}`
  }
  return null
})

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
</script>

<template>
  <section class="lane">
    <div class="lane-head">
      <span class="label">{{ lane.label }}</span>

      <select
        :id="`${idStem}-method`"
        v-model="lane.request.method"
        class="method mono"
        :class="lane.request.method.toLowerCase()"
        title="Method"
      >
        <option v-for="method in HTTP_METHODS" :key="method" :value="method">{{ method }}</option>
      </select>

      <input
        :id="`${idStem}-url`"
        v-model="lane.request.url"
        class="url mono"
        placeholder="${BASE_URL}/things"
        spellcheck="false"
        @keydown.enter="sendLane(lane.id)"
      />

      <button
        class="ghost edit"
        title="Edit this lane: environment, headers, body and options"
        @click="emit('edit')"
      >
        <span class="material-icons sm">edit</span>
        Edit
      </button>

      <button
        class="primary send"
        :disabled="lane.sending || !lane.request.url.trim()"
        :title="`Send lane ${lane.label} on its own`"
        @click="sendLane(lane.id)"
      >
        <span class="material-icons sm">{{ lane.sending ? 'hourglass_top' : 'send' }}</span>
      </button>

      <PopMenu icon="more_vert" :title="`Lane ${lane.label} actions`" :width="300">
        <template #default="{ close }">
          <div class="menu-section">This lane</div>
          <button
            class="menu-item"
            :disabled="!canAdd"
            @click="duplicateLane(lane.id), close()"
          >
            <span class="menu-label">Duplicate into a new lane</span>
            <span class="menu-desc">
              {{ canAdd ? 'Same request, ready for one change' : 'The lane limit is reached' }}
            </span>
          </button>
          <button
            class="menu-item danger"
            :disabled="laneCount <= 2"
            @click="removeLane(lane.id), close()"
          >
            <span class="menu-label">Remove lane</span>
            <span class="menu-desc">
              {{ laneCount <= 2 ? 'A comparison needs two' : 'Discards its response' }}
            </span>
          </button>

          <div class="menu-section">Load a saved request</div>
          <template v-for="collection in state.collections" :key="collection.id">
            <button
              v-for="request in collection.requests"
              :key="request.id"
              class="menu-item"
              @click="seedLane(lane.id, request.id), close()"
            >
              <span class="menu-label">{{ request.name }}</span>
              <span class="menu-desc mono">{{ collection.name }}</span>
            </button>
          </template>
          <div v-if="!state.collections.some((c) => c.requests.length)" class="menu-empty faint">
            No saved requests yet.
          </div>
        </template>
      </PopMenu>
    </div>

    <div class="status-bar">
      <template v-if="response">
        <span class="chip" :class="statusClass(response.status)">
          {{ response.status }} {{ response.statusText }}
        </span>
        <span class="metric">{{ response.elapsedMs }} ms</span>
        <span class="metric">{{ formatBytes(response.bytes) }}</span>
      </template>
      <span v-else-if="lane.sending" class="muted">Sending…</span>
      <span v-else-if="error" class="chip red">{{ lane.outcome?.errorChip }}</span>
      <span v-else class="faint">Not sent</span>

      <span v-if="stale" class="stale" title="This lane has been edited since this response arrived">
        <span class="material-icons sm">history</span>
        Stale
      </span>

      <div class="spacer" />

      <!-- Which environment answered is the whole subject of most comparisons,
           so it stays on the lane even though it is edited in the dialog. -->
      <button
        class="ghost env"
        :title="`Lane ${lane.label} resolves against &quot;${environmentName}&quot;. Click to change it.`"
        @click="emit('edit')"
      >
        <span class="material-icons sm">swap_horiz</span>
        <span class="env-name">{{ environmentName }}</span>
      </button>

      <span v-if="sourceName" class="source faint" :title="sourceName">{{ sourceName }}</span>

      <label v-if="response && isJson && !normalize" class="pretty">
        <input :id="`${idStem}-pretty`" v-model="pretty" type="checkbox" />
        Pretty
      </label>
      <button v-if="response" class="ghost copy" @click="copyBody">
        <span class="material-icons sm">{{ copied ? 'check' : 'content_copy' }}</span>
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </div>

    <div class="content">
      <div v-if="error" class="error">
        <strong>
          <span class="material-icons sm">error_outline</span>
          {{ lane.outcome?.errorTitle }}
        </strong>
        <p>{{ error }}</p>
      </div>

      <div v-else-if="!response" class="placeholder faint">
        Send this lane to see its response.
      </div>

      <p v-else-if="response.bodyIsBinary" class="placeholder faint">{{ response.body }}</p>
      <p v-else-if="!response.body" class="placeholder faint">Empty response body.</p>

      <div v-else class="body-wrap">
        <CodeEditor :model-value="displayBody" :language="isJson ? 'json' : 'text'" readonly />
      </div>
    </div>
  </section>
</template>

<style scoped>
/*
 * The URL field is the control that suffers first as lanes narrow, and below
 * about this width it stops being usable. Lanes hold the floor and the row
 * scrolls sideways instead, which keeps the rest of the view still.
 */
.lane {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-width: 450px;
  min-height: 0;
}

.lane + .lane {
  border-left: 1px solid var(--border);
}

.lane-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 4px;
  background: var(--accent-dim);
  color: var(--accent);
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 700;
}

.method {
  flex: none;
  width: 92px;
  font-weight: 700;
  font-size: 12px;
  padding: 5px 6px;
}

.method.get { color: var(--green); }
.method.post { color: var(--accent); }
.method.put { color: var(--amber); }
.method.patch { color: var(--purple); }
.method.delete { color: var(--red); }
.method.options { color: var(--cyan); }
.method.trace { color: var(--pink); }

.url {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
}

.edit {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 9px;
}

.send {
  flex: none;
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
}

.lane .material-icons {
  vertical-align: 0;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  min-height: 38px;
}

.chip {
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  white-space: nowrap;
}

.chip.green { color: var(--green); border-color: var(--green-border); }
.chip.amber { color: var(--amber); border-color: var(--amber-border); }
.chip.red { color: var(--red); border-color: var(--red-border); }
.chip.purple { color: var(--purple); border-color: var(--purple-border); }
.chip.dim { color: var(--text-dim); }

.metric {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--text-dim);
  white-space: nowrap;
}

.stale {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--amber);
  border: 1px solid var(--amber-border);
  border-radius: 4px;
  padding: 1px 6px;
  cursor: help;
  white-space: nowrap;
}

.spacer {
  flex: 1;
}

.env {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  max-width: 150px;
  padding: 2px 7px;
  font-size: 11.5px;
  color: var(--accent);
}

.env-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

.pretty {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--text-dim);
  cursor: pointer;
}

.pretty input {
  accent-color: var(--accent);
}

.copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 3px 7px;
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
  padding: 28px 16px;
  text-align: center;
  font-size: 12.5px;
}

.error {
  padding: 16px;
}

.error strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--red);
  font-size: 13px;
}

.error p {
  margin: 8px 0 0;
  color: var(--text-dim);
  white-space: pre-wrap;
  font-size: 12.5px;
}

.menu-section {
  padding: 8px 10px 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.menu-item {
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

.menu-item:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: transparent;
}

.menu-item.danger:hover:not(:disabled) {
  color: var(--red);
}

.menu-label {
  white-space: nowrap;
}

.menu-desc {
  color: var(--text-faint);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-empty {
  padding: 4px 10px 8px;
  font-size: 12px;
}
</style>
