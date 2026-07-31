<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

defineProps<{ title: string; width?: string }>()
const emit = defineEmits<{ close: [] }>()

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @mousedown.self="emit('close')">
      <div class="modal" :style="{ width: width ?? '620px' }">
        <header>
          <h2>{{ title }}</h2>
          <button class="ghost close" title="Close" @click="emit('close')">
            <span class="material-icons">close</span>
          </button>
        </header>
        <div class="modal-body">
          <slot />
        </div>
        <footer v-if="$slots.footer">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: var(--backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  box-shadow: 0 24px 64px var(--shadow-strong);
  display: flex;
  flex-direction: column;
  max-height: 82vh;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 14px 20px;
  border-bottom: 1px solid var(--border);
}

h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.close {
  display: inline-flex;
  padding: 5px;
}

.close .material-icons {
  vertical-align: 0;
}

.modal-body {
  padding: 18px 20px;
  overflow: auto;
  min-height: 0;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
}
</style>
