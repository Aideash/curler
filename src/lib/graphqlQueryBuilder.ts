import {
  Kind,
  getNamedType,
  isInputObjectType,
  isEnumType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isUnionType,
  parse,
  print,
  type DocumentNode,
  type FieldNode,
  type GraphQLArgument,
  type GraphQLField,
  type GraphQLInputField,
  type GraphQLInputType,
  type GraphQLInterfaceType,
  type GraphQLObjectType,
  type GraphQLSchema,
  type GraphQLType,
  type GraphQLUnionType,
  type InlineFragmentNode,
  type OperationDefinitionNode,
  type OperationTypeNode,
  type SelectionSetNode,
  type ValueNode,
  type VariableDefinitionNode,
} from 'graphql'
import { uid, type GraphqlBody, type KeyValue } from '../types'

export type RootOperation = 'query' | 'mutation' | 'subscription'

/** How argument values are written when inserting fields or args from the explorer. */
export type ArgInsertMode = 'placeholder' | 'required-vars' | 'variables-only'

const ARG_INSERT_MODE_STORAGE_KEY = 'curler.graphqlBuilder.argInsertMode'

export function loadArgInsertMode(): ArgInsertMode {
  try {
    const stored = sessionStorage.getItem(ARG_INSERT_MODE_STORAGE_KEY)
    if (stored === 'placeholder' || stored === 'required-vars' || stored === 'variables-only') {
      return stored
    }
  } catch {
    // sessionStorage unavailable
  }
  return 'required-vars'
}

export function saveArgInsertMode(mode: ArgInsertMode) {
  try {
    sessionStorage.setItem(ARG_INSERT_MODE_STORAGE_KEY, mode)
  } catch {
    // ignore
  }
}

/** How fields and related schema nodes are ordered in the explorer tree. */
export type SchemaExplorerSortMode = 'schema' | 'alphabetical'

const SCHEMA_EXPLORER_SORT_STORAGE_KEY = 'curler.graphqlBuilder.schemaExplorerSort'

export function loadSchemaExplorerSortMode(): SchemaExplorerSortMode {
  try {
    const stored = sessionStorage.getItem(SCHEMA_EXPLORER_SORT_STORAGE_KEY)
    if (stored === 'schema' || stored === 'alphabetical') return stored
  } catch {
    // sessionStorage unavailable
  }
  return 'schema'
}

export function saveSchemaExplorerSortMode(mode: SchemaExplorerSortMode) {
  try {
    sessionStorage.setItem(SCHEMA_EXPLORER_SORT_STORAGE_KEY, mode)
  } catch {
    // ignore
  }
}

export function sortExplorerList<T>(
  items: readonly T[],
  mode: SchemaExplorerSortMode,
  label: (item: T) => string,
): T[] {
  if (mode === 'schema') return [...items]
  return [...items].sort((a, b) =>
    label(a).localeCompare(label(b), undefined, { sensitivity: 'base' }),
  )
}

export function explorerNodeTitle(
  node: {
    name: string
    description?: string
    deprecated?: boolean
    deprecationReason?: string
  },
  suffix?: string,
): string {
  const parts: string[] = []
  if (node.deprecated) {
    parts.push(node.deprecationReason ? `Deprecated: ${node.deprecationReason}` : 'Deprecated')
  }
  if (node.description) parts.push(node.description)
  if (!parts.length) parts.push(node.name)
  if (suffix) parts.push(suffix)
  return parts.join(' — ')
}

export interface FieldClickTarget {
  operation: RootOperation
  /** Path from the operation root to the parent selection set of the clicked field. */
  parentPath: PathSegment[]
  fieldName: string
}

export interface ArgClickTarget {
  operation: RootOperation
  parentPath: PathSegment[]
  fieldName: string
  argName: string
}

/** One step in a schema/query path — either a field or an inline fragment branch. */
export type PathSegment =
  { kind: 'field'; name: string } | { kind: 'inlineFragment'; typeName: string }

export function pathSegmentField(name: string): PathSegment {
  return { kind: 'field', name }
}

export function pathSegmentInlineFragment(typeName: string): PathSegment {
  return { kind: 'inlineFragment', typeName }
}

/** Field-name segments only (for expand keys and legacy string paths). */
export function fieldPathFromSegments(segments: PathSegment[]): string[] {
  return segments.filter((segment) => segment.kind === 'field').map((segment) => segment.name)
}

function pathSegmentKey(segment: PathSegment): string {
  return segment.kind === 'field' ? segment.name : `...on${segment.typeName}`
}

export interface FragmentClickTarget {
  operation: RootOperation
  /** Path to the abstract field (including it). */
  fieldPath: PathSegment[]
  typeName: string
}

export interface InsertFieldResult {
  query: string
  variables: KeyValue[]
}

type CompositeType = GraphQLObjectType | GraphQLInterfaceType
type SelectionHost = GraphQLObjectType | GraphQLInterfaceType | GraphQLUnionType

export type AbstractReturnKind = 'none' | 'interface' | 'union'

/** A concrete type branch under a union or interface field (... on Type). */
export interface SchemaFragmentTypeNode {
  typeName: string
  description?: string
}

/** Describe a field for the schema explorer tree. */
export interface SchemaFieldNode {
  name: string
  description?: string
  deprecated: boolean
  deprecationReason?: string
  typeLabel: string
  /** Named GraphQL type of this field's return value. */
  returnTypeName: string
  composite: boolean
  abstractReturn: AbstractReturnKind
  /** True when this field's return type is already being expanded (e.g. Node.parent: Node). */
  cyclicReturn: boolean
  fragmentTypes: SchemaFragmentTypeNode[]
  argsSummary: string
  args: SchemaArgNode[]
}

type FieldBuildMeta = {
  node: FieldNode
  variableDefinitions: VariableDefinitionNode[]
}

function cloneVariables(rows: KeyValue[]): KeyValue[] {
  return JSON.parse(JSON.stringify(rows))
}

function operationKind(op: RootOperation): OperationTypeNode {
  return op
}

function rootType(schema: GraphQLSchema, op: RootOperation): GraphQLObjectType | null | undefined {
  if (op === 'mutation') return schema.getMutationType()
  if (op === 'subscription') return schema.getSubscriptionType()
  return schema.getQueryType()
}

function typeLabel(type: GraphQLType): string {
  if (isNonNullType(type)) return `${typeLabel(type.ofType)}!`
  if (isListType(type)) return `[${typeLabel(type.ofType)}]`
  return type.toString()
}

function uniqueVarName(base: string, used: Set<string>): string {
  let name = base.replace(/[^A-Za-z0-9_]/g, '')
  if (!name) name = 'arg'
  if (!/^[A-Za-z_]/.test(name)) name = `_${name}`

  let candidate = name
  let index = 2
  while (used.has(candidate)) {
    candidate = `${name}${index}`
    index += 1
  }
  used.add(candidate)
  return candidate
}

function collectVariableNames(doc: DocumentNode): Set<string> {
  const names = new Set<string>()
  for (const def of doc.definitions) {
    if (def.kind !== Kind.OPERATION_DEFINITION || !def.variableDefinitions) continue
    for (const varDef of def.variableDefinitions) {
      names.add(varDef.variable.name.value)
    }
  }
  return names
}

function defaultValueNode(value: unknown): ValueNode | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'boolean') return { kind: Kind.BOOLEAN, value }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { kind: Kind.INT, value: String(value) }
      : { kind: Kind.FLOAT, value: String(value) }
  }
  if (typeof value === 'string') return { kind: Kind.STRING, value, block: false }
  if (Array.isArray(value)) {
    return {
      kind: Kind.LIST,
      values: value.map((item) => defaultValueNode(item) ?? { kind: Kind.NULL }),
    }
  }
  if (typeof value === 'object') {
    const fields = Object.entries(value as Record<string, unknown>).map(([name, fieldValue]) => ({
      kind: Kind.OBJECT_FIELD,
      name: { kind: Kind.NAME, value: name },
      value: defaultValueNode(fieldValue) ?? { kind: Kind.NULL },
    }))
    return { kind: Kind.OBJECT, fields } as ValueNode
  }
  return undefined
}

function inputTypeToTypeNode(type: GraphQLInputType): VariableDefinitionNode['type'] {
  if (isNonNullType(type)) {
    const inner = inputTypeToTypeNode(type.ofType)
    if (inner.kind === Kind.NON_NULL_TYPE) return inner
    return { kind: Kind.NON_NULL_TYPE, type: inner }
  }
  if (isListType(type)) {
    const inner = inputTypeToTypeNode(type.ofType)
    return { kind: Kind.LIST_TYPE, type: inner.kind === Kind.NON_NULL_TYPE ? inner : inner }
  }
  return { kind: Kind.NAMED_TYPE, name: { kind: Kind.NAME, value: getNamedType(type).name } }
}

function defaultScalarValue(type: GraphQLType): unknown {
  const named = getNamedType(type)
  if (named.name === 'String' || named.name === 'ID') return ''
  if (named.name === 'Int' || named.name === 'Float') return 0
  if (named.name === 'Boolean') return false
  return null
}

/** Build a JSON-ready default for an input type, filling required fields recursively. */
function defaultInputValue(type: GraphQLInputType): unknown {
  if (isNonNullType(type)) return defaultInputValue(type.ofType)
  if (isListType(type)) return []

  const named = getNamedType(type)
  if (isInputObjectType(named)) {
    const obj: Record<string, unknown> = {}
    for (const field of Object.values(named.getFields())) {
      const hasDefault = field.defaultValue !== undefined
      const required = isNonNullType(field.type) && !hasDefault
      if (required) obj[field.name] = defaultInputValue(field.type)
    }
    return obj
  }

  return defaultScalarValue(type)
}

function defaultVariableCell(type: GraphQLInputType): string {
  const named = getNamedType(type)
  if (isInputObjectType(named)) {
    return JSON.stringify(defaultInputValue(type), null, 2)
  }
  if (named.name === 'String' || named.name === 'ID') return '""'
  if (named.name === 'Int' || named.name === 'Float') return '0'
  if (named.name === 'Boolean') return 'false'
  return 'null'
}

function needsSelectionSet(type: GraphQLType): boolean {
  const named = getNamedType(type)
  return isObjectType(named) || isInterfaceType(named)
}

type ArgBuildResult = {
  argument: NonNullable<FieldNode['arguments']>[number]
  variableDefinition: VariableDefinitionNode
  variableRow: { name: string; value: string }
}

type ArgInsertion =
  | {
      kind: 'literal'
      argument: NonNullable<FieldNode['arguments']>[number]
    }
  | (ArgBuildResult & { kind: 'variable' })

type ArgInsertContext = 'field-auto' | 'arg-click'

function shouldUseVariable(arg: GraphQLArgument, mode: ArgInsertMode): boolean {
  if (mode === 'placeholder') return false
  if (mode === 'variables-only') return true

  const hasDefault = arg.defaultValue !== undefined
  const required = isNonNullType(arg.type) && !hasDefault
  return required
}

function literalPlaceholderValueNode(type: GraphQLInputType): ValueNode {
  const named = getNamedType(type)
  if (isEnumType(named)) return { kind: Kind.NULL }
  return defaultValueNode(defaultInputValue(type)) ?? { kind: Kind.NULL }
}

function variableRowValue(arg: GraphQLArgument): string {
  if (arg.defaultValue !== undefined) {
    return JSON.stringify(arg.defaultValue)
  }
  return defaultVariableCell(arg.type)
}

function buildVariableArg(arg: GraphQLArgument, variableNames: Set<string>): ArgBuildResult {
  const varName = uniqueVarName(arg.name, variableNames)
  return {
    argument: {
      kind: Kind.ARGUMENT,
      name: { kind: Kind.NAME, value: arg.name },
      value: { kind: Kind.VARIABLE, name: { kind: Kind.NAME, value: varName } },
    },
    variableDefinition: {
      kind: Kind.VARIABLE_DEFINITION,
      variable: { kind: Kind.VARIABLE, name: { kind: Kind.NAME, value: varName } },
      type: inputTypeToTypeNode(arg.type),
    },
    variableRow: { name: varName, value: variableRowValue(arg) },
  }
}

function buildArgInsertion(
  arg: GraphQLArgument,
  mode: ArgInsertMode,
  context: ArgInsertContext,
  variableNames: Set<string>,
): ArgInsertion | null {
  const hasDefault = arg.defaultValue !== undefined
  const required = isNonNullType(arg.type) && !hasDefault

  if (context === 'field-auto' && !required && !hasDefault) return null

  if (shouldUseVariable(arg, mode)) {
    return { kind: 'variable', ...buildVariableArg(arg, variableNames) }
  }

  const value = hasDefault
    ? defaultValueNode(arg.defaultValue)
    : literalPlaceholderValueNode(arg.type)

  if (!value) return null

  return {
    kind: 'literal',
    argument: {
      kind: Kind.ARGUMENT,
      name: { kind: Kind.NAME, value: arg.name },
      value,
    },
  }
}

function appendArgInsertion(
  fieldNode: MutableFieldNode,
  op: MutableOperation,
  insertion: ArgInsertion,
  variables: KeyValue[],
) {
  const args = [...(fieldNode.arguments ?? [])]
  args.push(insertion.argument)
  fieldNode.arguments = args

  if (insertion.kind === 'variable') {
    mergeVariableDefinitions(op, [insertion.variableDefinition])
    insertVariableRow(variables, insertion.variableRow)
  }
}

function isBlankVariableRow(row: KeyValue): boolean {
  return row.name.trim() === '' && row.value.trim() === ''
}

/** Insert before the trailing blank row so list order stays stable in the UI. */
function insertVariableRow(variables: KeyValue[], row: { name: string; value: string }) {
  if (variables.some((existing) => existing.name === row.name)) return

  const entry: KeyValue = {
    id: uid(),
    name: row.name,
    value: row.value,
    enabled: true,
  }

  const blankIndex = variables.findIndex(isBlankVariableRow)
  if (blankIndex >= 0) variables.splice(blankIndex, 0, entry)
  else variables.push(entry)
}

function buildFieldMeta(
  field: GraphQLField<unknown, unknown>,
  variableNames: Set<string>,
  variables: KeyValue[],
  mode: ArgInsertMode,
): FieldBuildMeta {
  const args: Array<NonNullable<FieldNode['arguments']>[number]> = []
  const variableDefinitions: VariableDefinitionNode[] = []

  for (const arg of field.args) {
    const insertion = buildArgInsertion(arg, mode, 'field-auto', variableNames)
    if (!insertion) continue

    args.push(insertion.argument)
    if (insertion.kind === 'variable') {
      variableDefinitions.push(insertion.variableDefinition)
      insertVariableRow(variables, insertion.variableRow)
    }
  }

  const selectionSet: SelectionSetNode | undefined = needsSelectionSet(field.type)
    ? { kind: Kind.SELECTION_SET, selections: [] }
    : undefined

  return {
    node: {
      kind: Kind.FIELD,
      name: { kind: Kind.NAME, value: field.name },
      arguments: args.length ? args : undefined,
      selectionSet,
    },
    variableDefinitions,
  }
}

type MutableInlineFragmentNode = InlineFragmentNode & {
  selectionSet: MutableSelectionSet
}

type MutableSelectionSet = SelectionSetNode & {
  selections: Array<MutableFieldNode | MutableInlineFragmentNode>
}

type MutableFieldNode = FieldNode & {
  arguments?: FieldNode['arguments']
  selectionSet?: MutableSelectionSet
}

type MutableOperation = OperationDefinitionNode & {
  selectionSet: MutableSelectionSet
  variableDefinitions?: VariableDefinitionNode[]
}

type MutableDocument = {
  kind: typeof Kind.DOCUMENT
  definitions: MutableOperation[]
}

function emptyDocument(operation: RootOperation): MutableDocument {
  return {
    kind: Kind.DOCUMENT,
    definitions: [
      {
        kind: Kind.OPERATION_DEFINITION,
        operation: operationKind(operation),
        selectionSet: { kind: Kind.SELECTION_SET, selections: [] },
      },
    ],
  }
}

function parseMutable(query: string, operation: RootOperation): MutableDocument {
  const trimmed = query.trim()
  if (!trimmed) return emptyDocument(operation)
  return asMutable(parse(trimmed))
}

function asMutable(doc: DocumentNode): MutableDocument {
  return JSON.parse(JSON.stringify(doc)) as MutableDocument
}

function ensureOperation(doc: MutableDocument, operation: RootOperation): MutableOperation {
  const existing = doc.definitions.find(
    (def) =>
      def.kind === Kind.OPERATION_DEFINITION &&
      (def.operation === operation || (!def.name && operation === 'query')),
  )

  if (existing) {
    if (!existing.selectionSet) {
      existing.selectionSet = { kind: Kind.SELECTION_SET, selections: [] }
    }
    return existing
  }

  const op: MutableOperation = {
    kind: Kind.OPERATION_DEFINITION,
    operation: operationKind(operation),
    selectionSet: { kind: Kind.SELECTION_SET, selections: [] },
  }
  doc.definitions.unshift(op)
  return op
}

function mergeVariableDefinitions(op: MutableOperation, defs: VariableDefinitionNode[]) {
  if (!defs.length) return
  if (!op.variableDefinitions) op.variableDefinitions = []
  const existing = new Set(op.variableDefinitions.map((def) => def.variable.name.value))
  for (const def of defs) {
    const name = def.variable.name.value
    if (!existing.has(name)) {
      op.variableDefinitions.push(def)
      existing.add(name)
    }
  }
}

function resolveSelectionHostType(type: GraphQLType): SelectionHost | null {
  const named = getNamedType(type)
  if (isObjectType(named) || isInterfaceType(named) || isUnionType(named)) return named
  return null
}

function isConcretePossibleType(
  schema: GraphQLSchema,
  abstractType: GraphQLInterfaceType | GraphQLUnionType,
  concrete: GraphQLObjectType,
): boolean {
  return schema.getPossibleTypes(abstractType).some((type) => type.name === concrete.name)
}

function resolveHostType(
  schema: GraphQLSchema,
  operation: RootOperation,
  parentPath: PathSegment[],
): CompositeType | null {
  const root = rootType(schema, operation)
  if (!root) return null

  let host: SelectionHost = root
  for (const segment of parentPath) {
    if (segment.kind === 'field') {
      if (isUnionType(host)) return null
      const fieldDef = host.getFields()[segment.name]
      if (!fieldDef) return null
      const next = resolveSelectionHostType(fieldDef.type)
      if (!next) return null
      host = next
    } else {
      if (!isInterfaceType(host) && !isUnionType(host)) return null
      const concrete = schema.getType(segment.typeName)
      if (!concrete || !isObjectType(concrete)) return null
      if (!isConcretePossibleType(schema, host, concrete)) return null
      host = concrete
    }
  }

  if (isUnionType(host)) return null
  return host
}

function findSelectionSet(
  op: MutableOperation,
  schema: GraphQLSchema,
  operation: RootOperation,
  parentPath: PathSegment[],
  mode: ArgInsertMode,
  variables: KeyValue[],
): MutableSelectionSet {
  const root = rootType(schema, operation)
  if (!root) throw new Error(`Schema has no ${operation} root type`)

  let host: SelectionHost = root
  let currentSet = op.selectionSet

  for (const segment of parentPath) {
    if (segment.kind === 'field') {
      if (isUnionType(host)) {
        throw new Error(`Cannot select field "${segment.name}" on union type ${host.name}`)
      }
      const fieldDef = host.getFields()[segment.name]
      if (!fieldDef) throw new Error(`Unknown field "${segment.name}" on ${host.name}`)

      let fieldNode = currentSet.selections.find(
        (sel): sel is MutableFieldNode =>
          sel.kind === Kind.FIELD && sel.name.value === segment.name,
      )

      if (!fieldNode) {
        const variableNames = collectVariableNames({ kind: Kind.DOCUMENT, definitions: [op] })
        const built = buildFieldMeta(fieldDef, variableNames, variables, mode)
        fieldNode = built.node as MutableFieldNode
        currentSet.selections.push(fieldNode)
        mergeVariableDefinitions(op, built.variableDefinitions)
      }

      if (!fieldNode.selectionSet) {
        fieldNode.selectionSet = { kind: Kind.SELECTION_SET, selections: [] }
      }

      const nextHost = resolveSelectionHostType(fieldDef.type)
      if (!nextHost) throw new Error(`"${segment.name}" is not a composite type`)
      host = nextHost
      currentSet = fieldNode.selectionSet
    } else {
      if (!isInterfaceType(host) && !isUnionType(host)) {
        throw new Error(`Inline fragment on ${segment.typeName} is not valid on ${host.name}`)
      }

      const concrete = schema.getType(segment.typeName)
      if (!concrete || !isObjectType(concrete)) {
        throw new Error(`Unknown type "${segment.typeName}"`)
      }
      if (!isConcretePossibleType(schema, host, concrete)) {
        throw new Error(`"${segment.typeName}" is not a possible type of ${host.name}`)
      }

      let fragNode = currentSet.selections.find(
        (sel): sel is MutableInlineFragmentNode =>
          sel.kind === Kind.INLINE_FRAGMENT && sel.typeCondition?.name.value === segment.typeName,
      )

      if (!fragNode) {
        fragNode = {
          kind: Kind.INLINE_FRAGMENT,
          typeCondition: {
            kind: Kind.NAMED_TYPE,
            name: { kind: Kind.NAME, value: segment.typeName },
          },
          selectionSet: { kind: Kind.SELECTION_SET, selections: [] },
        }
        currentSet.selections.push(fragNode)
      }

      if (!fragNode.selectionSet) {
        fragNode.selectionSet = { kind: Kind.SELECTION_SET, selections: [] }
      }

      host = concrete
      currentSet = fragNode.selectionSet
    }
  }

  return currentSet
}

function resolveFieldDef(
  schema: GraphQLSchema,
  operation: RootOperation,
  parentPath: PathSegment[],
  fieldName: string,
): { host: CompositeType; fieldDef: GraphQLField<unknown, unknown> } {
  const host = resolveHostType(schema, operation, parentPath)
  if (!host) throw new Error('Invalid field path')

  const fieldDef = host.getFields()[fieldName]
  if (!fieldDef) throw new Error(`Unknown field "${fieldName}" on ${host.name}`)
  return { host, fieldDef }
}

function makeTypenameField(): MutableFieldNode {
  return {
    kind: Kind.FIELD,
    name: { kind: Kind.NAME, value: '__typename' },
  }
}

/** Remove a lone __typename placeholder after a real field is inserted beside it. */
function stripPlaceholderTypenameIfLonely(
  selectionSet: MutableSelectionSet,
  insertedFieldName: string,
) {
  if (insertedFieldName === '__typename') return

  const fieldNodes = selectionSet.selections.filter(
    (sel): sel is MutableFieldNode => sel.kind === Kind.FIELD,
  )
  if (fieldNodes.length !== 2) return

  const hasTypename = fieldNodes.some((node) => node.name.value === '__typename')
  const hasInserted = fieldNodes.some((node) => node.name.value === insertedFieldName)
  if (!hasTypename || !hasInserted) return

  selectionSet.selections = selectionSet.selections.filter(
    (sel) => sel.kind !== Kind.FIELD || sel.name.value !== '__typename',
  ) as MutableSelectionSet['selections']
}

function getOrCreateFieldNode(
  op: MutableOperation,
  schema: GraphQLSchema,
  operation: RootOperation,
  parentPath: PathSegment[],
  fieldName: string,
  fieldDef: GraphQLField<unknown, unknown>,
  variableNames: Set<string>,
  variables: KeyValue[],
  mode: ArgInsertMode,
): MutableFieldNode {
  const selectionSet = findSelectionSet(op, schema, operation, parentPath, mode, variables)
  let fieldNode = selectionSet.selections.find(
    (sel): sel is MutableFieldNode => sel.kind === Kind.FIELD && sel.name.value === fieldName,
  )

  if (!fieldNode) {
    const built = buildFieldMeta(fieldDef, variableNames, variables, mode)
    fieldNode = built.node as MutableFieldNode
    selectionSet.selections.push(fieldNode)
    mergeVariableDefinitions(op, built.variableDefinitions)
    stripPlaceholderTypenameIfLonely(selectionSet, fieldName)
  }

  return fieldNode
}

function fieldHasArg(fieldNode: MutableFieldNode, argName: string): boolean {
  return (
    fieldNode.arguments?.some((arg) => arg.kind === Kind.ARGUMENT && arg.name.value === argName) ??
    false
  )
}

/**
 * Inserts a field from the schema explorer into the query, creating parent
 * fields and variable definitions as needed.
 */
export function insertField(
  graphql: GraphqlBody,
  schema: GraphQLSchema,
  target: FieldClickTarget,
  mode: ArgInsertMode = 'required-vars',
): InsertFieldResult {
  const variables = cloneVariables(graphql.variables)
  const doc = parseMutable(graphql.query, target.operation)
  const op = ensureOperation(doc, target.operation)

  const { fieldDef } = resolveFieldDef(
    schema,
    target.operation,
    target.parentPath,
    target.fieldName,
  )

  const selectionSet = findSelectionSet(
    op,
    schema,
    target.operation,
    target.parentPath,
    mode,
    variables,
  )

  const already = selectionSet.selections.some(
    (sel) => sel.kind === Kind.FIELD && sel.name.value === target.fieldName,
  )
  if (already) return { query: print(doc), variables }

  const variableNames = collectVariableNames(doc)
  const built = buildFieldMeta(fieldDef, variableNames, variables, mode)
  selectionSet.selections.push(built.node as MutableFieldNode)
  mergeVariableDefinitions(op, built.variableDefinitions)
  stripPlaceholderTypenameIfLonely(selectionSet, target.fieldName)

  return { query: print(doc), variables }
}

/**
 * Opens an inline fragment branch with a __typename placeholder so the query
 * stays valid until a real field is inserted.
 */
export function insertInlineFragment(
  graphql: GraphqlBody,
  schema: GraphQLSchema,
  target: FragmentClickTarget,
  mode: ArgInsertMode = 'required-vars',
): InsertFieldResult {
  const variables = cloneVariables(graphql.variables)
  const doc = parseMutable(graphql.query, target.operation)
  const op = ensureOperation(doc, target.operation)

  const fragmentPath: PathSegment[] = [
    ...target.fieldPath,
    pathSegmentInlineFragment(target.typeName),
  ]
  const selectionSet = findSelectionSet(op, schema, target.operation, fragmentPath, mode, variables)

  const hasTypename = selectionSet.selections.some(
    (sel) => sel.kind === Kind.FIELD && sel.name.value === '__typename',
  )
  if (!hasTypename) {
    selectionSet.selections.push(makeTypenameField())
  }

  return { query: print(doc), variables }
}

/**
 * Adds an argument to a field in the query, creating the field (with required
 * args and defaults) first when it is not already present.
 */
export function insertArgument(
  graphql: GraphqlBody,
  schema: GraphQLSchema,
  target: ArgClickTarget,
  mode: ArgInsertMode = 'required-vars',
): InsertFieldResult {
  const variables = cloneVariables(graphql.variables)
  const doc = parseMutable(graphql.query, target.operation)
  const op = ensureOperation(doc, target.operation)

  const { fieldDef } = resolveFieldDef(
    schema,
    target.operation,
    target.parentPath,
    target.fieldName,
  )

  const argDef = fieldDef.args.find((arg) => arg.name === target.argName)
  if (!argDef) throw new Error(`Unknown argument "${target.argName}" on "${target.fieldName}"`)

  const variableNames = collectVariableNames(doc)
  const fieldNode = getOrCreateFieldNode(
    op,
    schema,
    target.operation,
    target.parentPath,
    target.fieldName,
    fieldDef,
    variableNames,
    variables,
    mode,
  )

  if (fieldHasArg(fieldNode, target.argName)) {
    return { query: print(doc), variables }
  }

  const insertion = buildArgInsertion(argDef, mode, 'arg-click', collectVariableNames(doc))
  if (!insertion) {
    return { query: print(doc), variables }
  }

  appendArgInsertion(fieldNode, op, insertion, variables)

  return { query: print(doc), variables }
}

export interface QueryPresence {
  fields: Set<string>
  args: Set<string>
  /** Inline fragment paths present (e.g. search...onIssue). */
  fragments: Set<string>
  /** Fragments whose only selected field is a __typename placeholder. */
  placeholderFragments: Set<string>
}

export function presenceFragmentKey(fieldPath: PathSegment[], typeName: string): string {
  return [...fieldPath.map(pathSegmentKey), `...on${typeName}`].join('.')
}

export function presenceFieldKey(parentPath: PathSegment[], fieldName: string): string {
  return [...parentPath.map(pathSegmentKey), fieldName].join('.')
}

export function presenceArgKey(
  parentPath: PathSegment[],
  fieldName: string,
  argName: string,
): string {
  return `${presenceFieldKey(parentPath, fieldName)}::${argName}`
}

function findOperation(
  doc: DocumentNode,
  operation: RootOperation,
): OperationDefinitionNode | null {
  const found = doc.definitions.find(
    (def): def is OperationDefinitionNode =>
      def.kind === Kind.OPERATION_DEFINITION &&
      (def.operation === operation || (!def.name && operation === 'query')),
  )
  return found ?? null
}

function walkSelectionPresence(
  selectionSet: SelectionSetNode,
  parentPath: PathSegment[],
  fields: Set<string>,
  args: Set<string>,
  fragments: Set<string>,
  placeholderFragments: Set<string>,
) {
  for (const sel of selectionSet.selections) {
    if (sel.kind === Kind.FIELD) {
      const fieldName = sel.name.value
      const fieldKey = presenceFieldKey(parentPath, fieldName)
      fields.add(fieldKey)

      if (sel.arguments) {
        for (const arg of sel.arguments) {
          args.add(presenceArgKey(parentPath, fieldName, arg.name.value))
        }
      }

      if (sel.selectionSet) {
        walkSelectionPresence(
          sel.selectionSet,
          [...parentPath, pathSegmentField(fieldName)],
          fields,
          args,
          fragments,
          placeholderFragments,
        )
      }
      continue
    }

    if (sel.kind === Kind.INLINE_FRAGMENT && sel.typeCondition) {
      const typeName = sel.typeCondition.name.value
      const fragmentPath = [...parentPath, pathSegmentInlineFragment(typeName)]
      const fragmentKey = fragmentPath.map(pathSegmentKey).join('.')
      fragments.add(fragmentKey)

      if (sel.selectionSet) {
        const fieldSelections = sel.selectionSet.selections.filter(
          (child) => child.kind === Kind.FIELD,
        )
        if (
          fieldSelections.length === 1 &&
          fieldSelections[0].kind === Kind.FIELD &&
          fieldSelections[0].name.value === '__typename'
        ) {
          placeholderFragments.add(fragmentKey)
        }

        walkSelectionPresence(
          sel.selectionSet,
          fragmentPath,
          fields,
          args,
          fragments,
          placeholderFragments,
        )
      }
    }
  }
}

/** Map field paths and arg keys present in the draft query. */
export function buildQueryPresence(query: string, operation: RootOperation): QueryPresence {
  const fields = new Set<string>()
  const args = new Set<string>()
  const fragments = new Set<string>()
  const placeholderFragments = new Set<string>()
  const trimmed = query.trim()
  if (!trimmed) return { fields, args, fragments, placeholderFragments }

  try {
    const doc = parse(trimmed)
    const op = findOperation(doc, operation)
    if (op?.selectionSet) {
      walkSelectionPresence(op.selectionSet, [], fields, args, fragments, placeholderFragments)
    }
  } catch {
    // Unparseable query — no presence info
  }

  return { fields, args, fragments, placeholderFragments }
}

export interface SourceRange {
  from: number
  to: number
}

function collectPlaceholderTypenameRanges(selectionSet: SelectionSetNode, ranges: SourceRange[]) {
  for (const sel of selectionSet.selections) {
    if (sel.kind === Kind.FIELD) {
      if (sel.selectionSet) {
        collectPlaceholderTypenameRanges(sel.selectionSet, ranges)
      }
      continue
    }

    if (sel.kind === Kind.INLINE_FRAGMENT && sel.selectionSet) {
      const fieldSelections = sel.selectionSet.selections.filter(
        (child) => child.kind === Kind.FIELD,
      )
      if (
        fieldSelections.length === 1 &&
        fieldSelections[0].kind === Kind.FIELD &&
        fieldSelections[0].name.value === '__typename'
      ) {
        const loc = fieldSelections[0].name.loc
        if (loc) ranges.push({ from: loc.start, to: loc.end })
      }
      collectPlaceholderTypenameRanges(sel.selectionSet, ranges)
    }
  }
}

/** Character ranges of lone __typename placeholders inside inline fragments. */
export function findPlaceholderTypenameRanges(
  query: string,
  operation: RootOperation,
): SourceRange[] {
  if (!query.trim()) return []

  try {
    const doc = parse(query)
    const op = findOperation(doc, operation)
    if (!op?.selectionSet) return []

    const ranges: SourceRange[] = []
    collectPlaceholderTypenameRanges(op.selectionSet, ranges)
    return ranges
  } catch {
    return []
  }
}

function describeInputField(field: GraphQLInputField): SchemaInputFieldNode {
  const named = getNamedType(field.type)
  const inputObject = isInputObjectType(named)
  const isEnum = isEnumType(named)
  return {
    name: field.name,
    description: field.description ?? undefined,
    deprecated: field.deprecationReason != null,
    deprecationReason: field.deprecationReason ?? undefined,
    typeLabel: typeLabel(field.type),
    required: isNonNullType(field.type) && field.defaultValue === undefined,
    hasDefault: field.defaultValue !== undefined,
    inputObject,
    inputFields: inputObject ? describeInputFields(field.type) : [],
    isEnum,
    enumValues: isEnum ? describeEnumValues(field.type) : [],
  }
}

function describeEnumValues(type: GraphQLInputType): SchemaEnumValueNode[] {
  const named = getNamedType(type)
  if (!isEnumType(named)) return []
  return named.getValues().map((value) => ({
    name: value.name,
    description: value.description ?? undefined,
    deprecated: value.deprecationReason != null,
    deprecationReason: value.deprecationReason ?? undefined,
  }))
}

function describeInputFields(type: GraphQLInputType): SchemaInputFieldNode[] {
  const named = getNamedType(type)
  if (!isInputObjectType(named)) return []
  return Object.values(named.getFields()).map(describeInputField)
}

/** Describe an enum value for browse-only explorer nesting. */
export interface SchemaEnumValueNode {
  name: string
  description?: string
  deprecated: boolean
  deprecationReason?: string
}

/** Describe an input object field for browse-only explorer nesting. */
export interface SchemaInputFieldNode {
  name: string
  description?: string
  deprecated: boolean
  deprecationReason?: string
  typeLabel: string
  required: boolean
  hasDefault: boolean
  inputObject: boolean
  inputFields: SchemaInputFieldNode[]
  isEnum: boolean
  enumValues: SchemaEnumValueNode[]
}

/** Describe an argument for the schema explorer tree. */
export interface SchemaArgNode {
  name: string
  description?: string
  deprecated: boolean
  deprecationReason?: string
  typeLabel: string
  required: boolean
  hasDefault: boolean
  inputObject: boolean
  inputFields: SchemaInputFieldNode[]
  isEnum: boolean
  enumValues: SchemaEnumValueNode[]
}

function describeArg(arg: GraphQLArgument): SchemaArgNode {
  const named = getNamedType(arg.type)
  const inputObject = isInputObjectType(named)
  const isEnum = isEnumType(named)
  return {
    name: arg.name,
    description: arg.description ?? undefined,
    deprecated: arg.deprecationReason != null,
    deprecationReason: arg.deprecationReason ?? undefined,
    typeLabel: typeLabel(arg.type),
    required: isNonNullType(arg.type) && arg.defaultValue === undefined,
    hasDefault: arg.defaultValue !== undefined,
    inputObject,
    inputFields: inputObject ? describeInputFields(arg.type) : [],
    isEnum,
    enumValues: isEnum ? describeEnumValues(arg.type) : [],
  }
}

function describeInterfaceFragmentsShallow(
  schema: GraphQLSchema,
  interfaceType: GraphQLInterfaceType,
): SchemaFragmentTypeNode[] {
  return schema.getPossibleTypes(interfaceType).map((concrete) => ({
    typeName: concrete.name,
    description: concrete.description ?? undefined,
  }))
}

function describeUnionFragmentsShallow(
  schema: GraphQLSchema,
  unionType: GraphQLUnionType,
): SchemaFragmentTypeNode[] {
  return schema.getPossibleTypes(unionType).map((concrete) => ({
    typeName: concrete.name,
    description: concrete.description ?? undefined,
  }))
}

function describeSchemaField(
  schema: GraphQLSchema,
  field: GraphQLField<unknown, unknown>,
  visiting: Set<string> = new Set(),
): SchemaFieldNode {
  const named = getNamedType(field.type)
  const typeName = named.name
  const isObject = isObjectType(named)
  const isInterface = isInterfaceType(named)
  const isUnion = isUnionType(named)

  let abstractReturn: AbstractReturnKind = 'none'
  let composite = isObject || isInterface
  let cyclicReturn = false
  let fragmentTypes: SchemaFragmentTypeNode[] = []

  if (isUnion) {
    abstractReturn = 'union'
    composite = false
    if (visiting.has(typeName)) {
      cyclicReturn = true
    } else {
      fragmentTypes = describeUnionFragmentsShallow(schema, named)
    }
  } else if (isInterface) {
    abstractReturn = 'interface'
    composite = false
    if (visiting.has(typeName)) {
      cyclicReturn = true
    } else {
      fragmentTypes = describeInterfaceFragmentsShallow(schema, named)
    }
  }

  const requiredArgs = field.args.filter(
    (arg) => isNonNullType(arg.type) && arg.defaultValue === undefined,
  )
  const argsSummary =
    field.args.length === 0
      ? ''
      : requiredArgs.length
        ? `(${requiredArgs.map((arg) => `${arg.name}: ${typeLabel(arg.type)}`).join(', ')})`
        : `(${field.args.map((arg) => arg.name).join(', ')})`

  return {
    name: field.name,
    description: field.description ?? undefined,
    deprecated: field.deprecationReason != null,
    deprecationReason: field.deprecationReason ?? undefined,
    typeLabel: typeLabel(field.type),
    returnTypeName: typeName,
    composite,
    abstractReturn,
    cyclicReturn,
    fragmentTypes,
    argsSummary,
    args: field.args.map(describeArg),
  }
}

/** Common interface fields for an abstract interface return (loaded on expand). */
export function listInterfaceFieldsForType(
  schema: GraphQLSchema,
  interfaceTypeName: string,
): SchemaFieldNode[] {
  try {
    const type = schema.getType(interfaceTypeName)
    if (!type || !isInterfaceType(type)) return []

    const visiting = new Set([interfaceTypeName])
    return Object.values(type.getFields()).map((field) =>
      describeSchemaField(schema, field, visiting),
    )
  } catch (error) {
    console.error('listInterfaceFieldsForType failed', error)
    return []
  }
}

/** Type-specific fields under an inline fragment (... on Type). */
export function listFragmentMemberFields(
  schema: GraphQLSchema,
  ownerTypeName: string,
  concreteTypeName: string,
): SchemaFieldNode[] {
  try {
    const owner = schema.getType(ownerTypeName)
    const concrete = schema.getType(concreteTypeName)
    if (!concrete || !isObjectType(concrete)) return []

    const visiting = new Set([ownerTypeName, concreteTypeName])
    let fields = Object.values(concrete.getFields())

    if (owner && isInterfaceType(owner)) {
      const ifaceFieldNames = new Set(Object.keys(owner.getFields()))
      fields = fields.filter((field) => !ifaceFieldNames.has(field.name))
    } else if (owner && isUnionType(owner)) {
      fields = fields.filter((field) => field.name !== '__typename')
    }

    return fields.map((field) => describeSchemaField(schema, field, visiting))
  } catch (error) {
    console.error('listFragmentMemberFields failed', error)
    return []
  }
}

export function listFields(
  schema: GraphQLSchema,
  operation: RootOperation,
  parentPath: PathSegment[],
): SchemaFieldNode[] {
  try {
    const host = resolveHostType(schema, operation, parentPath)
    if (!host) return []
    return Object.values(host.getFields()).map((field) => describeSchemaField(schema, field))
  } catch (error) {
    console.error('listFields failed', error)
    throw error
  }
}

export function availableOperations(schema: GraphQLSchema): RootOperation[] {
  const ops: RootOperation[] = []
  if (schema.getQueryType()) ops.push('query')
  if (schema.getMutationType()) ops.push('mutation')
  if (schema.getSubscriptionType()) ops.push('subscription')
  return ops
}

function namedTypeFromTypeNode(type: VariableDefinitionNode['type']): string {
  if (type.kind === Kind.NON_NULL_TYPE) return namedTypeFromTypeNode(type.type)
  if (type.kind === Kind.LIST_TYPE) return namedTypeFromTypeNode(type.type)
  return type.name.value
}

/** Map operation variable names to enum value names when the variable type is an enum. */
export function resolveVariableEnumOptions(
  query: string,
  schema: GraphQLSchema,
): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  const trimmed = query.trim()
  if (!trimmed) return result

  try {
    const doc = parse(trimmed)
    for (const def of doc.definitions) {
      if (def.kind !== Kind.OPERATION_DEFINITION || !def.variableDefinitions) continue
      for (const varDef of def.variableDefinitions) {
        const varName = varDef.variable.name.value
        const typeName = namedTypeFromTypeNode(varDef.type)
        const schemaType = schema.getType(typeName)
        if (schemaType && isEnumType(schemaType)) {
          result[varName] = schemaType.getValues().map((value) => value.name)
        }
      }
    }
  } catch {
    // Unparseable query
  }

  return result
}

export function isQueryParsable(query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) return true
  try {
    parse(trimmed)
    return true
  } catch {
    return false
  }
}
