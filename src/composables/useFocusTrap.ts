import { nextTick, onBeforeUnmount, onMounted, type Ref, watch } from 'vue'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

export function queryFocusable(root: HTMLElement): HTMLElement[] {
  // `button` matches even with tabindex="-1", which would put roving-tabindex
  // widgets back into sequential Tab order. tabIndex < 0 means programmatic only.
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0)
}

export type FocusBoundary = 'close' | 'loop' | 'none'

export interface UseFocusTrapOptions {
  /** close: tab past an edge calls onLeave; loop: wrap; none: initial focus + restore only */
  boundary: FocusBoundary
  onLeave?: () => void
  /** Where to send focus when the trap is released; falls back to the pre-open focus. */
  restoreTo?: Ref<HTMLElement | null | undefined>
  /** When set, the trap activates and deactivates with this flag (e.g. an open menu). */
  active?: Ref<boolean>
}

/** Move keyboard focus into a container when it opens. */
export function focusInitial(root: HTMLElement) {
  const autofocus = root.querySelector<HTMLElement>('[autofocus]')
  if (autofocus) {
    autofocus.focus()
    return
  }

  const items = queryFocusable(root)
  if (items.length) {
    items[0].focus()
    return
  }

  if (!root.hasAttribute('tabindex')) root.tabIndex = -1
  root.focus()
}

export function useFocusTrap(
  container: Ref<HTMLElement | null | undefined>,
  options: UseFocusTrapOptions,
) {
  let previousFocus: HTMLElement | null = null
  /** Tab-dismissed modals should advance focus, not snap back to the opener. */
  let skipRestore = false

  function leave(from: HTMLElement, direction: 'forward' | 'backward') {
    const root = container.value
    if (!root) return

    skipRestore = true
    const order = queryFocusable(document.body)
    const index = order.indexOf(from)
    let target: HTMLElement | null = null

    if (direction === 'forward') {
      for (let i = index + 1; i < order.length; i++) {
        if (!root.contains(order[i])) {
          target = order[i]
          break
        }
      }
    } else {
      for (let i = index - 1; i >= 0; i--) {
        if (!root.contains(order[i])) {
          target = order[i]
          break
        }
      }
    }

    options.onLeave?.()

    void nextTick(() => {
      if (target && document.contains(target)) target.focus()
      skipRestore = false
    })
  }

  function onKeydown(event: KeyboardEvent) {
    if (options.boundary === 'none' || event.key !== 'Tab') return
    const root = container.value
    if (!root) return

    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !root.contains(active)) return

    const items = queryFocusable(root)
    if (!items.length) {
      if (options.boundary === 'close') {
        event.preventDefault()
        leave(active, event.shiftKey ? 'backward' : 'forward')
      }
      return
    }

    const first = items[0]
    const last = items[items.length - 1]

    if (event.shiftKey) {
      if (active !== first) return
      event.preventDefault()
      if (options.boundary === 'loop') last.focus()
      else leave(active, 'backward')
      return
    }

    if (active !== last) return
    event.preventDefault()
    if (options.boundary === 'loop') first.focus()
    else leave(active, 'forward')
  }

  function activate() {
    previousFocus =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null

    void nextTick(() => {
      const root = container.value
      if (root) focusInitial(root)
    })

    if (options.boundary !== 'none') document.addEventListener('keydown', onKeydown, true)
  }

  function suppressRestore() {
    skipRestore = true
  }

  function deactivate() {
    if (options.boundary !== 'none') document.removeEventListener('keydown', onKeydown, true)

    if (!skipRestore) {
      const target = options.restoreTo?.value ?? previousFocus
      if (target instanceof HTMLElement && document.contains(target)) target.focus()
    }

    previousFocus = null
    skipRestore = false
  }

  if (options.active) {
    watch(
      options.active,
      (isActive) => {
        if (isActive) activate()
        else deactivate()
      },
      { flush: 'post' },
    )
  } else {
    onMounted(activate)
    onBeforeUnmount(deactivate)
  }

  return { activate, deactivate, suppressRestore }
}
