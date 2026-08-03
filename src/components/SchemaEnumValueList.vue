<script setup lang="ts">
import type { SchemaEnumValueNode } from '../lib/graphqlQueryBuilder'

defineProps<{
  values: SchemaEnumValueNode[]
  depth: number
}>()
</script>

<template>
  <ul class="enum-values-list">
    <li v-for="value in values" :key="value.name" class="enum-value-row">
      <div class="row" :style="{ '--depth': depth }">
        <span class="expand-spacer" />
        <div
          class="enum-value-label"
          :class="{ deprecated: value.deprecated }"
          :title="value.description || value.name"
        >
          <span class="enum-value-name">{{ value.name }}</span>
          <span v-if="value.deprecated" class="enum-value-meta faint">deprecated</span>
        </div>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.enum-values-list {
  list-style: none;
  margin: 0 0 2px;
  padding: 0;
}

.row {
  display: flex;
  align-items: flex-start;
  gap: 2px;
  padding-left: calc(var(--depth, 0) * 14px);
}

.expand-spacer {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
}

.enum-value-label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 2px 6px;
  border-left: 2px solid var(--accent-dim);
}

.enum-value-label.deprecated {
  opacity: 0.65;
}

.enum-value-name {
  font-family: var(--mono);
  font-size: 12px;
}

.enum-value-meta {
  font-size: 11px;
}
</style>
