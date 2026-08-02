<script setup lang="ts">
import { computed, ref } from 'vue'
import VariableIssues from './VariableIssues.vue'
import { emptyKeyValue, type KeyValue } from '../types'
import {
  disableRowSecret,
  enableRowSecret,
  queueSecretSave,
  removeRowSecret,
  secretCache,
} from '../lib/store'
import { braceBareReferences, inspect } from '../lib/vars'
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
  },
)

const root = ref<HTMLElement | null>(null)
const LIST = 'list' as const

/** The trailing blank row stays put; only rows above it move. */
const reorderableLength = computed(() => {
  const last = rows.value[rows.value.length - 1]
  return last && isBlank(last) ? rows.value.length - 1 : rows.value.length
})

const { dragging, startDrag, endDrag, dragOver, drop, dropIndicator, onHandleKeydown } =
  useReorderList({
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
  return row.name.trim() !== '' && valueOf(row).trim() !== ''
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

/** Keeps a blank row at the bottom so there is always somewhere to type. */
function ensureTrailingRow() {
  const last = rows.value[rows.value.length - 1]
  if (!last || !isBlank(last)) rows.value.push(newRow())
}

async function remove(index: number) {
  const row = rows.value[index]
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
    const found = inspect(row.value, props.variables)
    if (found.length) byRow.set(row.id, found)
  }
  return byRow
})

function braceRowReference(row: KeyValue, name: string) {
  row.value = braceBareReferences(row.value, name)
}

function onListDrop(event: DragEvent) {
  if (props.reorderable) drop(LIST, event)
}

function onRowDragOver(index: number, event: DragEvent) {
  if (props.reorderable && index < reorderableLength.value) dragOver(LIST, index, event)
}

ensureTrailingRow()
</script>

<template>
  <div ref="root" class="kv" :class="{ 'with-secrets': allowSecrets, reorderable }">
    <datalist :id="listId">
      <option v-for="option in nameOptions" :key="option" :value="option" />
    </datalist>

    <TransitionGroup
      tag="div"
      name="kv-row"
      class="kv-rows"
      :class="{ 'is-reordering': !!dragging }"
      @dragover.prevent
      @drop="onListDrop"
    >
      <div
        v-for="(row, index) in rows"
        :key="row.id"
        class="kv-row"
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
        <button
          v-if="reorderable && index < reorderableLength"
          class="ghost drag-handle"
          draggable="true"
          :data-row-id="row.id"
          title="Drag to reorder"
          aria-label="Drag to reorder, or press arrow up or down"
          aria-keyshortcuts="ArrowUp ArrowDown"
          @dragstart="startDrag(LIST, index, $event)"
          @dragend="endDrag"
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
          <input
            :id="`${idPrefix}-${index}-value`"
            :value="valueOf(row)"
            class="mono"
            :type="allowSecrets && row.secret ? 'password' : 'text'"
            :placeholder="valuePlaceholder"
            spellcheck="false"
            :class="{
              warn: issues.has(row.id) || (isPartial(row) && valueOf(row).trim() === ''),
            }"
            @input="onValueInput(row, $event)"
          />
          <VariableIssues
            class="kv-warn"
            :issues="issues.get(row.id) ?? []"
            @fix="(name) => braceRowReference(row, name)"
          />
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
          class="ghost kv-remove"
          title="Remove"
          :disabled="index === rows.length - 1 && isBlank(row)"
          @click="remove(index)"
        >
          <span class="material-icons sm">close</span>
        </button>
      </div>
    </TransitionGroup>

    <p v-if="rows.some(isPartial)" class="kv-notice">
      A row needs both a name and a value to be used. Half-filled rows are ignored.
    </p>
  </div>
</template>

<style scoped>
.kv {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-x: auto;
}

.kv-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kv-row {
  display: grid;
  grid-template-columns: 24px minmax(140px, 1fr) minmax(180px, 2fr) 28px;
  gap: 6px;
  align-items: center;
}

.kv.reorderable .kv-row {
  grid-template-columns: 22px 24px minmax(140px, 1fr) minmax(180px, 2fr) 28px;
}

.kv.with-secrets .kv-row {
  grid-template-columns: 24px minmax(140px, 1fr) minmax(180px, 2fr) 28px 28px;
}

.kv.reorderable.with-secrets .kv-row {
  grid-template-columns: 22px 24px minmax(140px, 1fr) minmax(180px, 2fr) 28px 28px;
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

.kv-row:hover .drag-handle,
.kv-row:has(:focus-visible) .drag-handle {
  opacity: 1;
}

.kv-row.dragging {
  opacity: 0.45;
}

.kv-row.drop-before {
  box-shadow: inset 0 2px 0 var(--accent);
}

.kv-row.drop-after {
  box-shadow: inset 0 -2px 0 var(--accent);
}

.kv-row-move {
  transition: transform 0.18s ease;
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

/* An untouched row reads as inactive until there is something in it. */
.kv-row.blank input:not(:focus) {
  opacity: 0.62;
}

.kv-row.partial input.warn {
  border-color: var(--amber-border);
}

.kv-notice {
  margin: 6px 0 0 30px;
  font-size: 12px;
  color: var(--amber);
}

.kv.with-secrets .kv-notice {
  margin-left: 58px;
}

.kv.reorderable .kv-notice {
  margin-left: 52px;
}

.kv.reorderable.with-secrets .kv-notice {
  margin-left: 80px;
}

.kv-value {
  position: relative;
  display: flex;
  align-items: center;
}

.kv-value input {
  width: 100%;
}

.kv-value input.warn {
  border-color: var(--amber-border);
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

.kv-secret,
.kv-remove {
  display: inline-flex;
  padding: 3px;
  line-height: 1;
}

.kv-secret {
  color: var(--text-faint);
}

.kv-secret.active {
  color: var(--accent);
}

.kv-secret:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.kv-remove .material-icons,
.kv-secret .material-icons {
  vertical-align: 0;
}
</style>
