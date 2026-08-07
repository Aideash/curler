import { contentTypeOf, formatBytes } from './response'
import { emptyWorkspace, getSettingNumber } from './settings'
import type { HttpResponse } from '../types'

/**
 * Comparing two responses is mostly a fight against noise. A JSON object has no
 * meaningful key order, so two servers that agree completely can still produce
 * texts that differ on almost every line. Normalising first is what makes the
 * diff say something.
 */

/** Sorts object keys at every depth. Arrays keep their order: reordering one changes meaning. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value === null || typeof value !== 'object') return value

  const source = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) sorted[key] = sortKeysDeep(source[key])
  return sorted
}

/**
 * Indented JSON with keys in a stable order. Text that is not JSON comes back
 * untouched rather than mangled, so this is safe to apply to any body.
 */
export function normalizeJson(text: string): string {
  if (!text.trim()) return text
  try {
    return JSON.stringify(sortKeysDeep(JSON.parse(text)), null, 2)
  } catch {
    return text
  }
}

export type DiffKind = 'same' | 'added' | 'removed' | 'changed'

/** One row of an aligned two-column diff. A null side means the row is absent there. */
export interface DiffRow {
  kind: DiffKind
  left: string | null
  right: string | null
  /** 1-based line numbers in the original texts. */
  leftNo: number | null
  rightNo: number | null
}

export interface DiffSummary {
  same: number
  added: number
  removed: number
  changed: number
}

export interface DiffResult {
  rows: DiffRow[]
  /** True when the inputs were too large to align; `rows` is empty. */
  skipped: boolean
  /** Why it was skipped, ready to show. Empty when it was not. */
  reason: string
  summary: DiffSummary
  identical: boolean
}

function diffMaxChars(): number {
  return getSettingNumber('diffMaxChars', emptyWorkspace())
}

function diffMaxCells(): number {
  return getSettingNumber('diffMaxCells', emptyWorkspace())
}

/** @deprecated Use diffMaxChars() — kept for check scripts that load this module. */
export const MAX_DIFF_CHARS = diffMaxChars()

function emptySummary(): DiffSummary {
  return { same: 0, added: 0, removed: 0, changed: 0 }
}

export function summarize(rows: DiffRow[]): DiffSummary {
  const summary = emptySummary()
  for (const row of rows) summary[row.kind] += 1
  return summary
}

function skip(reason: string): DiffResult {
  return { rows: [], skipped: true, reason, summary: emptySummary(), identical: false }
}

/**
 * A run of removals immediately followed by additions reads far better as
 * modified lines sitting opposite each other than as two separate blocks, so
 * they are paired up as far as the shorter run goes.
 */
function coalesce(removed: DiffRow[], added: DiffRow[]): DiffRow[] {
  const rows: DiffRow[] = []
  const paired = Math.min(removed.length, added.length)

  for (let index = 0; index < paired; index += 1) {
    rows.push({
      kind: 'changed',
      left: removed[index].left,
      right: added[index].right,
      leftNo: removed[index].leftNo,
      rightNo: added[index].rightNo,
    })
  }
  for (let index = paired; index < removed.length; index += 1) rows.push(removed[index])
  for (let index = paired; index < added.length; index += 1) rows.push(added[index])

  return rows
}

/**
 * Longest common subsequence over the lines that are not shared prefix or
 * suffix. Values never exceed min(n, m), which the cell cap keeps well inside
 * 16 bits.
 */
function alignMiddle(
  left: string[],
  right: string[],
  leftOffset: number,
  rightOffset: number,
): DiffRow[] {
  const n = left.length
  const m = right.length

  if (!n && !m) return []

  if (!n || !m) {
    // Nothing to align against: the whole run is one-sided.
    const removed = left.map<DiffRow>((text, index) => ({
      kind: 'removed',
      left: text,
      right: null,
      leftNo: leftOffset + index + 1,
      rightNo: null,
    }))
    const added = right.map<DiffRow>((text, index) => ({
      kind: 'added',
      left: null,
      right: text,
      leftNo: null,
      rightNo: rightOffset + index + 1,
    }))
    return coalesce(removed, added)
  }

  const width = m + 1
  const table = new Uint16Array((n + 1) * width)

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        left[i] === right[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }

  const rows: DiffRow[] = []
  let pendingRemoved: DiffRow[] = []
  let pendingAdded: DiffRow[] = []

  const flush = () => {
    if (pendingRemoved.length || pendingAdded.length) {
      rows.push(...coalesce(pendingRemoved, pendingAdded))
      pendingRemoved = []
      pendingAdded = []
    }
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      flush()
      rows.push({
        kind: 'same',
        left: left[i],
        right: right[j],
        leftNo: leftOffset + i + 1,
        rightNo: rightOffset + j + 1,
      })
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      pendingRemoved.push({
        kind: 'removed',
        left: left[i],
        right: null,
        leftNo: leftOffset + i + 1,
        rightNo: null,
      })
      i += 1
    } else {
      pendingAdded.push({
        kind: 'added',
        left: null,
        right: right[j],
        leftNo: null,
        rightNo: rightOffset + j + 1,
      })
      j += 1
    }
  }

  while (i < n) {
    pendingRemoved.push({
      kind: 'removed',
      left: left[i],
      right: null,
      leftNo: leftOffset + i + 1,
      rightNo: null,
    })
    i += 1
  }
  while (j < m) {
    pendingAdded.push({
      kind: 'added',
      left: null,
      right: right[j],
      leftNo: null,
      rightNo: rightOffset + j + 1,
    })
    j += 1
  }
  flush()

  return rows
}

/** Line-level diff, aligned so the two columns can be rendered side by side. */
export function diffLines(left: string, right: string): DiffResult {
  if (left.length > diffMaxChars() || right.length > diffMaxChars()) {
    return skip(
      `Too large to diff (over ${Math.round(diffMaxChars() / 1000)} KB). Turn the diff off to read the responses side by side.`,
    )
  }

  const leftLines = left.length ? left.split('\n') : []
  const rightLines = right.length ? right.split('\n') : []

  // Shared prefix and suffix are the cheap part, and on two responses from the
  // same API they are usually almost all of it.
  let prefix = 0
  while (
    prefix < leftLines.length &&
    prefix < rightLines.length &&
    leftLines[prefix] === rightLines[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < leftLines.length - prefix &&
    suffix < rightLines.length - prefix &&
    leftLines[leftLines.length - 1 - suffix] === rightLines[rightLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const leftMiddle = leftLines.slice(prefix, leftLines.length - suffix)
  const rightMiddle = rightLines.slice(prefix, rightLines.length - suffix)

  if (leftMiddle.length * rightMiddle.length > diffMaxCells()) {
    return skip(
      'Too different to align line by line. Turn the diff off to read the responses side by side.',
    )
  }

  const rows: DiffRow[] = []

  for (let index = 0; index < prefix; index += 1) {
    rows.push({
      kind: 'same',
      left: leftLines[index],
      right: rightLines[index],
      leftNo: index + 1,
      rightNo: index + 1,
    })
  }

  rows.push(...alignMiddle(leftMiddle, rightMiddle, prefix, prefix))

  for (let index = 0; index < suffix; index += 1) {
    const leftIndex = leftLines.length - suffix + index
    const rightIndex = rightLines.length - suffix + index
    rows.push({
      kind: 'same',
      left: leftLines[leftIndex],
      right: rightLines[rightIndex],
      leftNo: leftIndex + 1,
      rightNo: rightIndex + 1,
    })
  }

  const summary = summarize(rows)

  return {
    rows,
    skipped: false,
    reason: '',
    summary,
    identical: summary.added === 0 && summary.removed === 0 && summary.changed === 0,
  }
}

/** Unified-style text, for pasting a difference into a ticket or a message. */
export function toUnifiedText(
  result: DiffResult,
  leftLabel = 'left',
  rightLabel = 'right',
): string {
  if (result.skipped) return result.reason

  const lines = [`--- ${leftLabel}`, `+++ ${rightLabel}`]
  for (const row of result.rows) {
    if (row.kind === 'same') lines.push(`  ${row.left ?? ''}`)
    else if (row.kind === 'removed') lines.push(`- ${row.left ?? ''}`)
    else if (row.kind === 'added') lines.push(`+ ${row.right ?? ''}`)
    else {
      lines.push(`- ${row.left ?? ''}`)
      lines.push(`+ ${row.right ?? ''}`)
    }
  }
  return lines.join('\n')
}

/* Metadata and headers ---------------------------------------------------- */

/**
 * One comparable fact across every lane. `values` is positional, so index 2
 * holds lane C whether or not lane C has answered yet.
 */
export interface ComparisonRow {
  label: string
  values: (string | null)[]
  differs: boolean
}

function markDiffering(rows: ComparisonRow[]): ComparisonRow[] {
  for (const row of rows) {
    const present = row.values.filter((value) => value !== null)
    row.differs = present.length > 1 && present.some((value) => value !== present[0])
  }
  return rows
}

export function compareMeta(responses: (HttpResponse | null)[]): ComparisonRow[] {
  const pick = <T>(read: (response: HttpResponse) => T): (string | null)[] =>
    responses.map((response) => (response ? String(read(response)) : null))

  const row = (label: string, values: (string | null)[], compare = true): ComparisonRow =>
    compare
      ? markDiffering([{ label, values, differs: false }])[0]
      : { label, values, differs: false }

  return [
    row(
      'Status',
      pick((r) => `${r.status} ${r.statusText}`.trim()),
    ),
    // Reported but never flagged: two requests to two hosts always take
    // different amounts of time, and marking that on every comparison would
    // train you to ignore the marker where it means something.
    row(
      'Time',
      pick((r) => `${r.elapsedMs} ms`),
      false,
    ),
    row(
      'Content type',
      pick((r) => contentTypeOf(r)),
    ),
    row(
      'Size',
      pick((r) => formatBytes(r.bytes)),
    ),
    row(
      'Redirects',
      pick((r) => r.redirectChain.length),
    ),
    row(
      'Truncated',
      pick((r) => (r.truncated ? 'yes' : 'no')),
    ),
    row(
      'Final URL',
      pick((r) => r.finalUrl),
    ),
  ]
}

/**
 * Header names are compared case-insensitively, since the casing a server
 * happens to use is not a difference worth reporting. Repeated names, as in
 * several `set-cookie` lines, are joined rather than dropped.
 */
export function compareHeaders(responses: (HttpResponse | null)[]): ComparisonRow[] {
  const names: string[] = []
  const tables = responses.map((response) => {
    const table = new Map<string, string[]>()
    for (const [name, value] of response?.headers ?? []) {
      const key = name.toLowerCase()
      if (!names.includes(key)) names.push(key)
      const existing = table.get(key)
      if (existing) existing.push(value)
      else table.set(key, [value])
    }
    return table
  })

  names.sort()

  return markDiffering(
    names.map((name) => ({
      label: name,
      values: tables.map((table) => table.get(name)?.join(', ') ?? null),
      differs: false,
    })),
  )
}
