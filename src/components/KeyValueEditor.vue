<script setup lang="ts">
import { computed, nextTick, ref, watch, TransitionGroup } from 'vue'
import MultipartModifiersDialog from './MultipartModifiersDialog.vue'
import VariableIssues from './VariableIssues.vue'
import { emptyKeyValue, type KeyValue, type MultipartPart } from '../types'
import {
  disableRowSecret,
  enableRowSecret,
  queueSecretSave,
  removeRowSecret,
  secretCache,
} from '../lib/store'
import { braceBareReferences, inspect } from '../lib/vars'
import { cycleScalarValue, type CycleDirection } from '../lib/valueCycle'
import { stageLocalFile } from '../lib/backend'
import { reorderItems, useReorderList } from '../composables/useReorderList'

const rows = defineModel<KeyValue[]>('rows', { required: true })

const props = withDefaults(
  defineProps<{
    nameOptions?: string[]
    namePlaceholder?: string
    valuePlaceholder?: string
    variables?: Record<string, string>
    listId?: string
    /**
     * Stem for the row element ids, which are completed with the row index and
     * the field. Has to be unique per editor on screen: several are mounted at
     * once behind the request tabs.
     */
    idPrefix?: string
    /** Pre-fills the name of each new row, as a real value rather than a hint. */
    defaultName?: string
    /**
     * Whether these values have variables substituted into them. False for the
     * lists that *define* variables: a definition's value is replacement text,
     * so a `$` in it means nothing and no reference warning belongs on it.
     */
    resolves?: boolean
    /** Offer the OS keychain toggle for variable definitions. */
    allowSecrets?: boolean
    /** Drag handles and arrow keys reorder rows in the backing array. */
    reorderable?: boolean
    /** When set, rows whose name matches a key render a select of enum values. */
    enumOptions?: Record<string, string[]>
    /** Per-row advisory errors (e.g. multipart path warnings). Does not disable the row. */
    rowAlerts?: Record<string, { message: string }>
    /** Per-row -F vs --form-string toggle for multipart parts. */
    showMultipartKind?: boolean
    /** Offer a file picker that stages to disk and fills `@/abs/path` (-F rows only). */
    showFilePicker?: boolean
    /** Offer a short note under each row (variable definitions). */
    showNotes?: boolean
  }>(),
  {
    nameOptions: () => [],
    namePlaceholder: 'Name',
    valuePlaceholder: 'Value',
    variables: () => ({}),
    listId: 'kv-names',
    idPrefix: 'kv',
    defaultName: '',
    resolves: true,
    allowSecrets: false,
    reorderable: false,
    enumOptions: () => ({}),
    rowAlerts: () => ({}),
    showMultipartKind: false,
    showFilePicker: false,
    showNotes: false,
  },
)

const root = ref<HTMLElement | null>(null)
const LIST = 'list' as const

const listRoot = computed(() => (props.reorderable ? TransitionGroup : 'div'))

/** The trailing blank row stays put; only rows above it move. */
const reorderableLength = computed(() => {
  const last = rows.value[rows.value.length - 1]
  return last && isBlank(last) ? rows.value.length - 1 : rows.value.length
})

const {
  dragging,
  startDrag,
  endDrag,
  dragOver,
  dragOverContainer,
  drop,
  dropIndicator,
  onHandleKeydown,
} = useReorderList({
  reorder: (_group, from, to) => {
    if (!props.reorderable) return
    reorderItems(rows.value, from, to)
  },
  root,
  handleSelector: (rowId) => `.drag-handle[data-row-id="${rowId}"]`,
})

function valueOf(row: KeyValue): string {
  return props.allowSecrets && row.secret ? (secretCache[row.id] ?? '') : row.value
}

/**
 * A row is only sent once it has both halves, so that is what the checkbox
 * tracks. Anything short of it is inert.
 */
function isUsable(row: KeyValue): boolean {
  if (row.name.trim() === '') return false
  if (valueOf(row).trim() !== '') return true
  return row.defined === true
}

/**
 * Untouched: no value, and either no name or still the pre-filled default.
 * The default name has to count as blank here, or the trailing row would look
 * filled in and the list would grow without end.
 */
function isBlank(row: KeyValue): boolean {
  if (valueOf(row).trim() !== '') return false
  const name = row.name.trim()
  return name === '' || (props.defaultName !== '' && name === props.defaultName)
}

/** Half-filled, so it will be ignored. Worth pointing at. */
function isPartial(row: KeyValue): boolean {
  return !isUsable(row) && !isBlank(row)
}

function newRow(): KeyValue {
  return { ...emptyKeyValue(), name: props.defaultName }
}

/** Keeps exactly one blank row at the bottom; drops blank rows inserted above real rows. */
function ensureTrailingRow() {
  const nonBlank = rows.value.filter((row) => !isBlank(row))
  const trailing = rows.value.find((row) => isBlank(row)) ?? newRow()
  const next = [...nonBlank, trailing]

  if (next.length === rows.value.length && next.every((row, index) => row === rows.value[index])) {
    return
  }

  rows.value = next
}

watch(
  rows,
  () => {
    ensureTrailingRow()
  },
  { deep: true, flush: 'sync' },
)

async function remove(index: number) {
  const row = rows.value[index]
  if (editingNoteId.value === row.id) {
    editingNoteId.value = null
    noteDraft.value = ''
  }
  if (props.allowSecrets && row.secret && isUsable(row)) {
    const ok = window.confirm(
      'This secret is stored in your OS keychain and will be deleted. It cannot be recovered. Remove anyway?',
    )
    if (!ok) return
    await removeRowSecret(row.id)
  }
  rows.value.splice(index, 1)
  ensureTrailingRow()
}

function onValueInput(row: KeyValue, event: Event) {
  const next = (event.target as HTMLInputElement).value
  row.defined = true
  if (props.allowSecrets && row.secret) queueSecretSave(row.id, next)
  else row.value = next
  ensureTrailingRow()
}

async function toggleSecret(row: KeyValue) {
  if (row.secret) {
    if (!window.confirm('This value will be stored in plaintext in workspace.json. Continue?')) {
      return
    }
    try {
      await disableRowSecret(row)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    }
    return
  }

  try {
    await enableRowSecret(row)
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Selecting the pre-filled name on focus lets it behave like a placeholder:
 * typing replaces it outright, while a second click drops a caret in to edit.
 */
function selectDefaultName(row: KeyValue, event: FocusEvent) {
  if (props.defaultName === '' || row.name !== props.defaultName) return
  ;(event.target as HTMLInputElement).select()
}

const issues = computed(() => {
  const byRow = new Map<string, ReturnType<typeof inspect>>()
  if (!props.resolves) return byRow
  for (const row of rows.value) {
    if (props.rowAlerts[row.id]) continue
    const found = inspect(row.value, props.variables)
    if (found.length) byRow.set(row.id, found)
  }
  return byRow
})

function braceRowReference(row: KeyValue, name: string) {
  row.value = braceBareReferences(row.value, name)
}

function enumChoices(row: KeyValue): string[] | undefined {
  const name = row.name.trim()
  if (!name) return undefined
  return props.enumOptions[name]
}

function enumSelection(row: KeyValue): string {
  const raw = valueOf(row).trim()
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
  } catch {
    return raw.replace(/^"|"$/g, '')
  }
  return ''
}

function onEnumSelect(row: KeyValue, event: Event) {
  const selected = (event.target as HTMLSelectElement).value
  row.defined = true
  row.value = selected ? JSON.stringify(selected) : 'null'
  ensureTrailingRow()
}

function applyCycledValue(row: KeyValue, next: string) {
  row.defined = true
  if (props.allowSecrets && row.secret) queueSecretSave(row.id, next)
  else row.value = next
  ensureTrailingRow()
}

function onValueCycleKeydown(row: KeyValue, event: KeyboardEvent) {
  if (!event.altKey || event.key !== 'Enter' || event.metaKey || event.ctrlKey) return
  event.preventDefault()
  const direction: CycleDirection = event.shiftKey ? 'prev' : 'next'
  const next = cycleScalarValue(valueOf(row), direction, { enumChoices: enumChoices(row) })
  if (next === null) return
  applyCycledValue(row, next)
}

function multipartTextOnly(row: KeyValue): boolean {
  return Boolean((row as MultipartPart).textOnly)
}

function setMultipartTextOnly(row: KeyValue, textOnly: boolean) {
  ;(row as MultipartPart).textOnly = textOnly || undefined
}

function multipartPart(row: KeyValue): MultipartPart {
  return row as MultipartPart
}

function hasMultipartModifiers(row: KeyValue): boolean {
  const part = multipartPart(row)
  return Boolean(part.contentType?.trim() || part.filename?.trim())
}

const modifiersTarget = ref<MultipartPart | null>(null)

function openMultipartModifiers(row: KeyValue) {
  if (isBlank(row)) return
  modifiersTarget.value = multipartPart(row)
}

function closeMultipartModifiers() {
  modifiersTarget.value = null
}

function saveMultipartModifiers(values: { contentType?: string; filename?: string }) {
  const part = modifiersTarget.value
  if (!part) return
  part.contentType = values.contentType
  part.filename = values.filename
  closeMultipartModifiers()
}

const editingNoteId = ref<string | null>(null)
const noteDraft = ref('')
const noteInput = ref<HTMLInputElement | null>(null)

function bindNoteInput(el: unknown, rowId: string) {
  if (editingNoteId.value === rowId) {
    noteInput.value = (el as HTMLInputElement | null) ?? null
  }
}

function hasNote(row: KeyValue): boolean {
  return Boolean(row.note?.trim())
}

function showNoteSlot(row: KeyValue): boolean {
  return props.showNotes && (editingNoteId.value === row.id || hasNote(row))
}

async function openNoteEdit(row: KeyValue) {
  if (isBlank(row)) return
  if (editingNoteId.value === row.id) {
    noteInput.value?.focus()
    return
  }
  if (editingNoteId.value) {
    const previous = rows.value.find((item) => item.id === editingNoteId.value)
    if (previous) commitNote(previous)
  }
  editingNoteId.value = row.id
  noteDraft.value = row.note ?? ''
  await nextTick()
  noteInput.value?.focus()
  noteInput.value?.select()
}

function commitNote(row: KeyValue) {
  if (editingNoteId.value !== row.id) return
  const trimmed = noteDraft.value.trim()
  row.note = trimmed || undefined
  editingNoteId.value = null
  noteDraft.value = ''
}

function onNoteKeydown(row: KeyValue, event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    commitNote(row)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    editingNoteId.value = null
    noteDraft.value = ''
  }
}

const fileInput = ref<HTMLInputElement | null>(null)
const filePickTarget = ref<KeyValue | null>(null)
const stagingFile = ref(false)

function openFilePicker(row: KeyValue) {
  if (stagingFile.value || multipartTextOnly(row)) return
  filePickTarget.value = row
  fileInput.value?.click()
}

async function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const row = filePickTarget.value
  filePickTarget.value = null
  if (!file || !row) return

  stagingFile.value = true
  try {
    const stagedPath = await stageLocalFile(file)
    row.defined = true
    row.value = `@${stagedPath}`
    ensureTrailingRow()
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error))
  } finally {
    stagingFile.value = false
  }
}

function onListDrop(event: DragEvent) {
  if (props.reorderable) drop(LIST, event)
}

function onListDragOver(event: DragEvent) {
  if (props.reorderable) dragOverContainer(LIST, reorderableLength.value, event)
}

function onRowDragOver(index: number, event: DragEvent) {
  if (props.reorderable && index < reorderableLength.value) dragOver(LIST, index, event)
}

ensureTrailingRow()
</script>

<template>
  <div
    ref="root"
    class="kv"
    :class="{
      'with-secrets': allowSecrets,
      'with-multipart-kind': showMultipartKind,
      'with-notes': showNotes,
      reorderable,
    }"
  >
    <datalist :id="listId">
      <option v-for="option in nameOptions" :key="option" :value="option" />
    </datalist>

    <input
      ref="fileInput"
      type="file"
      class="kv-file-input"
      tabindex="-1"
      aria-hidden="true"
      @change="onFilePicked"
    />

    <component
      :is="listRoot"
      tag="div"
      :name="reorderable ? 'kv-row' : undefined"
      class="kv-rows"
      data-reorder-list
      :class="{ 'is-reordering': reorderable && !!dragging }"
      @dragover="onListDragOver"
      @drop="onListDrop"
    >
      <div
        v-for="(row, index) in rows"
        :key="row.id"
        class="kv-item"
        :data-reorder-row="reorderable && index < reorderableLength ? '' : undefined"
        :class="{
          blank: isBlank(row),
          partial: isPartial(row),
          secret: row.secret,
          dragging: reorderable && dragging?.fromIndex === index,
          'drop-before': reorderable && dropIndicator(LIST, index, reorderableLength) === 'before',
          'drop-after': reorderable && dropIndicator(LIST, index, reorderableLength) === 'after',
        }"
        @dragover="onRowDragOver(index, $event)"
      >
        <div class="kv-row">
          <button
            v-if="reorderable && index < reorderableLength"
            class="ghost drag-handle"
            draggable="true"
            :data-row-id="row.id"
            title="Drag to reorder"
            aria-label="Drag to reorder, or press arrow up or down"
            aria-keyshortcuts="ArrowUp ArrowDown"
            @dragstart="startDrag(LIST, index, $event)"
            @dragend="endDrag($event)"
            @keydown="onHandleKeydown(LIST, index, row.id, reorderableLength, $event)"
          >
            <span class="material-icons sm">drag_indicator</span>
          </button>
          <span v-else-if="reorderable" class="drag-spacer" aria-hidden="true" />
          <input
            :id="`${idPrefix}-${index}-enabled`"
            v-model="row.enabled"
            type="checkbox"
            class="kv-toggle"
            :disabled="!isUsable(row)"
            :title="
              isUsable(row)
                ? row.enabled
                  ? 'Enabled'
                  : 'Disabled'
                : isBlank(row)
                  ? 'Nothing to enable yet'
                  : row.name.trim() === ''
                    ? 'Needs a name before it can be used'
                    : 'Needs a value before it can be used'
            "
          />
          <div
            v-if="showMultipartKind && !isBlank(row)"
            class="kv-kind"
            role="group"
            :aria-label="`Part ${row.name.trim() || 'type'}: curl -F or --form-string`"
          >
            <button
              type="button"
              class="kv-kind-btn"
              :class="{ active: !multipartTextOnly(row) }"
              title="curl -F: @path reads a file from disk"
              @click="setMultipartTextOnly(row, false)"
            >
              -F
            </button>
            <button
              type="button"
              class="kv-kind-btn"
              :class="{ active: multipartTextOnly(row) }"
              title="curl --form-string: value is literal text, @ is not special"
              @click="setMultipartTextOnly(row, true)"
            >
              str
            </button>
          </div>
          <span v-else-if="showMultipartKind" class="kv-kind-spacer" aria-hidden="true" />
          <input
            :id="`${idPrefix}-${index}-name`"
            v-model="row.name"
            class="mono"
            :list="listId"
            :placeholder="namePlaceholder"
            spellcheck="false"
            :class="{ warn: isPartial(row) && row.name.trim() === '' }"
            @focus="selectDefaultName(row, $event)"
            @input="ensureTrailingRow"
          />
          <div class="kv-value">
            <button
              v-if="showMultipartKind && !isBlank(row)"
              type="button"
              class="ghost kv-modifiers"
              :class="{ active: hasMultipartModifiers(row) }"
              title="Part modifiers (;type=, ;filename=)"
              @click="openMultipartModifiers(row)"
            >
              <span class="material-icons sm">tune</span>
            </button>
            <button
              v-if="showFilePicker && !isBlank(row) && !multipartTextOnly(row)"
              type="button"
              class="ghost kv-file"
              :disabled="stagingFile"
              title="Pick a file — copied to CURLER_HOME staging as an @/path"
              @click="openFilePicker(row)"
            >
              <span class="material-icons sm">attach_file</span>
            </button>
            <select
              v-if="enumChoices(row)"
              :id="`${idPrefix}-${index}-value`"
              class="mono kv-enum"
              :value="enumSelection(row)"
              :class="{ warn: isPartial(row) && !enumSelection(row) }"
              @change="onEnumSelect(row, $event)"
              @keydown="onValueCycleKeydown(row, $event)"
            >
              <option value="" disabled>Select…</option>
              <option v-for="choice in enumChoices(row)" :key="choice" :value="choice">
                {{ choice }}
              </option>
            </select>
            <input
              v-else
              :id="`${idPrefix}-${index}-value`"
              :value="valueOf(row)"
              class="mono"
              :type="allowSecrets && row.secret ? 'password' : 'text'"
              :placeholder="valuePlaceholder"
              spellcheck="false"
              :class="{
                warn: issues.has(row.id) || (isPartial(row) && valueOf(row).trim() === ''),
                error: Boolean(rowAlerts[row.id]),
              }"
              :title="rowAlerts[row.id]?.message"
              @input="onValueInput(row, $event)"
              @keydown.enter="onValueInput(row, $event)"
              @keydown="onValueCycleKeydown(row, $event)"
            />
            <VariableIssues
              v-if="!enumChoices(row) && !rowAlerts[row.id]"
              class="kv-warn"
              :issues="issues.get(row.id) ?? []"
              @fix="(name) => braceRowReference(row, name)"
            />
            <span v-else-if="rowAlerts[row.id]" class="kv-alert" :title="rowAlerts[row.id].message">
              {{ rowAlerts[row.id].message }}
            </span>
          </div>
          <button
            v-if="allowSecrets"
            class="ghost kv-secret"
            :class="{ active: row.secret }"
            title="Secure secret"
            :disabled="isBlank(row) && !row.secret"
            @click="toggleSecret(row)"
          >
            <span class="material-icons sm">{{ row.secret ? 'lock' : 'lock_open' }}</span>
          </button>
          <button
            v-if="showNotes"
            type="button"
            class="ghost kv-note-btn"
            :class="{ active: hasNote(row) }"
            title="Note"
            :disabled="isBlank(row)"
            @click="openNoteEdit(row)"
          >
            <span class="material-icons sm">note_alt</span>
          </button>
          <button
            class="ghost kv-remove"
            title="Remove"
            :disabled="index === rows.length - 1 && isBlank(row)"
            @click="remove(index)"
          >
            <span class="material-icons sm">close</span>
          </button>
        </div>
        <div v-if="showNoteSlot(row)" class="kv-note">
          <input
            v-if="editingNoteId === row.id"
            :id="`${idPrefix}-${index}-note`"
            :ref="(el) => bindNoteInput(el, row.id)"
            v-model="noteDraft"
            type="text"
            class="kv-note-input"
            placeholder="Short note"
            maxlength="200"
            spellcheck="true"
            @blur="commitNote(row)"
            @keydown="onNoteKeydown(row, $event)"
          />
          <p v-else class="kv-note-text">{{ row.note }}</p>
        </div>
      </div>
    </component>

    <p v-if="rows.some(isPartial)" class="kv-notice">
      A row needs both a name and a value to be used. Half-filled rows are ignored.
      <span v-if="rows.every((row) => !!row.name || !row.defined)"
        >Press Enter in the value input to accept empty values.</span
      >
    </p>

    <MultipartModifiersDialog
      v-if="modifiersTarget"
      :part-name="modifiersTarget.name"
      :content-type="modifiersTarget.contentType ?? ''"
      :filename="modifiersTarget.filename ?? ''"
      @close="closeMultipartModifiers"
      @save="saveMultipartModifiers"
    />
  </div>
</template>

<style scoped>
.kv {
  display: flex;
  flex-direction: column;
  gap: 0px;
  overflow-x: auto;
}

.kv-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kv-item {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

.kv-row {
  display: grid;
  grid-template-columns: 24px minmax(140px, 1fr) minmax(180px, 2fr) 28px;
  gap: 6px;
  align-items: center;
  padding: 2px 0px;
  max-height: 33px; /* font-size 12.5, padding (2px + 6px) + border 1px top and bottom - rounded to prevent fractional pixel anomalies */
}

.kv.with-multipart-kind .kv-row {
  grid-template-columns: 24px 74px minmax(120px, 1fr) minmax(160px, 2fr) 28px;
}

.kv.reorderable .kv-row {
  grid-template-columns: 22px 24px minmax(140px, 1fr) minmax(180px, 2fr) 28px;
}

.kv.reorderable.with-multipart-kind .kv-row {
  grid-template-columns: 22px 24px 74px minmax(120px, 1fr) minmax(160px, 2fr) 28px;
}

.kv.with-secrets .kv-row {
  grid-template-columns: 24px minmax(140px, 1fr) minmax(180px, 2fr) 28px 28px;
}

.kv.with-secrets.with-multipart-kind .kv-row {
  grid-template-columns: 24px 74px minmax(120px, 1fr) minmax(160px, 2fr) 28px 28px;
}

.kv.reorderable.with-secrets .kv-row {
  grid-template-columns: 22px 24px minmax(140px, 1fr) minmax(180px, 2fr) 28px 28px;
}

.kv.reorderable.with-secrets.with-multipart-kind .kv-row {
  grid-template-columns: 22px 24px 74px minmax(120px, 1fr) minmax(160px, 2fr) 28px 28px;
}

.kv.with-notes .kv-row {
  grid-template-columns: 24px minmax(140px, 1fr) minmax(180px, 2fr) 28px 28px;
}

.kv.with-notes.with-multipart-kind .kv-row {
  grid-template-columns: 24px 74px minmax(120px, 1fr) minmax(160px, 2fr) 28px 28px;
}

.kv.reorderable.with-notes .kv-row {
  grid-template-columns: 22px 24px minmax(140px, 1fr) minmax(180px, 2fr) 28px 28px;
}

.kv.reorderable.with-notes.with-multipart-kind .kv-row {
  grid-template-columns: 22px 24px 74px minmax(120px, 1fr) minmax(160px, 2fr) 28px 28px;
}

.kv.with-secrets.with-notes .kv-row {
  grid-template-columns: 24px minmax(140px, 1fr) minmax(180px, 2fr) 28px 28px 28px;
}

.kv.with-secrets.with-notes.with-multipart-kind .kv-row {
  grid-template-columns: 24px 74px minmax(120px, 1fr) minmax(160px, 2fr) 28px 28px 28px;
}

.kv.reorderable.with-secrets.with-notes .kv-row {
  grid-template-columns: 22px 24px minmax(140px, 1fr) minmax(180px, 2fr) 28px 28px 28px;
}

.kv.reorderable.with-secrets.with-notes.with-multipart-kind .kv-row {
  grid-template-columns: 22px 24px 74px minmax(120px, 1fr) minmax(160px, 2fr) 28px 28px 28px;
}

.drag-handle {
  opacity: 0;
  padding: 0 1px;
  color: var(--text-faint);
  cursor: grab;
  flex-shrink: 0;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-spacer {
  width: 22px;
}

.kv-item:hover .drag-handle,
.kv-item:has(:focus-visible) .drag-handle {
  opacity: 1;
}

.kv-item.dragging {
  opacity: 0.45;
}

.kv-item.drop-before {
  box-shadow: inset 0 2px 0 var(--accent);
}

.kv-item.drop-after {
  box-shadow: inset 0 -2px 0 var(--accent);
}

.kv-row-move {
  transition: transform 0.18s ease;
}

.kv-rows.is-reordering .kv-row-move {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .kv-row-move {
    transition: none;
  }
}

.kv-toggle {
  min-width: 0;
  padding: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.kv-toggle:disabled {
  cursor: not-allowed;
  opacity: 0.3;
}

.kv-toggle:focus-visible {
  outline: 1px solid var(--accent);
}

/* An untouched row reads as inactive until there is something in it. */
.kv-item.blank .kv-row input:not(:focus) {
  opacity: 0.62;
}

.kv-item.partial .kv-row input.warn {
  border-color: var(--amber-border);
}

.kv-notice {
  margin: 6px 0 0 30px;
  font-size: 12px;
  color: var(--amber);
}

.kv.with-secrets .kv-notice,
.kv.with-notes .kv-notice {
  margin-left: 58px;
}

.kv.with-secrets.with-notes .kv-notice {
  margin-left: 86px;
}

.kv.reorderable .kv-notice {
  margin-left: 52px;
}

.kv.reorderable.with-secrets .kv-notice,
.kv.reorderable.with-notes .kv-notice {
  margin-left: 80px;
}

.kv.reorderable.with-secrets.with-notes .kv-notice {
  margin-left: 108px;
}

.kv-kind {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.kv-kind-btn {
  padding: 2px 6px;
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-faint);
  background: var(--bg-input);
  border: none;
  border-radius: 0;
}

.kv-kind-btn + .kv-kind-btn {
  border-left: 1px solid var(--border);
}

.kv-kind-btn.active {
  color: var(--text);
  background: var(--bg-hover);
}

.kv-kind-btn:hover:not(.active) {
  color: var(--text);
  background: var(--bg-hover);
}

.kv-kind-spacer {
  width: 74px;
}

.kv-value {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.kv-value input,
.kv-value .kv-enum {
  flex: 1;
  min-width: 0;
}

.kv-file-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.kv-modifiers,
.kv-file {
  flex-shrink: 0;
  padding: 2px;
  line-height: 1;
  color: var(--text-faint);
}

.kv-modifiers:hover,
.kv-file:hover:not(:disabled) {
  color: var(--text);
}

.kv-modifiers.active {
  color: var(--accent);
}

.kv-file:disabled {
  opacity: 0.4;
  cursor: wait;
}

.kv-enum {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--text);
  font-size: 13px;
}

.kv-enum.warn {
  border-color: var(--amber-border);
}

.kv-value input.warn {
  border-color: var(--amber-border);
}

.kv-value input.error {
  border-color: color-mix(in srgb, var(--red) 55%, var(--border));
}

.kv-warn {
  position: absolute;
  right: 8px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--amber);
  pointer-events: none;
  background: var(--bg-input);
  padding-left: 6px;
}

.kv-alert {
  position: absolute;
  right: 8px;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--red);
  pointer-events: none;
  background: var(--bg-input);
  padding-left: 6px;
}

.kv-secret,
.kv-note-btn,
.kv-remove {
  display: inline-flex;
  padding: 3px;
  line-height: 1;
}

.kv-secret,
.kv-note-btn {
  color: var(--text-faint);
}

.kv-secret.active,
.kv-note-btn.active {
  color: var(--accent);
}

.kv-secret:disabled,
.kv-note-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.kv-remove .material-icons,
.kv-secret .material-icons,
.kv-note-btn .material-icons {
  vertical-align: 0;
}

.kv-note {
  padding: 0 34px 2px 30px;
  min-width: 0;
}

.kv.reorderable .kv-note {
  padding-left: 52px;
}

.kv.with-secrets.with-notes .kv-note {
  padding-right: 62px;
}

.kv-note-text {
  margin: 0;
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-faint);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  word-break: break-word;
}

.kv-note-input {
  width: 100%;
  min-width: 0;
  padding: 2px 6px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--text);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

/* .kv-row-move,
.kv-row-enter-active,
.kv-row-leave-active {
  transition: all 0.5s ease;
} */

/* .kv-row-enter-from,
.kv-row-leave-to {
  opacity: 0;
  max-height: 0;
} */

/* ensure leaving items are taken out of layout flow so that moving
   animations can be calculated correctly. */
/* .kv-row-leave-active {
  position: absolute;
} */
</style>
