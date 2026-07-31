<script setup lang="ts">
import { computed } from 'vue'
import { emptyKeyValue, type KeyValue } from '../types'
import { describeIssues, inspect } from '../lib/vars'

const props = withDefaults(
  defineProps<{
    rows: KeyValue[]
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
  }>(),
  {
    nameOptions: () => [],
    namePlaceholder: 'Name',
    valuePlaceholder: 'Value',
    variables: () => ({}),
    listId: 'kv-names',
    idPrefix: 'kv',
    defaultName: '',
  },
)

/**
 * A row is only sent once it has both halves, so that is what the checkbox
 * tracks. Anything short of it is inert.
 */
function isUsable(row: KeyValue): boolean {
  return row.name.trim() !== '' && row.value.trim() !== ''
}

/**
 * Untouched: no value, and either no name or still the pre-filled default.
 * The default name has to count as blank here, or the trailing row would look
 * filled in and the list would grow without end.
 */
function isBlank(row: KeyValue): boolean {
  if (row.value.trim() !== '') return false
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
  const last = props.rows[props.rows.length - 1]
  if (!last || !isBlank(last)) props.rows.push(newRow())
}

function remove(index: number) {
  props.rows.splice(index, 1)
  ensureTrailingRow()
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
  for (const row of props.rows) {
    const found = inspect(row.value, props.variables)
    if (found.length) byRow.set(row.id, found)
  }
  return byRow
})

ensureTrailingRow()
</script>

<template>
  <div class="kv">
    <datalist :id="listId">
      <option v-for="option in nameOptions" :key="option" :value="option" />
    </datalist>

    <div
      v-for="(row, index) in rows"
      :key="row.id"
      class="kv-row"
      :class="{ blank: isBlank(row), partial: isPartial(row) }"
    >
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
          v-model="row.value"
          class="mono"
          :placeholder="valuePlaceholder"
          spellcheck="false"
          :class="{ warn: issues.has(row.id) || (isPartial(row) && row.value.trim() === '') }"
          @input="ensureTrailingRow"
        />
        <span
          v-if="issues.has(row.id)"
          class="kv-warn"
          :title="describeIssues(issues.get(row.id) ?? [])"
        >
          {{ issues.get(row.id)?.map((issue) => (issue.kind === 'empty' ? `$${issue.name} empty` : `$${issue.name}`)).join(' ') }}
        </span>
      </div>
      <button
        class="ghost kv-remove"
        title="Remove"
        :disabled="index === rows.length - 1 && isBlank(row)"
        @click="remove(index)"
      >
        <span class="material-icons sm">close</span>
      </button>
    </div>

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
}

.kv-row {
  display: grid;
  grid-template-columns: 24px minmax(140px, 1fr) minmax(180px, 2fr) 28px;
  gap: 6px;
  align-items: center;
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

.kv-remove {
  display: inline-flex;
  padding: 3px;
  line-height: 1;
}

.kv-remove .material-icons {
  vertical-align: 0;
}
</style>
