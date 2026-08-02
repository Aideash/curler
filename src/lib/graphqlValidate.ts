import { GraphQLError, parse, validate, type GraphQLSchema } from 'graphql'

export interface GraphqlValidationError {
  line: number
  col: number
  message: string
}

export interface GraphqlValidationResult {
  valid: boolean
  errors: GraphqlValidationError[]
}

function fromGraphqlError(error: GraphQLError): GraphqlValidationError {
  const loc = error.locations?.[0]
  return {
    line: loc?.line ?? 1,
    col: loc?.column ?? 1,
    message: error.message,
  }
}

function fromUnknown(error: unknown): GraphqlValidationError {
  return {
    line: 1,
    col: 1,
    message: error instanceof Error ? error.message : 'Invalid GraphQL',
  }
}

/** Local syntax check — no schema or network required. */
export function validateSyntax(query: string): GraphqlValidationResult {
  const trimmed = query.trim()
  if (!trimmed) return { valid: true, errors: [] }

  try {
    parse(trimmed)
    return { valid: true, errors: [] }
  } catch (error) {
    if (error instanceof GraphQLError) {
      return { valid: false, errors: [fromGraphqlError(error)] }
    }
    return { valid: false, errors: [fromUnknown(error)] }
  }
}

/** Full validation against a loaded schema. Assumes syntax is parseable. */
export function validateAgainstSchema(
  query: string,
  schema: GraphQLSchema,
): GraphqlValidationResult {
  const syntax = validateSyntax(query)
  if (!syntax.valid) return syntax

  const trimmed = query.trim()
  if (!trimmed) return { valid: true, errors: [] }

  try {
    const document = parse(trimmed)
    const errors = validate(schema, document)
    return {
      valid: errors.length === 0,
      errors: errors.map(fromGraphqlError),
    }
  } catch (error) {
    if (error instanceof GraphQLError) {
      return { valid: false, errors: [fromGraphqlError(error)] }
    }
    return { valid: false, errors: [fromUnknown(error)] }
  }
}

export function firstErrorMessage(result: GraphqlValidationResult): string {
  return result.errors[0]?.message ?? ''
}
