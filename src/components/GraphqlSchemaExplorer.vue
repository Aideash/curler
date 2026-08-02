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
</style>
