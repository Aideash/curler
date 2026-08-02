import { onBeforeUnmount, onMounted } from 'vue'

/** Move keyboard focus to a skip-link target, making it focusable if needed. */
export function focusSkipTarget(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1
  el.focus({ preventScroll: false })
  el.scrollIntoView({ block: 'nearest' })
}

/** Blur the current control and return focus to the first skip link, if any. */
export function resetTabFocus() {
  const active = document.activeElement
  if (active instanceof HTMLElement) active.blur()

  const firstSkip = document.querySelector<HTMLElement>('.skip-links a')
  firstSkip?.focus()
}

function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

function isResetFocusShortcut(event: KeyboardEvent): boolean {
  if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return false
  // Use physical key codes — on Mac, Option+Shift+S produces "Í" in event.key.
  return event.code === 'Home' || event.code === 'KeyS'
}

function onResetFocusKeydown(event: KeyboardEvent) {
  if (!isResetFocusShortcut(event)) return
  if (isModalOpen()) return

  event.preventDefault()
  resetTabFocus()
}

/** Global shortcut: Alt+Shift+S (or Alt+Shift+Home) resets focus to the skip links. */
export function useResetFocusShortcut() {
  onMounted(() => document.addEventListener('keydown', onResetFocusKeydown))
  onBeforeUnmount(() => document.removeEventListener('keydown', onResetFocusKeydown))
}
