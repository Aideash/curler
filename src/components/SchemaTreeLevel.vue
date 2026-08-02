<script setup lang="ts">
import { computed } from 'vue'
import type { RootOperation, SchemaFieldNode } from '../lib/graphqlQueryBuilder'

const props = defineProps<{
  operation: RootOperation
  parentPath: string[]
  depth: number
  expanded: Set<string>
  visibleFields: (op: RootOperation, path: string[]) => SchemaFieldNode[]
  isExpanded: (op: RootOperation, path: string[]) => boolean
}>()

const emit = defineEmits<{
  toggle: [operation: RootOperation, path: string[]]
  insert: [operation: RootOperation, parentPath: string[], fieldName: string]
}>()

const fields = computed(() => props.visibleFields(props.operation, props.parentPath))

function childPath(fieldName: string) {
  return [...props.parentPath, fieldName]
}
</script>

<template>
  <ul class="level" :style="{ '--depth': depth }">
    <li v-for="field in fields" :key="field.name" class="field-row">
      <div class="row">
        <button
          v-if="field.composite"
          type="button"
          class="ghost expand"
          :title="isExpanded(operation, childPath(field.name)) ? 'Collapse' : 'Expand'"
          @click.stop="emit('toggle', operation, childPath(field.name))"
        >
          <span class="material-icons sm">{{
            isExpanded(operation, childPath(field.name)) ? 'expand_more' : 'chevron_right'
          }}</span>
        </button>
        <span v-else class="expand-spacer" />
        <button
          type="button"
          class="ghost field-btn"
          :title="field.description || field.name"
          @click="emit('insert', operation, parentPath, field.name)"
        >
          <span class="field-name">{{ field.name }}</span>
          <span class="field-meta faint">{{ field.argsSummary }}: {{ field.typeLabel }}</span>
        </button>
      </div>
      <SchemaTreeLevel
        v-if="field.composite && isExpanded(operation, childPath(field.name))"
        :operation="operation"
        :parent-path="childPath(field.name)"
        :depth="depth + 1"
        :expanded="expanded"
        :visible-fields="visibleFields"
        :is-expanded="isExpanded"
        @toggle="(op, path) => emit('toggle', op, path)"
        @insert="(op, path, name) => emit('insert', op, path, name)"
      />
    </li>
  </ul>
</template>

<style scoped>
.level {
  list-style: none;
  margin: 0;
  padding: 0;
}

.field-row .row {
  display: flex;
  align-items: flex-start;
  gap: 2px;
  padding-left: calc(var(--depth, 0) * 14px);
}

.expand,
.expand-spacer {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
}

.field-btn {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  padding: 2px 6px;
  border-radius: var(--radius);
}

.field-btn:hover {
  background: var(--bg-hover);
}

.field-name {
  font-family: var(--mono);
  font-size: 13px;
}

.field-meta {
  font-size: 11px;
  word-break: break-all;
}
</style>
