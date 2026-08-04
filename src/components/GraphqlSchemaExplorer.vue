<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GraphQLSchema } from 'graphql'
import SchemaTreeLevel from './SchemaTreeLevel.vue'
import {
  availableOperations,
  buildQueryPresence,
  fieldPathFromSegments,
  listFields,
  listFragmentMemberFields,
  listInterfaceFieldsForType,
  loadArgInsertMode,
  saveArgInsertMode,
  type ArgClickTarget,
  type ArgInsertMode,
  type FieldClickTarget,
  type FragmentClickTarget,
  type RootOperation,
  type PathSegment,
  type SchemaArgNode,
  type SchemaFieldNode,
  type SchemaFragmentTypeNode,
  type SchemaInputFieldNode,
} from '../lib/graphqlQueryBuilder'

const props = defineProps<{
  schema: GraphQLSchema
  filter: string
  query: string
}>()

const showArgsOn = defineModel<boolean>('showArgs', { default: false })
const argInsertMode = defineModel<ArgInsertMode>('argInsertMode', {
  default: loadArgInsertMode,
})

const showExplorerControls = ref(true)

const emit = defineEmits<{
  fieldClick: [target: FieldClickTarget]
  argClick: [target: ArgClickTarget]
  fragmentClick: [target: FragmentClickTarget]
}>()

const operations = computed(() => availableOperations(props.schema))
const activeOp = defineModel<RootOperation>('activeOperation', { default: 'query' })
const expanded = ref<Set<string>>(new Set())
const expandedArgs = ref<Set<string>>(new Set())
const expandedInput = ref<Set<string>>(new Set())
const expandedFragments = ref<Set<string>>(new Set())
const insertModeOn = ref(true)
const schemaExplorerError = ref<string | null>(null)

const presence = computed(() => buildQueryPresence(props.query, activeOp.value))

watch(
  operations,
  (ops) => {
    if (!ops.includes(activeOp.value)) activeOp.value = ops[0] ?? 'query'
  },
  { immediate: true },
)

watch(argInsertMode, (mode) => {
  saveArgInsertMode(mode)
})

watch(
  () => props.schema,
  () => {
    schemaExplorerError.value = null
  },
)

function pathKey(operation: RootOperation, path: PathSegment[]) {
  return `${operation}:${fieldPathFromSegments(path).join('.')}`
}

function isExpanded(operation: RootOperation, path: PathSegment[]) {
  return expanded.value.has(pathKey(operation, path))
}

function toggleExpand(operation: RootOperation, path: PathSegment[]) {
  const key = pathKey(operation, path)
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function toggleArgExpand(key: string) {
  const next = new Set(expandedArgs.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedArgs.value = next
}

function toggleInputExpand(key: string) {
  const next = new Set(expandedInput.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedInput.value = next
}

function toggleFragmentExpand(key: string) {
  const next = new Set(expandedFragments.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedFragments.value = next
}

function inputFieldsMatch(fields: SchemaInputFieldNode[], needle: string): boolean {
  return fields.some(
    (field) =>
      `${field.name} ${field.typeLabel}`.toLowerCase().includes(needle) ||
      field.enumValues.some((value) => value.name.toLowerCase().includes(needle)) ||
      inputFieldsMatch(field.inputFields, needle),
  )
}

function enumValuesMatch(values: SchemaArgNode['enumValues'], needle: string): boolean {
  return values.some((value) => value.name.toLowerCase().includes(needle))
}

function argMatchesFilter(arg: SchemaArgNode, needle: string): boolean {
  if (`${arg.name} ${arg.typeLabel}`.toLowerCase().includes(needle)) return true
  if (enumValuesMatch(arg.enumValues, needle)) return true
  return inputFieldsMatch(arg.inputFields, needle)
}

function fragmentTypesMatch(fragments: SchemaFragmentTypeNode[], needle: string): boolean {
  return fragments.some((fragment) => fragment.typeName.toLowerCase().includes(needle))
}

function fieldMatchesFilterDeep(field: SchemaFieldNode, needle: string): boolean {
  if (`${field.name} ${field.typeLabel} ${field.argsSummary}`.toLowerCase().includes(needle)) {
    return true
  }
  if (field.args.some((arg) => argMatchesFilter(arg, needle))) return true
  return fragmentTypesMatch(field.fragmentTypes, needle)
}

function matchesFilter(field: SchemaFieldNode, needle: string) {
  if (!needle) return true
  return fieldMatchesFilterDeep(field, needle)
}

function visibleArgs(field: SchemaFieldNode, needle: string): SchemaArgNode[] {
  if (!showArgsOn.value || !field.args.length) return []
  if (!needle) return field.args
  return field.args.filter((arg) => argMatchesFilter(arg, needle))
}

function visibleFields(operation: RootOperation, parentPath: PathSegment[]): SchemaFieldNode[] {
  const needle = props.filter.trim().toLowerCase()
  try {
    schemaExplorerError.value = null
    return listFields(props.schema, operation, parentPath).filter((field) =>
      matchesFilter(field, needle),
    )
  } catch (error) {
    console.error('Schema explorer failed to list fields', error)
    schemaExplorerError.value =
      'Could not build the schema tree. The schema may be too large or contain unusual type cycles.'
    return []
  }
}

function loadFragmentMemberFields(
  ownerTypeName: string,
  concreteTypeName: string,
): SchemaFieldNode[] {
  try {
    return listFragmentMemberFields(props.schema, ownerTypeName, concreteTypeName)
  } catch (error) {
    console.error('Failed to load fragment member fields', error)
    return []
  }
}

function visibleInterfaceFields(field: SchemaFieldNode, needle: string): SchemaFieldNode[] {
  if (field.abstractReturn !== 'interface' || field.cyclicReturn) return []
  const fields = listInterfaceFieldsForType(props.schema, field.returnTypeName)
  if (!needle) return fields
  return fields.filter((ifaceField) => fieldMatchesFilterDeep(ifaceField, needle))
}

function visibleFragmentTypes(field: SchemaFieldNode, needle: string): SchemaFragmentTypeNode[] {
  if (!field.fragmentTypes.length || field.cyclicReturn) return []
  if (!needle) return field.fragmentTypes
  return field.fragmentTypes.filter((fragment) => fragment.typeName.toLowerCase().includes(needle))
}

function onInsert(operation: RootOperation, parentPath: PathSegment[], fieldName: string) {
  emit('fieldClick', { operation, parentPath, fieldName })
}

function onArgInsert(
  operation: RootOperation,
  parentPath: PathSegment[],
  fieldName: string,
  argName: string,
) {
  emit('argClick', { operation, parentPath, fieldName, argName })
}

function onFragmentInsert(operation: RootOperation, fieldPath: PathSegment[], typeName: string) {
  emit('fragmentClick', { operation, fieldPath, typeName })
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
      <button
        v-if="operations.length"
        class="ghost show-more-button"
        :class="{ expanded: showExplorerControls }"
        :title="showExplorerControls ? 'Hide options' : 'Show options'"
        @click="showExplorerControls = !showExplorerControls"
      >
        <span class="material-icons sm"> expand_more </span>
      </button>
    </div>

    <transition name="fade-shrink">
      <div v-show="operations.length && showExplorerControls" class="explorer-controls-wrap">
        <div class="explorer-controls">
          <label for="show-args" class="toggle">
            <span class="faint">Show arguments</span>
            <input
              id="show-args"
              v-model="showArgsOn"
              type="checkbox"
              :title="showArgsOn ? 'Showing arguments' : 'Hiding arguments'"
            />
          </label>
          <label for="insert-mode" class="toggle">
            <span class="faint">Insert mode</span>
            <input
              id="insert-mode"
              v-model="insertModeOn"
              type="checkbox"
              :title="insertModeOn ? 'Turn off Insert mode' : 'Turn on Insert Mode'"
            />
          </label>
          <label class="insert-as" for="arg-insert-mode">
            <span class="faint">Insert as</span>
            <select
              id="arg-insert-mode"
              v-model="argInsertMode"
              class="mode-select"
              title="How argument values are added to the query"
            >
              <option value="placeholder">Placeholders</option>
              <option value="required-vars">Required vars</option>
              <option value="variables-only">Variables only</option>
            </select>
          </label>
        </div>
      </div>
    </transition>

    <div v-if="schemaExplorerError" class="schema-error faint">{{ schemaExplorerError }}</div>

    <div v-if="!operations.length" class="empty faint">Schema has no root operations.</div>

    <div v-else class="tree">
      <SchemaTreeLevel
        :operation="activeOp"
        :parent-path="[]"
        :depth="0"
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
        :filter="filter"
        :presence="presence"
        @toggle="toggleExpand"
        @toggle-arg="toggleArgExpand"
        @toggle-input="toggleInputExpand"
        @toggle-fragment="toggleFragmentExpand"
        @insert="onInsert"
        @insert-arg="onArgInsert"
        @insert-fragment="onFragmentInsert"
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

  --toggle-height: 16px;
  --toggle-margin-top-bottom: 3px;
  --explorer-control-padding-top: 8px;
}

.op-tabs {
  display: flex;
  flex-wrap: wrap;
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

.schema-error {
  margin: 8px 8px 0;
  padding: 8px 10px;
  font-size: 12px;
  border: 1px solid color-mix(in srgb, var(--danger, #c00) 40%, var(--border));
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--danger, #c00) 8%, transparent);
}

.op-tabs .tab:last-of-type {
  margin-right: auto;
}

.show-more-button {
  margin-left: auto;
}

.show-more-button span {
  transition-property: transform;
}

.show-more-button.expanded span {
  transform: rotate(180deg);
}

.explorer-controls-wrap {
  display: grid;
  grid-template-rows: 1fr;
  flex-shrink: 0;
}

.explorer-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: var(--explorer-control-padding-top) 8px 0;
  overflow: hidden;
  min-height: 0;
}

.explorer-controls label:first-of-type {
  margin-right: auto;
}

.insert-as {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  white-space: nowrap;
}

.mode-select {
  font-size: 11px;
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--text);
  max-width: 118px;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 0px;
  font-size: 10px;
  cursor: pointer;
  white-space: nowrap;
}

.toggle input[type='checkbox'] {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  flex-shrink: 0;
  width: 30px;
  height: var(--toggle-height);
  min-width: 0;
  padding: 0;
  margin-top: var(--toggle-margin-top-bottom);
  margin-bottom: var(--toggle-margin-top-bottom);
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

.fade-shrink-enter-active,
.fade-shrink-leave-active {
  transition:
    grid-template-rows 0.2s ease,
    opacity 0.2s ease;
}

.fade-shrink-enter-active .explorer-controls,
.fade-shrink-leave-active .explorer-controls {
  transition: padding-top 0.2s ease;
}

.fade-shrink-enter-from,
.fade-shrink-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}

.fade-shrink-enter-from .explorer-controls,
.fade-shrink-leave-to .explorer-controls {
  padding-top: 0;
}

@media (prefers-reduced-motion: reduce) {
  .fade-shrink-enter-active,
  .fade-shrink-leave-active,
  .fade-shrink-enter-active .explorer-controls,
  .fade-shrink-leave-active .explorer-controls {
    transition: none;
  }

  .toggle input[type='checkbox'],
  .toggle input[type='checkbox']::before {
    transition: none;
  }
}
</style>
