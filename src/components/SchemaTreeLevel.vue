<script setup lang="ts">
import { computed, inject } from 'vue'
import SchemaInputFieldList from './SchemaInputFieldList.vue'
import SchemaEnumValueList from './SchemaEnumValueList.vue'
import SchemaFragmentTypeList from './SchemaFragmentTypeList.vue'
import { INSERT_BLOCKED_HINT_KEY } from '../composables/useRapidClickHint'
import {
  fieldPathFromSegments,
  explorerNodeTitle,
  pathSegmentField,
  presenceArgKey,
  presenceFieldKey,
  type PathSegment,
  type QueryPresence,
  type RootOperation,
  type SchemaArgNode,
  type SchemaFieldNode,
  type SchemaFragmentTypeNode,
  type SchemaExplorerSortMode,
} from '../lib/graphqlQueryBuilder'

const props = defineProps<{
  operation: RootOperation
  parentPath: PathSegment[]
  depth: number
  expanded: Set<string>
  expandedArgs: Set<string>
  expandedInput: Set<string>
  expandedFragments: Set<string>
  insertModeOn: boolean
  showArgsOn: boolean
  sortMode: SchemaExplorerSortMode
  filter: string
  presence: QueryPresence
  queryIsParsable?: boolean
  fields?: SchemaFieldNode[]
  visibleFields: (op: RootOperation, path: PathSegment[]) => SchemaFieldNode[]
  visibleArgs: (field: SchemaFieldNode, needle: string) => SchemaArgNode[]
  visibleInterfaceFields: (field: SchemaFieldNode, needle: string) => SchemaFieldNode[]
  visibleFragmentTypes: (field: SchemaFieldNode, needle: string) => SchemaFragmentTypeNode[]
  loadFragmentMemberFields: (ownerTypeName: string, concreteTypeName: string) => SchemaFieldNode[]
  isExpanded: (op: RootOperation, path: PathSegment[]) => boolean
}>()

const emit = defineEmits<{
  toggle: [operation: RootOperation, path: PathSegment[]]
  toggleArg: [key: string]
  toggleInput: [key: string]
  toggleFragment: [key: string]
  insert: [operation: RootOperation, parentPath: PathSegment[], fieldName: string]
  insertArg: [
    operation: RootOperation,
    parentPath: PathSegment[],
    fieldName: string,
    argName: string,
  ]
  insertFragment: [operation: RootOperation, fieldPath: PathSegment[], typeName: string]
}>()

const insertBlockedHint = inject(INSERT_BLOCKED_HINT_KEY, null)

const insertBlocked = computed(
  () =>
    insertBlockedHint?.insertBlocked.value ??
    (props.insertModeOn && props.queryIsParsable === false),
)

const fields = computed(
  () => props.fields ?? props.visibleFields(props.operation, props.parentPath),
)
const filterNeedle = computed(() => props.filter.trim().toLowerCase())

function childPath(fieldName: string): PathSegment[] {
  return [...props.parentPath, pathSegmentField(fieldName)]
}

function fragmentPathPrefix(field: SchemaFieldNode) {
  const fieldOnly = fieldPathFromSegments(props.parentPath)
  return `${props.operation}:${[...fieldOnly, field.name].join('.')}`
}

function canExpand(field: SchemaFieldNode) {
  if (field.cyclicReturn) {
    return props.showArgsOn && field.args.length > 0
  }
  return (
    field.composite ||
    field.abstractReturn !== 'none' ||
    (props.showArgsOn && field.args.length > 0)
  )
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

function handleInsertBlocked(event: MouseEvent): boolean {
  if (!insertBlocked.value) return false
  insertBlockedHint?.recordBlockedClick(event)
  return true
}

function mainHandler(
  event: MouseEvent,
  operation: RootOperation,
  parentPath: PathSegment[],
  field: SchemaFieldNode,
) {
  if (canExpand(field) && !isFieldExpanded(field)) {
    emit('toggle', operation, childPath(field.name))
  }
  if (props.insertModeOn) {
    if (handleInsertBlocked(event)) return
    emit('insert', operation, parentPath, field.name)
  }
}

function onArgClick(
  event: MouseEvent,
  operation: RootOperation,
  parentPath: PathSegment[],
  field: SchemaFieldNode,
  arg: SchemaArgNode,
) {
  if (!props.insertModeOn || argInQuery(field, arg)) return
  if (handleInsertBlocked(event)) return
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
          :aria-label="isFieldExpanded(field) ? `Collapse ${field.name}` : `Expand ${field.name}`"
          :aria-expanded="isFieldExpanded(field)"
          @click.stop="emit('toggle', operation, childPath(field.name))"
        >
          <span class="material-icons sm" aria-hidden="true">{{
            isFieldExpanded(field) ? 'expand_more' : 'chevron_right'
          }}</span>
        </button>
        <span v-else class="expand-spacer" />
        <button
          type="button"
          class="ghost field-btn"
          :class="{
            'in-query': fieldInQuery(field),
            deprecated: field.deprecated,
            'error-uninsertable': insertBlocked,
          }"
          :title="explorerNodeTitle(field, fieldInQuery(field) ? '(in query)' : undefined)"
          @click="mainHandler($event, operation, parentPath, field)"
        >
          <span class="field-name">{{ field.name }}</span>
          <span class="field-meta faint">
            {{ field.argsSummary }}<template v-if="field.argsSummary">: </template
            >{{ field.typeLabel }}<template v-if="field.cyclicReturn"> (cyclic)</template
            ><template v-if="field.deprecated"> · deprecated</template>
          </span>
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
              :aria-label="
                isArgExpanded(field, arg)
                  ? `Collapse argument ${arg.name}`
                  : `Expand argument ${arg.name}`
              "
              :aria-expanded="isArgExpanded(field, arg)"
              @click.stop="emit('toggleArg', argExpandKey(field, arg))"
            >
              <span class="material-icons sm" aria-hidden="true">{{
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
                deprecated: arg.deprecated,
                'error-uninsertable': insertBlocked && !argInQuery(field, arg),
              }"
              :title="
                explorerNodeTitle(
                  arg,
                  argInQuery(field, arg)
                    ? `${field.name}.${arg.name} (in query)`
                    : `${field.name}.${arg.name}`,
                )
              "
              @click="onArgClick($event, operation, parentPath, field, arg)"
            >
              <span class="arg-name">{{ arg.name }}</span>
              <span class="arg-meta faint"
                >{{ arg.typeLabel }}<template v-if="arg.deprecated"> · deprecated</template></span
              >
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
              :sort-mode="sortMode"
              @toggle="(key) => emit('toggleInput', key)"
            />
            <SchemaEnumValueList
              v-else-if="argNestingKind(arg) === 'enum'"
              :values="arg.enumValues"
              :depth="depth + 2"
              :sort-mode="sortMode"
            />
          </li>
        </template>
      </ul>

      <SchemaTreeLevel
        v-if="
          field.abstractReturn === 'interface' &&
          isFieldExpanded(field) &&
          visibleInterfaceFields(field, filterNeedle).length
        "
        :operation="operation"
        :parent-path="childPath(field.name)"
        :depth="depth + 1"
        :fields="visibleInterfaceFields(field, filterNeedle)"
        :expanded="expanded"
        :expanded-args="expandedArgs"
        :expanded-input="expandedInput"
        :expanded-fragments="expandedFragments"
        :visible-fields="visibleFields"
        :visible-args="visibleArgs"
        :visible-interface-fields="visibleInterfaceFields"
        :visible-fragment-types="visibleFragmentTypes"
        :load-fragment-member-fields="loadFragmentMemberFields"
        :is-expanded="isExpanded"
        :insert-mode-on="insertModeOn"
        :show-args-on="showArgsOn"
        :sort-mode="sortMode"
        :filter="filter"
        :presence="presence"
        :query-is-parsable="queryIsParsable"
        @toggle="(op, path) => emit('toggle', op, path)"
        @toggle-arg="(key) => emit('toggleArg', key)"
        @toggle-input="(key) => emit('toggleInput', key)"
        @toggle-fragment="(key) => emit('toggleFragment', key)"
        @insert="(op, path, name) => emit('insert', op, path, name)"
        @insert-arg="
          (op, path, fieldName, argName) => emit('insertArg', op, path, fieldName, argName)
        "
        @insert-fragment="(op, path, typeName) => emit('insertFragment', op, path, typeName)"
      />

      <SchemaFragmentTypeList
        v-if="
          isFieldExpanded(field) &&
          field.abstractReturn !== 'none' &&
          !field.cyclicReturn &&
          visibleFragmentTypes(field, filterNeedle).length
        "
        :fragment-types="visibleFragmentTypes(field, filterNeedle)"
        :field-path="childPath(field.name)"
        :owner-type-name="field.returnTypeName"
        :load-fragment-member-fields="loadFragmentMemberFields"
        :depth="depth + 1"
        :path-prefix="fragmentPathPrefix(field)"
        :operation="operation"
        :expanded="expanded"
        :expanded-fragments="expandedFragments"
        :insert-mode-on="insertModeOn"
        :show-args-on="showArgsOn"
        :sort-mode="sortMode"
        :expanded-args="expandedArgs"
        :expanded-input="expandedInput"
        :filter="filter"
        :presence="presence"
        :visible-fields="visibleFields"
        :visible-args="visibleArgs"
        :visible-interface-fields="visibleInterfaceFields"
        :visible-fragment-types="visibleFragmentTypes"
        :is-expanded="isExpanded"
        @toggle-fragment="(key) => emit('toggleFragment', key)"
        @toggle-arg="(key) => emit('toggleArg', key)"
        @toggle-input="(key) => emit('toggleInput', key)"
        @toggle="(op, path) => emit('toggle', op, path)"
        @insert="(op, path, name) => emit('insert', op, path, name)"
        @insert-arg="
          (op, path, fieldName, argName) => emit('insertArg', op, path, fieldName, argName)
        "
        @insert-fragment="(op, path, typeName) => emit('insertFragment', op, path, typeName)"
      />

      <SchemaTreeLevel
        v-if="field.composite && field.abstractReturn === 'none' && isFieldExpanded(field)"
        :operation="operation"
        :parent-path="childPath(field.name)"
        :depth="depth + 1"
        :expanded="expanded"
        :expanded-args="expandedArgs"
        :expanded-input="expandedInput"
        :expanded-fragments="expandedFragments"
        :visible-fields="visibleFields"
        :visible-args="visibleArgs"
        :visible-interface-fields="visibleInterfaceFields"
        :visible-fragment-types="visibleFragmentTypes"
        :load-fragment-member-fields="loadFragmentMemberFields"
        :is-expanded="isExpanded"
        :insert-mode-on="insertModeOn"
        :show-args-on="showArgsOn"
        :sort-mode="sortMode"
        :filter="filter"
        :presence="presence"
        :query-is-parsable="queryIsParsable"
        @toggle="(op, path) => emit('toggle', op, path)"
        @toggle-arg="(key) => emit('toggleArg', key)"
        @toggle-input="(key) => emit('toggleInput', key)"
        @toggle-fragment="(key) => emit('toggleFragment', key)"
        @insert="(op, path, name) => emit('insert', op, path, name)"
        @insert-arg="
          (op, path, fieldName, argName) => emit('insertArg', op, path, fieldName, argName)
        "
        @insert-fragment="(op, path, typeName) => emit('insertFragment', op, path, typeName)"
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

.field-btn.deprecated,
.arg-btn.deprecated:not(.in-query) {
  opacity: 0.65;
}

.field-btn.error-uninsertable:active {
  background: color-mix(in srgb, var(--red) 30%, transparent);
  border: 1px solid var(--red-border);
}

.arg-btn.error-uninsertable:active:not(.insert-disabled) {
  background: color-mix(in srgb, var(--red) 30%, transparent);
  border-left-color: var(--red-border);
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
