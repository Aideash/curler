import {
  Kind,
  getNamedType,
  isInputObjectType,
  isEnumType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
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

export interface FieldClickTarget {
  operation: RootOperation
  /** Field names from the root type down to the parent of the clicked field. */
  parentPath: string[]
  fieldName: string
}

export interface ArgClickTarget {
  operation: RootOperation
  parentPath: string[]
  fieldName: string
  argName: string
}

export interface InsertFieldResult {
  query: string
  variables: KeyValue[]
}

type CompositeType = GraphQLObjectType | GraphQLInterfaceType

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

type MutableSelectionSet = SelectionSetNode & {
  selections: MutableFieldNode[]
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

function resolveCompositeType(type: GraphQLType): CompositeType | null {
  const named = getNamedType(type)
  if (isObjectType(named) || isInterfaceType(named)) return named
  return null
}

function findSelectionSet(
  op: MutableOperation,
  schema: GraphQLSchema,
  operation: RootOperation,
  parentPath: string[],
  mode: ArgInsertMode,
  variables: KeyValue[],
): MutableSelectionSet {
  const root = rootType(schema, operation)
  if (!root) throw new Error(`Schema has no ${operation} root type`)

  let parentType: CompositeType = root
  let currentSet = op.selectionSet

  for (const segment of parentPath) {
    const fieldDef = parentType.getFields()[segment]
    if (!fieldDef) throw new Error(`Unknown field "${segment}" on ${parentType.name}`)

    let fieldNode = currentSet.selections.find(
      (sel): sel is MutableFieldNode => sel.kind === Kind.FIELD && sel.name.value === segment,
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

    const nextType = resolveCompositeType(fieldDef.type)
    if (!nextType) throw new Error(`"${segment}" is not an object type`)
    parentType = nextType
    currentSet = fieldNode.selectionSet
  }

  return currentSet
}

function resolveFieldDef(
  schema: GraphQLSchema,
  operation: RootOperation,
  parentPath: string[],
  fieldName: string,
): { host: CompositeType; fieldDef: GraphQLField<unknown, unknown> } {
  const root = rootType(schema, operation)
  if (!root) throw new Error(`Schema has no ${operation} root type`)

  let host: CompositeType = root
  for (const segment of parentPath) {
    const field = host.getFields()[segment]
    if (!field) throw new Error(`Unknown field "${segment}"`)
    const next = resolveCompositeType(field.type)
    if (!next) throw new Error(`"${segment}" is not an object type`)
    host = next
  }

  const fieldDef = host.getFields()[fieldName]
  if (!fieldDef) throw new Error(`Unknown field "${fieldName}"`)
  return { host, fieldDef }
}

function getOrCreateFieldNode(
  op: MutableOperation,
  schema: GraphQLSchema,
  operation: RootOperation,
  parentPath: string[],
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
}

export function presenceFieldKey(parentPath: string[], fieldName: string): string {
  return [...parentPath, fieldName].join('.')
}

export function presenceArgKey(parentPath: string[], fieldName: string, argName: string): string {
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
  parentPath: string[],
  fields: Set<string>,
  args: Set<string>,
) {
  for (const sel of selectionSet.selections) {
    if (sel.kind !== Kind.FIELD) continue

    const fieldName = sel.name.value
    const fieldKey = presenceFieldKey(parentPath, fieldName)
    fields.add(fieldKey)

    if (sel.arguments) {
      for (const arg of sel.arguments) {
        args.add(presenceArgKey(parentPath, fieldName, arg.name.value))
      }
    }

    if (sel.selectionSet) {
      walkSelectionPresence(sel.selectionSet, [...parentPath, fieldName], fields, args)
    }
  }
}

/** Map field paths and arg keys present in the draft query. */
export function buildQueryPresence(query: string, operation: RootOperation): QueryPresence {
  const fields = new Set<string>()
  const args = new Set<string>()
  const trimmed = query.trim()
  if (!trimmed) return { fields, args }

  try {
    const doc = parse(trimmed)
    const op = findOperation(doc, operation)
    if (op?.selectionSet) {
      walkSelectionPresence(op.selectionSet, [], fields, args)
    }
  } catch {
    // Unparseable query — no presence info
  }

  return { fields, args }
}

function describeInputField(field: GraphQLInputField): SchemaInputFieldNode {
  const named = getNamedType(field.type)
  const inputObject = isInputObjectType(named)
  const isEnum = isEnumType(named)
  return {
    name: field.name,
    description: field.description ?? undefined,
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
}

/** Describe an input object field for browse-only explorer nesting. */
export interface SchemaInputFieldNode {
  name: string
  description?: string
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
  typeLabel: string
  required: boolean
  hasDefault: boolean
  inputObject: boolean
  inputFields: SchemaInputFieldNode[]
  isEnum: boolean
  enumValues: SchemaEnumValueNode[]
}

/** Describe a field for the schema explorer tree. */
export interface SchemaFieldNode {
  name: string
  description?: string
  typeLabel: string
  composite: boolean
  argsSummary: string
  args: SchemaArgNode[]
}

export function listFields(
  schema: GraphQLSchema,
  operation: RootOperation,
  parentPath: string[],
): SchemaFieldNode[] {
  const root = rootType(schema, operation)
  if (!root) return []

  let host: CompositeType = root
  for (const segment of parentPath) {
    const field = host.getFields()[segment]
    if (!field) return []
    const next = resolveCompositeType(field.type)
    if (!next) return []
    host = next
  }

  return Object.values(host.getFields()).map((field) => {
    const named = getNamedType(field.type)
    const composite = isObjectType(named) || isInterfaceType(named)
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
      typeLabel: typeLabel(field.type),
      composite,
      argsSummary,
      args: field.args.map((arg) => {
        const named = getNamedType(arg.type)
        const inputObject = isInputObjectType(named)
        const isEnum = isEnumType(named)
        return {
          name: arg.name,
          description: arg.description ?? undefined,
          typeLabel: typeLabel(arg.type),
          required: isNonNullType(arg.type) && arg.defaultValue === undefined,
          hasDefault: arg.defaultValue !== undefined,
          inputObject,
          inputFields: inputObject ? describeInputFields(arg.type) : [],
          isEnum,
          enumValues: isEnum ? describeEnumValues(arg.type) : [],
        }
      }),
    }
  })
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
