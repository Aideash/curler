<script setup lang="ts">
import { focusSkipTarget } from '../composables/useSkipFocus'

defineProps<{
  links: { targetId: string; label: string }[]
}>()

function activate(targetId: string, event: MouseEvent) {
  event.preventDefault()
  focusSkipTarget(targetId)
}
</script>

<template>
  <nav class="skip-links" aria-label="Skip links">
    <a
      v-for="link in links"
      :key="link.targetId"
      class="skip-link"
      :href="`#${link.targetId}`"
      @click="activate(link.targetId, $event)"
    >
      {{ link.label }}
    </a>
  </nav>
</template>

<style scoped>
.skip-links:focus-within {
  background-color: var(--bg);
  border: 1px solid var(--accent);
}
</style>
