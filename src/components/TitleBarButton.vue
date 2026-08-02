<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    icon?: string
    label: string
    title?: string
    variant?: 'ghost' | 'primary'
    disabled?: boolean
    back?: boolean
  }>(),
  { variant: 'ghost' },
)

const emit = defineEmits<{ click: [event: MouseEvent] }>()

const tooltip = computed(() => props.title ?? props.label)
</script>

<template>
  <button
    :class="[variant, { back }]"
    :title="tooltip"
    :disabled="disabled"
    @click="emit('click', $event)"
  >
    <span v-if="icon" class="material-icons sm">{{ icon }}</span>
    <span class="btn-label">{{ label }}</span>
  </button>
</template>
