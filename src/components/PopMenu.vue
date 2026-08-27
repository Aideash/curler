<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { queryFocusable, useFocusTrap } from '../composables/useFocusTrap'

const props = withDefaults(
  defineProps<{
    label?: string
    /** Material icon ligature name, rendered before the label. */
    icon?: string
    title?: string
    width?: number
    align?: 'left' | 'right'
  }>(),
  { label: '', icon: '', title: '', width: 320, align: 'right' },
)

const open = ref(false)
const trigger = ref<HTMLButtonElement>()
const panel = ref<HTMLDivElement>()
const style = ref<Record<string, string>>({})
const menuId = useId()

/**
 * The menu is teleported to the body and positioned in viewport coordinates.
 * Rendering it in place would let the scrolling panes it lives inside clip it,
 * which no amount of z-index can undo.
 */
function position() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return

  const margin = 8
  const left =
    props.align === 'right'
      ? Math.min(rect.right - props.width, window.innerWidth - props.width - margin)
      : rect.left
  const maxHeight = window.innerHeight - rect.bottom - margin * 2

  style.value = {
    top: `${rect.bottom + 4}px`,
    left: `${Math.max(margin, left)}px`,
    width: `${props.width}px`,
    maxHeight: `${Math.max(160, maxHeight)}px`,
  }
}

function toggle() {
  open.value = !open.value
  if (open.value) nextTick(position)
}

function close() {
  open.value = false
}

function onPointerDown(event: MouseEvent) {
  if (!open.value) return
  const target = event.target as Node
  if (trigger.value?.contains(target) || panel.value?.contains(target)) return
  close()
}

function menuItems(): HTMLElement[] {
  const root = panel.value
  if (!root) return []
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    ),
  ]
}

function decorateMenu() {
  const root = panel.value
  if (!root) return
  for (const button of root.querySelectorAll('button')) {
    if (!button.hasAttribute('role')) button.setAttribute('role', 'menuitem')
  }
}

function applyRoving(focusEl: HTMLElement | null) {
  const items = menuItems()
  const active = focusEl && items.includes(focusEl) ? focusEl : items[0]
  for (const item of items) {
    item.tabIndex = item === active ? 0 : -1
  }
}

function move(offset: number) {
  const items = menuItems()
  if (!items.length) return
  const active = document.activeElement
  const index = active instanceof HTMLElement ? items.indexOf(active) : -1
  const from = index < 0 ? 0 : index
  const next = items[(from + offset + items.length) % items.length]
  applyRoving(next)
  next.focus()
}

const trap = useFocusTrap(panel, {
  boundary: 'none',
  active: open,
  restoreTo: trigger,
})

function focusAfterTrigger(direction: 'forward' | 'backward') {
  const origin = trigger.value
  if (!origin) return
  const order = queryFocusable(document.body)
  const index = order.indexOf(origin)
  if (index < 0) return
  if (direction === 'forward') {
    for (let i = index + 1; i < order.length; i++) {
      if (!panel.value?.contains(order[i])) {
        order[i].focus()
        return
      }
    }
  } else {
    for (let i = index - 1; i >= 0; i--) {
      if (!panel.value?.contains(order[i])) {
        order[i].focus()
        return
      }
    }
  }
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value) return
  const target = event.target
  if (!(target instanceof Node)) return
  const inside = panel.value?.contains(target) || trigger.value?.contains(target)
  if (!inside) return

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    close()
    return
  }

  if (event.key === 'Tab') {
    event.preventDefault()
    event.stopImmediatePropagation()
    trap.suppressRestore()
    close()
    void nextTick(() => focusAfterTrigger(event.shiftKey ? 'backward' : 'forward'))
    return
  }

  if (!panel.value?.contains(target)) return

  const inField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  if (inField && (event.key === 'Home' || event.key === 'End')) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
    return
  }
  if (event.key === 'Home') {
    event.preventDefault()
    const items = menuItems()
    if (!items.length) return
    applyRoving(items[0])
    items[0].focus()
    return
  }
  if (event.key === 'End') {
    event.preventDefault()
    const items = menuItems()
    if (!items.length) return
    const last = items[items.length - 1]
    applyRoving(last)
    last.focus()
  }
}

function onScroll(event: Event) {
  if (!open.value) return
  const target = event.target as Node
  if (panel.value?.contains(target)) return
  close()
}

watch(
  panel,
  (root) => {
    if (!root) return
    decorateMenu()
    applyRoving(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  },
  { flush: 'post' },
)

onMounted(() => {
  window.addEventListener('mousedown', onPointerDown, true)
  document.addEventListener('keydown', onKeydown, true)
  window.addEventListener('resize', close)
  window.addEventListener('scroll', onScroll, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onPointerDown, true)
  document.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('scroll', onScroll, true)
})

defineExpose({ close })
</script>

<template>
  <button
    ref="trigger"
    class="ghost"
    :class="{ 'icon-only': icon && !label }"
    :title="title || undefined"
    :aria-label="title || label || undefined"
    aria-haspopup="menu"
    :aria-expanded="open"
    :aria-controls="open ? menuId : undefined"
    @click="toggle"
  >
    <span v-if="icon" class="material-icons sm" aria-hidden="true">{{ icon }}</span>
    <span v-if="label">{{ label }}</span>
    <span v-if="label" class="material-icons sm caret" aria-hidden="true">expand_more</span>
  </button>

  <Teleport to="body">
    <div v-if="open" :id="menuId" ref="panel" class="pop-menu" role="menu" :style="style">
      <slot :close="close" />
    </div>
  </Teleport>
</template>

<style scoped>
button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

button .material-icons {
  vertical-align: 0;
}

button.icon-only {
  padding: 5px;
}

.caret {
  margin-left: -2px;
  opacity: 0.7;
}

.pop-menu {
  position: fixed;
  z-index: 200;
  overflow: auto;
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: 0 12px 32px var(--shadow);
  padding: 4px;
}
</style>
