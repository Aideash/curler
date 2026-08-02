<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GraphQLSchema } from 'graphql'
import SchemaTreeLevel from './SchemaTreeLevel.vue'
import {
  availableOperations,
  listFields,
  type FieldClickTarget,
  type RootOperation,
  type SchemaFieldNode,
} from '../lib/graphqlQueryBuilder'

const props = defineProps<{
  schema: GraphQLSchema
  filter: string
}>()

const emit = defineEmits<{
  fieldClick: [target: FieldClickTarget]
}>()

const operations = computed(() => availableOperations(props.schema))
const activeOp = ref<RootOperation>('query')
const expanded = ref<Set<string>>(new Set())
const insertModeOn = ref(true)

watch(
  operations,
  (ops) => {
    if (!ops.includes(activeOp.value)) activeOp.value = ops[0] ?? 'query'
  },
  { immediate: true },
)

function pathKey(operation: RootOperation, path: string[]) {
  return `${operation}:${path.join('.')}`
}

function isExpanded(operation: RootOperation, path: string[]) {
  return expanded.value.has(pathKey(operation, path))
}

function toggleExpand(operation: RootOperation, path: string[]) {
  const key = pathKey(operation, path)
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function matchesFilter(field: SchemaFieldNode, needle: string) {
  if (!needle) return true
  const hay = `${field.name} ${field.typeLabel} ${field.argsSummary}`.toLowerCase()
  return hay.includes(needle)
}

function visibleFields(operation: RootOperation, parentPath: string[]): SchemaFieldNode[] {
  const needle = props.filter.trim().toLowerCase()
  return listFields(props.schema, operation, parentPath).filter((field) =>
    matchesFilter(field, needle),
  )
}

function onInsert(operation: RootOperation, parentPath: string[], fieldName: string) {
  emit('fieldClick', { operation, parentPath, fieldName })
}
</script>

<template>
  <div class="schema-explorer">
    <div v-if="operations.length > 1" class="op-tabs">
      <button
        v-for="op in operations"
        :key="op"
        class="ghost tab"
        :class="{ active: activeOp === op }"
        @click="activeOp = op"
      >
        {{ op }}
      </button>
      <label for="insert-mode" class="toggle">
        <span class="faint">Insert mode</span>
        <input id="insert-mode" v-model="insertModeOn" type="checkbox" />
      </label>
    </div>

    <div v-if="!operations.length" class="empty faint">Schema has no root operations.</div>

    <div v-else class="tree">
      <SchemaTreeLevel
        :operation="activeOp"
        :parent-path="[]"
        :depth="0"
        :expanded="expanded"
        :visible-fields="visibleFields"
        :is-expanded="isExpanded"
        :insert-mode-on="insertModeOn"
        @toggle="toggleExpand"
        @insert="onInsert"
      />
    </div>
  </div>
</template>

<style scoped>
.schema-explorer {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.op-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 8px 0;
  flex-shrink: 0;
}

.tab {
  text-transform: capitalize;
  font-size: 12px;
}

.tab.active {
  color: var(--accent);
}

.tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.empty {
  padding: 16px;
  font-size: 13px;
}

.op-tabs .toggle {
  margin-left: auto;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.toggle input[type='checkbox'] {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  flex-shrink: 0;
  width: 30px;
  height: 16px;
  min-width: 0;
  padding: 0;
  border-radius: 999px;
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}

.toggle input[type='checkbox']::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-faint);
  transition:
    transform 0.12s ease,
    background 0.12s ease;
}

.toggle input[type='checkbox']:checked {
  background: var(--accent-dim);
  border-color: var(--accent);
}

.toggle input[type='checkbox']:checked::before {
  transform: translateX(14px);
  background: var(--accent);
}

.toggle input[type='checkbox']:focus-visible {
  outline: 2px solid var(--accent-dim);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .toggle input[type='checkbox'],
  .toggle input[type='checkbox']::before {
    transition: none;
  }
}
</style>
