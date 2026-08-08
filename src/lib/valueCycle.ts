export type CycleDirection = 'next' | 'prev'
export type CycleFormat = 'json' | 'plain'

export interface CycleOptions {
  enumChoices?: readonly string[]
  /** How enum values are written back. GraphQL uses bare identifiers. */
  format?: CycleFormat
}

/** Same normalization as KeyValueEditor.enumSelection. */
export function normalizeEnumSelection(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'string') return parsed
  } catch {
    return trimmed.replace(/^"|"$/g, '')
  }
  return trimmed.replace(/^"|"$/g, '')
}

function encodeEnumChoice(choice: string, format: CycleFormat): string {
  if (!choice) return 'null'
  return format === 'json' ? JSON.stringify(choice) : choice
}

function cycleEnum(
  raw: string,
  direction: CycleDirection,
  choices: readonly string[],
  format: CycleFormat,
): string | null {
  if (choices.length === 0) return null

  const current = normalizeEnumSelection(raw)
  let index = choices.indexOf(current)
  if (index < 0) {
    index = direction === 'next' ? -1 : choices.length
  }

  const step = direction === 'next' ? 1 : -1
  const nextIndex = (index + step + choices.length) % choices.length
  return encodeEnumChoice(choices[nextIndex]!, format)
}

function cycleBoolean(raw: string, _direction: CycleDirection): string | null {
  const trimmed = raw.trim()
  const lower = trimmed.toLowerCase()
  if (lower === 'true') return 'false'
  if (lower === 'false') return 'true'
  return null
}

function cycleInteger(raw: string, direction: CycleDirection): string | null {
  const trimmed = raw.trim()
  if (!/^-?\d+$/.test(trimmed)) return null

  const value = Number(trimmed)
  if (!Number.isSafeInteger(value)) return null

  const step = direction === 'next' ? 1 : -1
  const next = value + step
  if (!Number.isSafeInteger(next)) return null

  return String(next)
}

/**
 * Cycle a scalar value forward or backward. Returns null when the input is not
 * cyclable (plain text, floats, empty, etc.).
 */
export function cycleScalarValue(
  raw: string,
  direction: CycleDirection,
  options?: CycleOptions,
): string | null {
  const format = options?.format ?? 'json'
  const choices = options?.enumChoices
  if (choices && choices.length > 0) {
    const cycled = cycleEnum(raw, direction, choices, format)
    if (cycled !== null) return cycled
  }

  const bool = cycleBoolean(raw, direction)
  if (bool !== null) return bool

  return cycleInteger(raw, direction)
}
