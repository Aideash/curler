<script setup lang="ts">
import { computed, ref } from 'vue'
import { copyText } from '../lib/clipboard'
import { diffLines, normalizeJson, toUnifiedText } from '../lib/diff'
import { settingNumber } from '../lib/store'

const props = defineProps<{
  left: string
  right: string
  leftLabel: string
  rightLabel: string
  /** Sorts JSON keys before comparing, so field ordering is not reported as a change. */
  normalize: boolean
}>()

const result = computed(() => {
  const left = props.normalize ? normalizeJson(props.left) : props.left
  const right = props.normalize ? normalizeJson(props.right) : props.right
  return diffLines(left, right)
})

/** Hides matching lines, which is what you want the moment a response gets long. */
const changesOnly = ref(false)

const CONTEXT = 2

/**
 * Two lines of context either side of a change. Without it a lone modified
 * line arrives with no indication of which object it sits in.
 */
const visibleRows = computed(() => {
  const rows = result.value.rows
  if (!changesOnly.value) return rows.map((row, index) => ({ row, index, gapBefore: false }))

  const keep = new Set<number>()
  rows.forEach((row, index) => {
    if (row.kind === 'same') return
    for (let at = index - CONTEXT; at <= index + CONTEXT; at += 1) {
      if (at >= 0 && at < rows.length) keep.add(at)
    }
  })

  const indices = [...keep].sort((a, b) => a - b)
  return indices.map((index, position) => ({
    row: rows[index],
    index,
    gapBefore: position > 0 && index !== indices[position - 1] + 1,
  }))
})

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copyDiff() {
  try {
    await copyText(toUnifiedText(result.value, props.leftLabel, props.rightLabel))
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(
      () => (copied.value = false),
      settingNumber('copiedFeedbackDurationMs'),
    )
  } catch {
    copied.value = false
  }
}

const marker: Record<string, string> = {
  same: ' ',
  added: '+',
  removed: '-',
  changed: '~',
}
</script>

<template>
  <div class="diff">
    <div class="diff-bar">
      <span v-if="result.skipped" class="chip amber">Not compared</span>
      <span v-else-if="result.identical" class="chip green">Identical</span>
      <template v-else>
        <span v-if="result.summary.changed" class="count amber">
          {{ result.summary.changed }} changed
        </span>
        <span v-if="result.summary.added" class="count green">
          {{ result.summary.added }} added
        </span>
        <span v-if="result.summary.removed" class="count red">
          {{ result.summary.removed }} removed
        </span>
      </template>

      <div class="spacer" />

      <label v-if="!result.skipped && !result.identical" class="toggle">
        <input id="diff-changes-only" v-model="changesOnly" type="checkbox" />
        Changes only
      </label>
      <button v-if="!result.skipped" class="ghost copy" @click="copyDiff">
        <span class="material-icons sm">{{ copied ? 'check' : 'content_copy' }}</span>
        {{ copied ? 'Copied' : 'Copy diff' }}
      </button>
    </div>

    <div v-if="result.skipped" class="placeholder faint">{{ result.reason }}</div>

    <div v-else class="scroll">
      <div class="head">
        <div class="col-head">{{ leftLabel }}</div>
        <div class="col-head">{{ rightLabel }}</div>
      </div>

      <div class="rows mono">
        <template v-for="entry in visibleRows" :key="entry.index">
          <div v-if="entry.gapBefore" class="gap">
            <span class="faint">unchanged lines hidden</span>
          </div>
          <div class="row" :class="entry.row.kind">
            <span class="no faint">{{ entry.row.leftNo ?? '' }}</span>
            <span class="mark">{{ entry.row.left === null ? '' : marker[entry.row.kind] }}</span>
            <span class="text">{{ entry.row.left ?? '' }}</span>
            <span class="no faint">{{ entry.row.rightNo ?? '' }}</span>
            <span class="mark">{{ entry.row.right === null ? '' : marker[entry.row.kind] }}</span>
            <span class="text">{{ entry.row.right ?? '' }}</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.diff-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 16px;
  border-bottom: 1px solid var(--border);
  min-height: 40px;
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

.chip.green {
  color: var(--green);
  border-color: var(--green-border);
}
.chip.amber {
  color: var(--amber);
  border-color: var(--amber-border);
}

.count {
  font-family: var(--mono);
  font-size: 12px;
}

.count.green {
  color: var(--green);
}
.count.amber {
  color: var(--amber);
}
.count.red {
  color: var(--red);
}

.spacer {
  flex: 1;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
}

.toggle input {
  accent-color: var(--accent);
}

.copy {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 104px;
  justify-content: center;
}

.diff .material-icons {
  vertical-align: 0;
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--bg-input);
}

/*
 * One grid for both columns, so a row's two halves cannot drift apart no matter
 * how long either line is. Line numbers and markers size to content; the text
 * columns split what is left evenly.
 */
.head,
.row {
  display: grid;
  grid-template-columns: 3.5em 1.2em minmax(0, 1fr) 3.5em 1.2em minmax(0, 1fr);
}

.head {
  position: sticky;
  top: 0;
  z-index: 1;
  grid-template-columns: 3.5em 1.2em minmax(0, 1fr) 3.5em 1.2em minmax(0, 1fr);
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border);
}

.col-head {
  grid-column: span 3;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dim);
}

.col-head + .col-head {
  border-left: 1px solid var(--border);
}

.rows {
  padding-bottom: 24px;
}

.row {
  line-height: 1.6;
}

/*
 * Tints are mixed from the theme's own signal colours rather than hard-coded,
 * so every theme gets a wash that suits its background.
 */
.row.added > *:nth-child(n + 4) {
  background: color-mix(in srgb, var(--green) 14%, transparent);
}

.row.removed > *:nth-child(-n + 3) {
  background: color-mix(in srgb, var(--red) 14%, transparent);
}

.row.changed > *:nth-child(-n + 3) {
  background: color-mix(in srgb, var(--red) 11%, transparent);
}

.row.changed > *:nth-child(n + 4) {
  background: color-mix(in srgb, var(--green) 11%, transparent);
}

.no {
  padding: 0 6px;
  text-align: right;
  user-select: none;
  font-size: 11px;
}

.mark {
  text-align: center;
  user-select: none;
  color: var(--text-faint);
}

.row.added .mark {
  color: var(--green);
}
.row.removed .mark {
  color: var(--red);
}
.row.changed .mark {
  color: var(--amber);
}

.text {
  padding-right: 10px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* The divider between the two halves, drawn on the right column's gutter. */
.row > *:nth-child(4) {
  border-left: 1px solid var(--border);
}

.gap {
  padding: 3px 10px;
  background: var(--overlay-soft);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}

.placeholder {
  padding: 32px;
  text-align: center;
}
</style>
