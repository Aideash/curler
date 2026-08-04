import { onUnmounted, ref, type ComputedRef, type InjectionKey, type Ref } from 'vue'

export const INSERT_BLOCKED_MESSAGE = 'Fix query syntax before inserting'

export interface RapidClickHint {
  x: number
  y: number
  message: string
}

export interface InsertBlockedHintContext {
  insertBlocked: ComputedRef<boolean>
  recordBlockedClick: (event: MouseEvent) => void
}

export const INSERT_BLOCKED_HINT_KEY: InjectionKey<InsertBlockedHintContext> =
  Symbol('insertBlockedHint')

export function useRapidClickHint(options?: {
  threshold?: number
  windowMs?: number
  hideMs?: number
}) {
  const threshold = options?.threshold ?? 5
  const windowMs = options?.windowMs ?? 2000
  const hideMs = options?.hideMs ?? 2500

  const hint: Ref<RapidClickHint | null> = ref(null)
  const clicks: number[] = []
  let hideTimer: ReturnType<typeof setTimeout> | undefined

  function reset() {
    clicks.length = 0
  }

  function recordBlockedClick(event: MouseEvent, message: string) {
    const now = Date.now()
    clicks.push(now)
    while (clicks.length > 0 && clicks[0]! < now - windowMs) {
      clicks.shift()
    }
    if (clicks.length >= threshold) {
      clicks.length = 0
      hint.value = { x: event.clientX, y: event.clientY, message }
      clearTimeout(hideTimer)
      hideTimer = setTimeout(() => {
        hint.value = null
      }, hideMs)
    }
  }

  onUnmounted(() => {
    clearTimeout(hideTimer)
  })

  return { hint, recordBlockedClick, reset }
}
