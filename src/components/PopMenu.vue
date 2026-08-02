<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useFocusTrap } from '../composables/useFocusTrap'

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

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

useFocusTrap(panel, {
  boundary: 'loop',
  active: open,
  restoreTo: trigger,
})

function onScroll(event: Event) {
  if (!open.value) return
  const target = event.target as Node
  if (panel.value?.contains(target)) return
  close()
}

onMounted(() => {
  window.addEventListener('mousedown', onPointerDown, true)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', close)
  window.addEventListener('scroll', onScroll, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onPointerDown, true)
  window.removeEventListener('keydown', onKeydown)
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
    :aria-label="title || undefined"
    aria-haspopup="menu"
    :aria-expanded="open"
    @click="toggle"
  >
    <span v-if="icon" class="material-icons sm">{{ icon }}</span>
    <span v-if="label">{{ label }}</span>
    <span v-if="label" class="material-icons sm caret">expand_more</span>
  </button>

  <Teleport to="body">
    <div v-if="open" ref="panel" class="pop-menu" role="menu" :style="style">
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
