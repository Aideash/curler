import {
  getNamedType,
  isEnumType,
  parse,
  TypeInfo,
  visit,
  visitWithTypeInfo,
  type EnumValueNode,
  type GraphQLSchema,
} from 'graphql'

function positionInNode(pos: number, node: { loc?: { start: number; end: number } | null }): boolean {
  if (!node.loc) return false
  return pos >= node.loc.start && pos <= node.loc.end
}

/** Enum choices for the GraphQL value token at `pos`, when schema-aware context is available. */
export function resolveGraphqlEnumChoicesAt(
  doc: string,
  pos: number,
  schema: GraphQLSchema,
): string[] | undefined {
  if (!doc.trim()) return undefined

  let ast
  try {
    ast = parse(doc)
  } catch {
    return undefined
  }

  const typeInfo = new TypeInfo(schema)
  let choices: string[] | undefined

  visit(
    ast,
    visitWithTypeInfo(typeInfo, {
      EnumValue(node: EnumValueNode) {
        if (!positionInNode(pos, node)) return
        const inputType = getNamedType(typeInfo.getInputType())
        if (inputType && isEnumType(inputType)) {
          choices = inputType.getValues().map((value) => value.name)
        }
      },
    }),
  )

  return choices
}

/** Fallback when TypeInfo cannot resolve the enum: unique schema enums containing `value`. */
export function guessGraphqlEnumChoices(schema: GraphQLSchema, value: string): string[] | undefined {
  const needle = value.trim()
  if (!needle) return undefined

  const matches: string[][] = []
  for (const type of Object.values(schema.getTypeMap())) {
    if (!isEnumType(type)) continue
    const names = type.getValues().map((entry) => entry.name)
    if (names.includes(needle)) matches.push(names)
  }

  if (matches.length !== 1) return undefined
  return matches[0]
}
