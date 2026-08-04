<script setup lang="ts">
import { computed } from 'vue'
import SchemaEnumValueList from './SchemaEnumValueList.vue'
import {
  explorerNodeTitle,
  sortExplorerList,
  type SchemaExplorerSortMode,
  type SchemaInputFieldNode,
} from '../lib/graphqlQueryBuilder'

const props = defineProps<{
  fields: SchemaInputFieldNode[]
  depth: number
  expanded: Set<string>
  pathPrefix: string
  sortMode: SchemaExplorerSortMode
}>()

const emit = defineEmits<{
  toggle: [key: string]
}>()

const sortedFields = computed(() =>
  sortExplorerList(props.fields, props.sortMode, (field) => field.name),
)

function fieldKey(name: string) {
  return `${props.pathPrefix}::${name}`
}

function isExpanded(name: string) {
  return props.expanded.has(fieldKey(name))
}

function canExpand(field: SchemaInputFieldNode) {
  return (
    (field.inputObject && field.inputFields.length > 0) ||
    (field.isEnum && field.enumValues.length > 0)
  )
}

function nestingKind(field: SchemaInputFieldNode): 'input' | 'enum' | null {
  if (field.inputObject && field.inputFields.length > 0) return 'input'
  if (field.isEnum && field.enumValues.length > 0) return 'enum'
  return null
}
</script>

<template>
  <ul class="input-fields-list">
    <li v-for="field in sortedFields" :key="field.name" class="input-field-row">
      <div class="row" :style="{ '--depth': depth }">
        <button
          v-if="canExpand(field)"
          type="button"
          class="ghost expand"
          :title="isExpanded(field.name) ? 'Collapse' : 'Expand'"
          @click.stop="emit('toggle', fieldKey(field.name))"
        >
          <span class="material-icons sm">{{
            isExpanded(field.name) ? 'expand_more' : 'chevron_right'
          }}</span>
        </button>
        <span v-else class="expand-spacer" />
        <div
          class="input-field-label"
          :class="{ deprecated: field.deprecated }"
          :title="explorerNodeTitle(field)"
        >
          <span class="input-field-name">{{ field.name }}</span>
          <span class="input-field-meta faint"
            >{{ field.typeLabel
            }}<template v-if="field.deprecated"> · deprecated</template></span
          >
        </div>
      </div>
      <SchemaInputFieldList
        v-if="nestingKind(field) === 'input' && isExpanded(field.name)"
        :fields="field.inputFields"
        :depth="depth + 1"
        :expanded="expanded"
        :path-prefix="fieldKey(field.name)"
        :sort-mode="sortMode"
        @toggle="(key) => emit('toggle', key)"
      />
      <SchemaEnumValueList
        v-else-if="nestingKind(field) === 'enum' && isExpanded(field.name)"
        :values="field.enumValues"
        :depth="depth + 1"
        :sort-mode="sortMode"
      />
    </li>
  </ul>
</template>

<style scoped>
.input-fields-list {
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

.expand,
.expand-spacer {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
}

.input-field-label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 2px 6px;
  border-left: 2px solid var(--accent-dim);
}

.input-field-label.deprecated {
  opacity: 0.65;
}

.input-field-name {
  font-family: var(--mono);
  font-size: 12px;
}

.input-field-meta {
  font-size: 11px;
  word-break: break-all;
}
</style>
