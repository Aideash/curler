<script setup lang="ts">
import SchemaInputFieldList from './SchemaInputFieldList.vue'
import SchemaEnumValueList from './SchemaEnumValueList.vue'
import SchemaTreeLevel from './SchemaTreeLevel.vue'
import {
  pathSegmentField,
  pathSegmentInlineFragment,
  presenceArgKey,
  presenceFieldKey,
  presenceFragmentKey,
  type PathSegment,
  type QueryPresence,
  type RootOperation,
  type SchemaArgNode,
  type SchemaFieldNode,
  type SchemaFragmentTypeNode,
} from '../lib/graphqlQueryBuilder'

const props = defineProps<{
  fragmentTypes: SchemaFragmentTypeNode[]
  /** Path to the abstract field that owns these fragment branches. */
  fieldPath: PathSegment[]
  ownerTypeName: string
  loadFragmentMemberFields: (ownerTypeName: string, concreteTypeName: string) => SchemaFieldNode[]
  operation: RootOperation
  depth: number
  pathPrefix: string
  expanded: Set<string>
  expandedFragments: Set<string>
  insertModeOn: boolean
  showArgsOn: boolean
  filter: string
  presence: QueryPresence
  expandedArgs: Set<string>
  expandedInput: Set<string>
  visibleFields: (op: RootOperation, path: PathSegment[]) => SchemaFieldNode[]
  visibleArgs: (field: SchemaFieldNode, needle: string) => SchemaArgNode[]
  visibleInterfaceFields: (field: SchemaFieldNode, needle: string) => SchemaFieldNode[]
  visibleFragmentTypes: (field: SchemaFieldNode, needle: string) => SchemaFragmentTypeNode[]
  isExpanded: (op: RootOperation, path: PathSegment[]) => boolean
}>()

const emit = defineEmits<{
  toggleFragment: [key: string]
  toggleArg: [key: string]
  toggleInput: [key: string]
  toggle: [operation: RootOperation, path: PathSegment[]]
  insert: [operation: RootOperation, parentPath: PathSegment[], fieldName: string]
  insertArg: [
    operation: RootOperation,
    parentPath: PathSegment[],
    fieldName: string,
    argName: string,
  ]
  insertFragment: [operation: RootOperation, fieldPath: PathSegment[], typeName: string]
}>()

function fragmentKey(typeName: string) {
  return `${props.pathPrefix}::fragment::${typeName}`
}

function isFragmentExpanded(typeName: string) {
  return props.expandedFragments.has(fragmentKey(typeName))
}

function fragmentParentPath(typeName: string): PathSegment[] {
  return [...props.fieldPath, pathSegmentInlineFragment(typeName)]
}

function fragmentFields(typeName: string): SchemaFieldNode[] {
  if (!isFragmentExpanded(typeName)) return []
  return props.loadFragmentMemberFields(props.ownerTypeName, typeName)
}

function fieldPathPrefix(fragmentTypeName: string, fieldName: string) {
  return `${fragmentKey(fragmentTypeName)}::${fieldName}`
}

function canExpandField(field: SchemaFieldNode) {
  if (field.cyclicReturn) {
    return props.showArgsOn && field.args.length > 0
  }
  return (
    field.composite ||
    field.abstractReturn !== 'none' ||
    (props.showArgsOn && field.args.length > 0)
  )
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

function argExpandKey(fragmentTypeName: string, field: SchemaFieldNode, arg: SchemaArgNode) {
  return `${fieldPathPrefix(fragmentTypeName, field.name)}::${arg.name}`
}

function isArgExpanded(fragmentTypeName: string, field: SchemaFieldNode, arg: SchemaArgNode) {
  return props.expandedArgs.has(argExpandKey(fragmentTypeName, field, arg))
}

function isFieldSectionExpanded(fragmentTypeName: string, field: SchemaFieldNode) {
  return props.expandedFragments.has(`${fieldPathPrefix(fragmentTypeName, field.name)}::section`)
}

function toggleFieldSection(fragmentTypeName: string, field: SchemaFieldNode) {
  emit('toggleFragment', `${fieldPathPrefix(fragmentTypeName, field.name)}::section`)
}

function fieldInQuery(fragmentTypeName: string, field: SchemaFieldNode) {
  return props.presence.fields.has(
    presenceFieldKey(fragmentParentPath(fragmentTypeName), field.name),
  )
}

function argInQuery(fragmentTypeName: string, field: SchemaFieldNode, arg: SchemaArgNode) {
  return props.presence.args.has(
    presenceArgKey(fragmentParentPath(fragmentTypeName), field.name, arg.name),
  )
}

function onFieldClick(fragmentTypeName: string, field: SchemaFieldNode) {
  if (canExpandField(field) && !isFieldSectionExpanded(fragmentTypeName, field)) {
    toggleFieldSection(fragmentTypeName, field)
  }
  if (props.insertModeOn) {
    emit('insert', props.operation, fragmentParentPath(fragmentTypeName), field.name)
  }
}

function onArgClick(fragmentTypeName: string, field: SchemaFieldNode, arg: SchemaArgNode) {
  if (!props.insertModeOn || argInQuery(fragmentTypeName, field, arg)) return
  emit('insertArg', props.operation, fragmentParentPath(fragmentTypeName), field.name, arg.name)
}

function childPath(fragmentTypeName: string, fieldName: string): PathSegment[] {
  return [...fragmentParentPath(fragmentTypeName), pathSegmentField(fieldName)]
}

function fragmentPresenceKey(typeName: string) {
  return presenceFragmentKey(props.fieldPath, typeName)
}

function fragmentInQuery(typeName: string) {
  return props.presence.fragments.has(fragmentPresenceKey(typeName))
}

function fragmentIsPlaceholder(typeName: string) {
  return props.presence.placeholderFragments.has(fragmentPresenceKey(typeName))
}

function onFragmentTypeClick(typeName: string) {
  if (!isFragmentExpanded(typeName)) {
    emit('toggleFragment', fragmentKey(typeName))
  }
  if (props.insertModeOn) {
    emit('insertFragment', props.operation, props.fieldPath, typeName)
  }
}
</script>

<template>
  <ul class="fragment-types-list">
    <li v-for="fragment in fragmentTypes" :key="fragment.typeName" class="fragment-type-row">
      <div class="row" :style="{ '--depth': depth }">
        <button
          type="button"
          class="ghost expand"
          :title="isFragmentExpanded(fragment.typeName) ? 'Collapse' : 'Expand'"
          @click.stop="emit('toggleFragment', fragmentKey(fragment.typeName))"
        >
          <span class="material-icons sm">{{
            isFragmentExpanded(fragment.typeName) ? 'expand_more' : 'chevron_right'
          }}</span>
        </button>
        <button
          type="button"
          class="ghost fragment-type-label"
          :class="{
            'in-query':
              fragmentInQuery(fragment.typeName) && !fragmentIsPlaceholder(fragment.typeName),
            'placeholder-only': fragmentIsPlaceholder(fragment.typeName),
          }"
          :title="
            fragmentIsPlaceholder(fragment.typeName)
              ? `Inline fragment on ${fragment.typeName} (placeholder)`
              : fragment.description || `Inline fragment on ${fragment.typeName}`
          "
          @click="onFragmentTypeClick(fragment.typeName)"
        >
          <span class="fragment-type-name">... on {{ fragment.typeName }}</span>
        </button>
      </div>

      <ul v-if="isFragmentExpanded(fragment.typeName)" class="fragment-fields-list">
        <li
          v-for="field in fragmentFields(fragment.typeName)"
          :key="field.name"
          class="fragment-field-row"
        >
          <div class="row" :style="{ '--depth': depth + 1 }">
            <button
              v-if="canExpandField(field)"
              type="button"
              class="ghost expand"
              :title="isFieldSectionExpanded(fragment.typeName, field) ? 'Collapse' : 'Expand'"
              @click.stop="toggleFieldSection(fragment.typeName, field)"
            >
              <span class="material-icons sm">{{
                isFieldSectionExpanded(fragment.typeName, field) ? 'expand_more' : 'chevron_right'
              }}</span>
            </button>
            <span v-else class="expand-spacer" />
            <button
              type="button"
              class="ghost fragment-field-btn"
              :class="{ 'in-query': fieldInQuery(fragment.typeName, field) }"
              :title="
                fieldInQuery(fragment.typeName, field)
                  ? `${field.description || field.name} (in query)`
                  : field.description || field.name
              "
              @click="onFieldClick(fragment.typeName, field)"
            >
              <span class="fragment-field-name">{{ field.name }}</span>
              <span class="fragment-field-meta faint">
                {{ field.argsSummary }}<template v-if="field.argsSummary">: </template
                >{{ field.typeLabel }}<template v-if="field.cyclicReturn"> (cyclic)</template>
              </span>
            </button>
          </div>

          <ul
            v-if="
              showArgsOn &&
              isFieldSectionExpanded(fragment.typeName, field) &&
              visibleArgs(field, filter.trim().toLowerCase()).length
            "
            class="args-list"
          >
            <template
              v-for="arg in visibleArgs(field, filter.trim().toLowerCase())"
              :key="arg.name"
            >
              <li class="arg-row" :style="{ '--depth': depth + 2 }">
                <button
                  v-if="canExpandArg(arg)"
                  type="button"
                  class="ghost expand"
                  :title="isArgExpanded(fragment.typeName, field, arg) ? 'Collapse' : 'Expand'"
                  @click.stop="emit('toggleArg', argExpandKey(fragment.typeName, field, arg))"
                >
                  <span class="material-icons sm">{{
                    isArgExpanded(fragment.typeName, field, arg) ? 'expand_more' : 'chevron_right'
                  }}</span>
                </button>
                <span v-else class="expand-spacer" />
                <button
                  type="button"
                  class="ghost arg-btn"
                  :class="{
                    'insert-disabled': !insertModeOn || argInQuery(fragment.typeName, field, arg),
                    'in-query': argInQuery(fragment.typeName, field, arg),
                  }"
                  :title="
                    argInQuery(fragment.typeName, field, arg)
                      ? `${field.name}.${arg.name} (in query)`
                      : arg.description || `${field.name}.${arg.name}`
                  "
                  @click="onArgClick(fragment.typeName, field, arg)"
                >
                  <span class="arg-name">{{ arg.name }}</span>
                  <span class="arg-meta faint">{{ arg.typeLabel }}</span>
                </button>
              </li>
              <li
                v-if="canExpandArg(arg) && isArgExpanded(fragment.typeName, field, arg)"
                class="arg-nesting"
                :style="{ '--depth': depth + 2 }"
              >
                <SchemaInputFieldList
                  v-if="argNestingKind(arg) === 'input'"
                  :fields="arg.inputFields"
                  :depth="depth + 3"
                  :expanded="expandedInput"
                  :path-prefix="argExpandKey(fragment.typeName, field, arg)"
                  @toggle="(key) => emit('toggleInput', key)"
                />
                <SchemaEnumValueList
                  v-else-if="argNestingKind(arg) === 'enum'"
                  :values="arg.enumValues"
                  :depth="depth + 3"
                />
              </li>
            </template>
          </ul>

          <SchemaTreeLevel
            v-if="
              field.abstractReturn === 'interface' &&
              !field.cyclicReturn &&
              isFieldSectionExpanded(fragment.typeName, field) &&
              visibleInterfaceFields(field, filter.trim().toLowerCase()).length
            "
            :operation="operation"
            :parent-path="childPath(fragment.typeName, field.name)"
            :depth="depth + 2"
            :fields="visibleInterfaceFields(field, filter.trim().toLowerCase())"
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
              isFieldSectionExpanded(fragment.typeName, field) &&
              !field.cyclicReturn &&
              field.abstractReturn !== 'none' &&
              visibleFragmentTypes(field, filter.trim().toLowerCase()).length
            "
            :fragment-types="visibleFragmentTypes(field, filter.trim().toLowerCase())"
            :field-path="childPath(fragment.typeName, field.name)"
            :owner-type-name="field.returnTypeName"
            :load-fragment-member-fields="loadFragmentMemberFields"
            :operation="operation"
            :depth="depth + 2"
            :path-prefix="fieldPathPrefix(fragment.typeName, field.name)"
            :expanded="expanded"
            :expanded-fragments="expandedFragments"
            :insert-mode-on="insertModeOn"
            :show-args-on="showArgsOn"
            :filter="filter"
            :presence="presence"
            :expanded-args="expandedArgs"
            :expanded-input="expandedInput"
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
            v-if="
              field.composite &&
              field.abstractReturn === 'none' &&
              isFieldSectionExpanded(fragment.typeName, field)
            "
            :operation="operation"
            :parent-path="childPath(fragment.typeName, field.name)"
            :depth="depth + 2"
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
    </li>
  </ul>
</template>

<style scoped>
.fragment-types-list,
.fragment-fields-list,
.args-list {
  list-style: none;
  margin: 0;
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

.fragment-type-label {
  flex: 1;
  min-width: 0;
  display: block;
  text-align: left;
  padding: 2px 6px;
  border: 1px dashed var(--accent-dim);
  border-radius: var(--radius);
  cursor: pointer;
}

.fragment-type-label:hover {
  background: var(--bg-hover);
}

.fragment-type-label.in-query {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.fragment-type-label.placeholder-only {
  opacity: 0.65;
  border-style: dotted;
  background: color-mix(in srgb, var(--accent) 5%, transparent);
}

.fragment-type-name {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--accent);
}

.fragment-field-btn {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  padding: 2px 6px;
  border-left: 2px dashed var(--accent-dim);
}

.fragment-field-btn:hover {
  background: var(--bg-hover);
}

.fragment-field-btn.in-query {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.fragment-field-name,
.arg-name {
  font-family: var(--mono);
  font-size: 12px;
}

.fragment-field-meta,
.arg-meta {
  font-size: 11px;
  word-break: break-all;
}

.arg-row {
  display: flex;
  align-items: flex-start;
  gap: 2px;
  padding-left: calc(var(--depth, 0) * 14px);
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

.arg-nesting {
  list-style: none;
  margin: 0;
  padding: 0;
  padding-left: calc(var(--depth, 0) * 14px + 24px);
}
</style>
