<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CompareLane from './CompareLane.vue'
import DiffView from './DiffView.vue'
import RequestPanel from './RequestPanel.vue'
import ModalShell from './ModalShell.vue'
import ThemePicker from './ThemePicker.vue'
import TitleBar from './TitleBar.vue'
import TitleBarButton from './TitleBarButton.vue'
import VariablesDialog from './VariablesDialog.vue'
import CurlImportDialog from './CurlImportDialog.vue'
import { navigate } from '../composables/useRoute'
import { compareHeaders, compareMeta } from '../lib/diff'
import { isJsonResponse, prettyBody } from '../lib/response'
import {
  MAX_LANES,
  addLane,
  compare,
  ensureLanes,
  laneVariables,
  sendAll,
  sendLane,
  type Lane,
} from '../lib/compare'
import { copyText } from '../lib/clipboard'
import {
  toCurl,
  variablesForCurlCopy,
  pathVariablesForCurlCopy,
  type CurlCopyMode,
} from '../lib/curl'
import { describeIssues, inspect, resolveUrl } from '../lib/vars'
import { state } from '../lib/store'
import type { EditableScope, RequestModel } from '../types'

type Tab = 'body' | 'headers' | 'meta'
const tab = ref<Tab>('body')

const diff = ref(false)
/** JSON key sorting. On by default: it is the difference between a readable diff and noise. */
const normalize = ref(true)
/** Show only the rows that differ, on the headers and meta tabs. */
const differencesOnly = ref(false)

const editingId = ref<string | null>(null)
const showImport = ref(false)
const showVariables = ref(false)
const variablesScope = ref<EditableScope>('collection')

const lanes = computed(() => compare.lanes)
const canAdd = computed(() => lanes.value.length < MAX_LANES)
const anySending = computed(() => lanes.value.some((lane) => lane.sending))
const anySendable = computed(() => lanes.value.some((lane) => lane.request.url.trim()))

const editing = computed<Lane | null>(
  () => lanes.value.find((lane) => lane.id === editingId.value) ?? null,
)

const editingVariables = computed(() => (editing.value ? laneVariables(editing.value).values : {}))

const editingUrl = computed(() => {
  const lane = editing.value
  if (!lane) return { value: '', issues: [], title: '' }
  // Resolution problems only. A bare `$name` here is literal text that
  // resolves to itself, so flagging the preview as unresolved would be a lie.
  const issues = inspect(lane.request.url, editingVariables.value, true, false)
  return {
    value: resolveUrl(lane.request.url.trim(), editingVariables.value).value,
    issues,
    title: issues.length ? describeIssues(issues) : '',
  }
})

/* Which pair the diff describes. Only relevant past two lanes. */
const leftId = ref('')
const rightId = ref('')

// Keyed on the ids rather than the array, because adding or removing a lane
// mutates that array in place and leaves its reference unchanged.
watch(
  () => lanes.value.map((lane) => lane.id).join(','),
  () => {
    const current = lanes.value
    if (!current.some((lane) => lane.id === leftId.value)) leftId.value = current[0]?.id ?? ''
    if (!current.some((lane) => lane.id === rightId.value) || rightId.value === leftId.value) {
      rightId.value = current.find((lane) => lane.id !== leftId.value)?.id ?? ''
    }
  },
  { immediate: true },
)

// Picking the lane already on the right would otherwise diff a lane against
// itself, so the other side steps aside.
watch(leftId, (value) => {
  if (rightId.value !== value) return
  rightId.value = lanes.value.find((lane) => lane.id !== value)?.id ?? ''
})

const leftLane = computed(() => lanes.value.find((lane) => lane.id === leftId.value) ?? null)
const rightLane = computed(() => lanes.value.find((lane) => lane.id === rightId.value) ?? null)

/**
 * The diff is over text, so the bodies are pretty-printed first whatever the
 * server sent. Comparing one server's minified JSON against another's indented
 * JSON would otherwise report every line as changed.
 */
function bodyFor(lane: Lane | null): string {
  const response = lane?.outcome?.response
  if (!response?.body) return ''
  return isJsonResponse(response) ? prettyBody(response.body) : response.body
}

const diffReady = computed(() =>
  Boolean(leftLane.value?.outcome?.response && rightLane.value?.outcome?.response),
)

const responses = computed(() => lanes.value.map((lane) => lane.outcome?.response ?? null))

const metaRows = computed(() => {
  const rows = compareMeta(responses.value)
  return differencesOnly.value ? rows.filter((row) => row.differs) : rows
})

const headerRows = computed(() => {
  const rows = compareHeaders(responses.value)
  return differencesOnly.value ? rows.filter((row) => row.differs) : rows
})

const columns = computed(() => ({
  gridTemplateColumns: `minmax(140px, 220px) repeat(${lanes.value.length}, minmax(0, 1fr))`,
}))

async function copyCurl(lane: Lane, mode: CurlCopyMode) {
  const set = laneVariables(lane)
  await copyText(
    toCurl(lane.request, variablesForCurlCopy(set, mode), pathVariablesForCurlCopy(set, mode)),
  )
}

function onImported(request: RequestModel) {
  const lane = editing.value
  if (lane) {
    // The lane id and label stay put; only what it sends changes.
    lane.request = { ...request, id: lane.request.id }
    lane.sourceRequestId = null
  }
  showImport.value = false
}

function onKeydown(event: KeyboardEvent) {
  const meta = event.metaKey || event.ctrlKey
  if (meta && event.key === 'Enter') {
    event.preventDefault()
    // Inside the lane editor, send just that lane. It is the request on screen.
    if (editing.value) sendLane(editing.value.id)
    else sendAll()
  }
}

onMounted(() => {
  ensureLanes()
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="compare">
    <TitleBar>
      <TitleBarButton
        back
        icon="arrow_back"
        label="Builder"
        title="Back to the request builder"
        @click="navigate('build')"
      />
      <span class="heading">Compare</span>
      <span class="faint hint"
        >Not saved. Lanes are copies, so editing one leaves your saved requests alone.</span
      >

      <div class="spacer" />

      <TitleBarButton icon="data_object" label="Vars" @click="showVariables = true" />
      <TitleBarButton
        icon="add"
        label="Lane"
        :disabled="!canAdd"
        :title="canAdd ? 'Add a lane' : `The limit is ${MAX_LANES} lanes`"
        @click="addLane()"
      />
      <TitleBarButton
        variant="primary"
        :icon="anySending ? 'hourglass_top' : 'send'"
        :label="anySending ? 'Sending…' : 'Send all'"
        :disabled="anySending || !anySendable"
        @click="sendAll"
      />
      <TitleBarButton
        icon="help_outline"
        label="Help"
        title="How to use curler"
        @click="navigate('help')"
      />
      <ThemePicker />
    </TitleBar>

    <div class="toolbar">
      <div class="tabs">
        <button class="ghost tab" :class="{ active: tab === 'body' }" @click="tab = 'body'">
          Body
        </button>
        <button class="ghost tab" :class="{ active: tab === 'headers' }" @click="tab = 'headers'">
          Headers
        </button>
        <button class="ghost tab" :class="{ active: tab === 'meta' }" @click="tab = 'meta'">
          Meta
        </button>
      </div>

      <div class="toolbar-actions">
        <label v-if="tab !== 'body'" class="toggle">
          <input id="compare-differences-only" v-model="differencesOnly" type="checkbox" />
          Differences only
        </label>

        <template v-if="tab === 'body'">
          <label
            class="toggle"
            title="Sort JSON keys before comparing, so field order is not reported as a change"
          >
            <input id="compare-normalise-json" v-model="normalize" type="checkbox" />
            Normalise JSON
          </label>
          <label
            class="toggle strong"
            title="Off shows the responses independently, which is easier when they are genuinely unrelated"
          >
            <input id="compare-diff" v-model="diff" type="checkbox" />
            Diff
          </label>

          <template v-if="diff && lanes.length > 2">
            <select
              id="compare-diff-left"
              v-model="leftId"
              class="pair"
              title="Left side of the diff"
            >
              <option v-for="lane in lanes" :key="lane.id" :value="lane.id">
                {{ lane.label }}
              </option>
            </select>
            <span class="faint">vs</span>
            <select
              id="compare-diff-right"
              v-model="rightId"
              class="pair"
              title="Right side of the diff"
            >
              <option
                v-for="lane in lanes.filter((item) => item.id !== leftId)"
                :key="lane.id"
                :value="lane.id"
              >
                {{ lane.label }}
              </option>
            </select>
          </template>
        </template>
      </div>
    </div>

    <!-- Body, as a diff ------------------------------------------------- -->
    <DiffView
      v-if="tab === 'body' && diff && diffReady"
      :left="bodyFor(leftLane)"
      :right="bodyFor(rightLane)"
      :left-label="`${leftLane?.label} ${leftLane?.request.url || 'lane'}`"
      :right-label="`${rightLane?.label} ${rightLane?.request.url || 'lane'}`"
      :normalize="normalize"
    />

    <div v-else-if="tab === 'body' && diff" class="placeholder faint">
      Send both lanes to see a diff. Until then, turn Diff off to work on them side by side.
    </div>

    <!-- Body, side by side --------------------------------------------- -->
    <div v-else-if="tab === 'body'" class="lanes">
      <CompareLane
        v-for="lane in lanes"
        :key="lane.id"
        :lane="lane"
        :lane-count="lanes.length"
        :normalize="normalize"
        :can-add="canAdd"
        @edit="editingId = lane.id"
      />
    </div>

    <!-- Headers and meta ------------------------------------------------ -->
    <div v-else class="table-wrap">
      <div class="table">
        <div class="table-head" :style="columns">
          <div class="cell label-cell">{{ tab === 'meta' ? 'Property' : 'Header' }}</div>
          <div v-for="lane in lanes" :key="lane.id" class="cell">
            <span class="label">{{ lane.label }}</span>
            <span class="col-url mono faint" :title="lane.request.url">{{
              lane.request.url || '—'
            }}</span>
          </div>
        </div>

        <div
          v-for="row in tab === 'meta' ? metaRows : headerRows"
          :key="row.label"
          class="table-row"
          :class="{ differs: row.differs }"
          :style="columns"
        >
          <div class="cell label-cell mono">
            <span v-if="row.differs" class="material-icons sm dot">chevron_right</span>
            {{ row.label }}
          </div>
          <div v-for="(value, index) in row.values" :key="index" class="cell mono value">
            <span v-if="value === null" class="faint absent">absent</span>
            <template v-else>{{ value }}</template>
          </div>
        </div>

        <div v-if="!(tab === 'meta' ? metaRows : headerRows).length" class="placeholder faint">
          {{
            responses.some((response) => response)
              ? 'No differences here.'
              : 'Send the lanes to compare them.'
          }}
        </div>
      </div>
    </div>

    <!-- Full editor for one lane --------------------------------------- -->
    <ModalShell
      v-if="editing"
      :title="`Lane ${editing.label}`"
      width="min(1040px, 94vw)"
      @close="editingId = null"
    >
      <div class="lane-env">
        <label class="env-field">
          <span class="faint">Environment</span>
          <select id="lane-environment" v-model="editing.environmentId">
            <option
              v-for="environment in state.environments"
              :key="environment.id"
              :value="environment.id"
            >
              {{ environment.name }}
            </option>
          </select>
        </label>

        <!-- The URL this lane will actually request, so the effect of the
             environment above is visible before sending. -->
        <span class="resolved">
          <span class="faint">Resolves to</span>
          <span
            class="mono"
            :class="{ unresolved: editingUrl.issues.length }"
            :title="editingUrl.title"
          >
            {{ editingUrl.value || '—' }}
          </span>
        </span>
      </div>

      <RequestPanel
        :request="editing.request"
        :variables="editingVariables"
        :sending="editing.sending"
        @send="sendLane(editing.id)"
        @import-curl="showImport = true"
        @copy-curl="copyCurl(editing, $event)"
        @manage-variables="showVariables = true"
      />
    </ModalShell>

    <CurlImportDialog v-if="showImport" @close="showImport = false" @imported="onImported" />

    <VariablesDialog
      v-if="showVariables"
      :initial-scope="variablesScope"
      @close="showVariables = false"
    />
  </div>
</template>

<style scoped>
.compare {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
}

.tabs {
  display: flex;
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

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
  white-space: nowrap;
}

.toggle.strong {
  color: var(--text);
  font-weight: 600;
}

.toggle input {
  accent-color: var(--accent);
}

.pair {
  padding: 3px 6px;
  font-family: var(--mono);
  font-size: 12px;
}

.lanes {
  display: flex;
  flex: 1;
  min-height: 0;
  /*
   * Lanes refuse to shrink past a usable width, so the row scrolls rather than
   * the page: the toolbar and tabs above stay put. Vertical is pinned to hidden
   * because each lane scrolls its own body, and leaving it visible would make
   * the browser promote it to auto and hand us a second scrollbar.
   */
  overflow-x: auto;
  overflow-y: hidden;
}

.placeholder {
  padding: 40px 24px;
  text-align: center;
}

/* Lane editor ------------------------------------------------------------- */

.lane-env {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}

.env-field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  flex: none;
}

.resolved {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  min-width: 0;
}

.resolved .mono {
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resolved .unresolved {
  color: var(--amber);
  cursor: help;
}

/* Headers and meta tables ------------------------------------------------ */

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.table {
  min-width: 100%;
}

.table-head {
  display: grid;
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border);
}

.table-row {
  display: grid;
  border-bottom: 1px solid var(--border);
}

.table-row:hover {
  background: var(--overlay-soft);
}

/* A differing row is the whole point of the table, so it gets the accent. */
.table-row.differs {
  background: color-mix(in srgb, var(--amber) 9%, transparent);
}

.table-row.differs:hover {
  background: color-mix(in srgb, var(--amber) 14%, transparent);
}

.cell {
  padding: 7px 12px;
  min-width: 0;
  font-size: 12.5px;
  overflow-wrap: anywhere;
}

.cell + .cell {
  border-left: 1px solid var(--border);
}

.table-head .cell {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dim);
}

.label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: 4px;
  background: var(--accent-dim);
  color: var(--accent);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
}

.col-url {
  text-transform: none;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.label-cell {
  color: var(--accent);
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.dot {
  color: var(--amber);
  margin-left: -6px;
}

.value {
  color: var(--text-dim);
}

.absent {
  font-style: italic;
}
</style>
