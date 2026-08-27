/**
 * Arrow/Home/End handler for a `role="tablist"`. The focused tab is activated
 * (clicked) so existing click handlers stay the source of truth.
 *
 * Only `[role="tab"]` participates; sibling controls in the same row are left
 * to the normal Tab order.
 */
export function onTablistKeydown(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.target
  if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'tab') return

  const list = event.currentTarget
  if (!(list instanceof HTMLElement)) return

  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])')]
  const index = tabs.indexOf(target)
  if (index < 0) return

  const vertical = list.getAttribute('aria-orientation') === 'vertical'
  let next = -1

  switch (event.key) {
    case 'ArrowRight':
      if (!vertical) next = (index + 1) % tabs.length
      break
    case 'ArrowLeft':
      if (!vertical) next = (index - 1 + tabs.length) % tabs.length
      break
    case 'ArrowDown':
      if (vertical) next = (index + 1) % tabs.length
      break
    case 'ArrowUp':
      if (vertical) next = (index - 1 + tabs.length) % tabs.length
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = tabs.length - 1
      break
    default:
      return
  }

  if (next < 0 || next === index) return
  event.preventDefault()
  tabs[next].focus()
  tabs[next].click()
}
