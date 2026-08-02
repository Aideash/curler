import {
  Kind,
  getNamedType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  parse,
  print,
  type DocumentNode,
  type FieldNode,
  type GraphQLField,
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

export interface FieldClickTarget {
  operation: RootOperation
  /** Field names from the root type down to the parent of the clicked field. */
  parentPath: string[]
  fieldName: string
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

function defaultVariableCell(type: GraphQLInputType): string {
  const named = getNamedType(type)
  if (isInputObjectType(named)) return '{}'
  if (named.name === 'String' || named.name === 'ID') return '""'
  if (named.name === 'Int' || named.name === 'Float') return '0'
  if (named.name === 'Boolean') return 'false'
  return 'null'
}

function needsSelectionSet(type: GraphQLType): boolean {
  const named = getNamedType(type)
  return isObjectType(named) || isInterfaceType(named)
}

function buildFieldMeta(
  field: GraphQLField<unknown, unknown>,
  variableNames: Set<string>,
  variables: KeyValue[],
): FieldBuildMeta {
  const args: Array<NonNullable<FieldNode['arguments']>[number]> = []
  const variableDefinitions: VariableDefinitionNode[] = []

  for (const arg of field.args) {
    const hasDefault = arg.defaultValue !== undefined
    const required = isNonNullType(arg.type) && !hasDefault
    if (!required) {
      if (hasDefault) {
        const value = defaultValueNode(arg.defaultValue)
        if (value) {
          args.push({
            kind: Kind.ARGUMENT,
            name: { kind: Kind.NAME, value: arg.name },
            value,
          })
        }
      }
      continue
    }

    const varName = uniqueVarName(arg.name, variableNames)
    variableDefinitions.push({
      kind: Kind.VARIABLE_DEFINITION,
      variable: { kind: Kind.VARIABLE, name: { kind: Kind.NAME, value: varName } },
      type: inputTypeToTypeNode(arg.type),
    })
    args.push({
      kind: Kind.ARGUMENT,
      name: { kind: Kind.NAME, value: arg.name },
      value: { kind: Kind.VARIABLE, name: { kind: Kind.NAME, value: varName } },
    })

    if (!variables.some((row) => row.name === varName)) {
      variables.push({
        id: uid(),
        name: varName,
        value: defaultVariableCell(arg.type),
        enabled: true,
      })
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
      const variables: KeyValue[] = []
      const built = buildFieldMeta(fieldDef, variableNames, variables)
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

/**
 * Inserts a field from the schema explorer into the query, creating parent
 * fields and variable definitions as needed.
 */
export function insertField(
  graphql: GraphqlBody,
  schema: GraphQLSchema,
  target: FieldClickTarget,
): InsertFieldResult {
  const variables = cloneVariables(graphql.variables)
  const doc = parseMutable(graphql.query, target.operation)
  const op = ensureOperation(doc, target.operation)

  const root = rootType(schema, target.operation)
  if (!root) throw new Error(`Schema has no ${target.operation} root type`)

  let fieldHost: CompositeType = root
  for (const segment of target.parentPath) {
    const fieldDef = fieldHost.getFields()[segment]
    if (!fieldDef) throw new Error(`Unknown field "${segment}"`)
    const next = resolveCompositeType(fieldDef.type)
    if (!next) throw new Error(`"${segment}" is not an object type`)
    fieldHost = next
  }

  const fieldDef = fieldHost.getFields()[target.fieldName]
  if (!fieldDef) throw new Error(`Unknown field "${target.fieldName}"`)

  const selectionSet = findSelectionSet(op, schema, target.operation, target.parentPath)

  const already = selectionSet.selections.some(
    (sel) => sel.kind === Kind.FIELD && sel.name.value === target.fieldName,
  )
  if (already) return { query: print(doc), variables }

  const variableNames = collectVariableNames(doc)
  const built = buildFieldMeta(fieldDef, variableNames, variables)
  selectionSet.selections.push(built.node as MutableFieldNode)
  mergeVariableDefinitions(op, built.variableDefinitions)

  return { query: print(doc), variables }
}

/** Describe a field for the schema explorer tree. */
export interface SchemaFieldNode {
  name: string
  description?: string
  typeLabel: string
  composite: boolean
  argsSummary: string
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
