<script setup lang="ts">
import { computed } from 'vue'
import SchemaInputFieldList from './SchemaInputFieldList.vue'
import SchemaEnumValueList from './SchemaEnumValueList.vue'
import {
  presenceArgKey,
  presenceFieldKey,
  type QueryPresence,
  type RootOperation,
  type SchemaArgNode,
  type SchemaFieldNode,
} from '../lib/graphqlQueryBuilder'

const props = defineProps<{
  operation: RootOperation
  parentPath: string[]
  depth: number
  expanded: Set<string>
  expandedArgs: Set<string>
  expandedInput: Set<string>
  insertModeOn: boolean
  showArgsOn: boolean
  filter: string
  presence: QueryPresence
  visibleFields: (op: RootOperation, path: string[]) => SchemaFieldNode[]
  visibleArgs: (field: SchemaFieldNode, needle: string) => SchemaArgNode[]
  isExpanded: (op: RootOperation, path: string[]) => boolean
}>()

const emit = defineEmits<{
  toggle: [operation: RootOperation, path: string[]]
  toggleArg: [key: string]
  toggleInput: [key: string]
  insert: [operation: RootOperation, parentPath: string[], fieldName: string]
  insertArg: [operation: RootOperation, parentPath: string[], fieldName: string, argName: string]
}>()

const fields = computed(() => props.visibleFields(props.operation, props.parentPath))
const filterNeedle = computed(() => props.filter.trim().toLowerCase())

function childPath(fieldName: string) {
  return [...props.parentPath, fieldName]
}

function canExpand(field: SchemaFieldNode) {
  return field.composite || (props.showArgsOn && field.args.length > 0)
}

function isFieldExpanded(field: SchemaFieldNode) {
  return props.isExpanded(props.operation, childPath(field.name))
}

function fieldInQuery(field: SchemaFieldNode) {
  return props.presence.fields.has(presenceFieldKey(props.parentPath, field.name))
}

function argInQuery(field: SchemaFieldNode, arg: SchemaArgNode) {
  return props.presence.args.has(presenceArgKey(props.parentPath, field.name, arg.name))
}

function canExpandArg(arg: SchemaArgNode) {
  return (
    (arg.inputObject && arg.inputFields.length > 0) || (arg.isEnum && arg.enumValues.length > 0)
  )
}

function argNestingKind(arg: SchemaArgNode): 'input' | 'enum' | null {
  if (arg.inputObject && arg.inputFields.length > 0) return 'input'
  if (arg.isEnum && arg.enumValues.length > 0) return 'enum'
  return null
}

function argExpandKey(field: SchemaFieldNode, arg: SchemaArgNode) {
  return `${props.operation}:${presenceArgKey(props.parentPath, field.name, arg.name)}`
}

function isArgExpanded(field: SchemaFieldNode, arg: SchemaArgNode) {
  return props.expandedArgs.has(argExpandKey(field, arg))
}

function inputPathPrefix(field: SchemaFieldNode, arg: SchemaArgNode) {
  return argExpandKey(field, arg)
}

function mainHandler(operation: RootOperation, parentPath: string[], field: SchemaFieldNode) {
  if (canExpand(field) && !isFieldExpanded(field)) {
    emit('toggle', operation, childPath(field.name))
  }
  if (props.insertModeOn) {
    emit('insert', operation, parentPath, field.name)
  }
}

function onArgClick(
  operation: RootOperation,
  parentPath: string[],
  field: SchemaFieldNode,
  arg: SchemaArgNode,
) {
  if (!props.insertModeOn || argInQuery(field, arg)) return
  emit('insertArg', operation, parentPath, field.name, arg.name)
}
</script>

<template>
  <ul class="level" :style="{ '--depth': depth }">
    <li v-for="field in fields" :key="field.name" class="field-row">
      <div class="row">
        <button
          v-if="canExpand(field)"
          type="button"
          class="ghost expand"
          :title="isFieldExpanded(field) ? 'Collapse' : 'Expand'"
          @click.stop="emit('toggle', operation, childPath(field.name))"
        >
          <span class="material-icons sm">{{
            isFieldExpanded(field) ? 'expand_more' : 'chevron_right'
          }}</span>
        </button>
        <span v-else class="expand-spacer" />
        <button
          type="button"
          class="ghost field-btn"
          :class="{ 'in-query': fieldInQuery(field) }"
          :title="
            fieldInQuery(field)
              ? `${field.description || field.name} (in query)`
              : field.description || field.name
          "
          @click="mainHandler(operation, parentPath, field)"
        >
          <span class="field-name">{{ field.name }}</span>
          <span class="field-meta faint">{{ field.argsSummary }}: {{ field.typeLabel }}</span>
        </button>
      </div>

      <ul
        v-if="showArgsOn && isFieldExpanded(field) && visibleArgs(field, filterNeedle).length"
        class="args-list"
      >
        <template v-for="arg in visibleArgs(field, filterNeedle)" :key="arg.name">
          <li class="arg-row" :style="{ '--depth': depth + 1 }">
            <button
              v-if="canExpandArg(arg)"
              type="button"
              class="ghost expand"
              :title="isArgExpanded(field, arg) ? 'Collapse' : 'Expand'"
              @click.stop="emit('toggleArg', argExpandKey(field, arg))"
            >
              <span class="material-icons sm">{{
                isArgExpanded(field, arg) ? 'expand_more' : 'chevron_right'
              }}</span>
            </button>
            <span v-else class="expand-spacer" />
            <button
              type="button"
              class="ghost arg-btn"
              :class="{
                'insert-disabled': !insertModeOn || argInQuery(field, arg),
                'in-query': argInQuery(field, arg),
              }"
              :title="
                argInQuery(field, arg)
                  ? `${field.name}.${arg.name} (in query)`
                  : arg.description || `${field.name}.${arg.name}`
              "
              @click="onArgClick(operation, parentPath, field, arg)"
            >
              <span class="arg-name">{{ arg.name }}</span>
              <span class="arg-meta faint">{{ arg.typeLabel }}</span>
            </button>
          </li>
          <li
            v-if="canExpandArg(arg) && isArgExpanded(field, arg)"
            class="arg-nesting"
            :style="{ '--depth': depth + 1 }"
          >
            <SchemaInputFieldList
              v-if="argNestingKind(arg) === 'input'"
              :fields="arg.inputFields"
              :depth="depth + 2"
              :expanded="expandedInput"
              :path-prefix="inputPathPrefix(field, arg)"
              @toggle="(key) => emit('toggleInput', key)"
            />
            <SchemaEnumValueList
              v-else-if="argNestingKind(arg) === 'enum'"
              :values="arg.enumValues"
              :depth="depth + 2"
            />
          </li>
        </template>
      </ul>

      <SchemaTreeLevel
        v-if="field.composite && isFieldExpanded(field)"
        :operation="operation"
        :parent-path="childPath(field.name)"
        :depth="depth + 1"
        :expanded="expanded"
        :expanded-args="expandedArgs"
        :expanded-input="expandedInput"
        :visible-fields="visibleFields"
        :visible-args="visibleArgs"
        :is-expanded="isExpanded"
        :insert-mode-on="insertModeOn"
        :show-args-on="showArgsOn"
        :filter="filter"
        :presence="presence"
        @toggle="(op, path) => emit('toggle', op, path)"
        @toggle-arg="(key) => emit('toggleArg', key)"
        @toggle-input="(key) => emit('toggleInput', key)"
        @insert="(op, path, name) => emit('insert', op, path, name)"
        @insert-arg="
          (op, path, fieldName, argName) => emit('insertArg', op, path, fieldName, argName)
        "
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

.field-btn.in-query {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.field-name {
  font-family: var(--mono);
  font-size: 13px;
}

.field-meta {
  font-size: 11px;
  word-break: break-all;
}

.args-list {
  list-style: none;
  margin: 0 0 2px;
  padding: 0;
}

.arg-row {
  display: flex;
  align-items: flex-start;
  gap: 2px;
  padding-left: calc(var(--depth, 0) * 14px);
}

.input-nesting,
.arg-nesting {
  list-style: none;
  margin: 0;
  padding: 0;
  padding-left: calc(var(--depth, 0) * 14px + 24px);
}

.arg-btn {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  padding: 2px 6px;
  border-left: 3px solid var(--accent);
  border-radius: 0;
}

.arg-btn:hover:not(.insert-disabled) {
  background: var(--bg-hover);
}

.arg-btn.insert-disabled {
  cursor: default;
}

.arg-btn.in-query {
  opacity: 0.55;
  border-left-color: var(--accent-dim);
}

.arg-name {
  font-family: var(--mono);
  font-size: 12px;
}

.arg-meta {
  font-size: 11px;
  word-break: break-all;
}
</style>
