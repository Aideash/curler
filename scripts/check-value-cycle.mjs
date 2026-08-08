import { createHarness, loadModules } from './harness.mjs'

const { modules, close } = await loadModules([
  '/src/lib/valueCycle.ts',
  '/src/lib/graphqlValueCycle.ts',
])

const { cycleScalarValue, normalizeEnumSelection } = modules
const { resolveGraphqlEnumChoicesAt, guessGraphqlEnumChoices } = modules
const {
  GraphQLSchema,
  GraphQLEnumType,
  GraphQLObjectType,
  GraphQLString,
  GraphQLNonNull,
} = await import('graphql')
const { group, expect, summary } = createHarness('value cycle')

group('boolean')
{
  expect('true flips forward', cycleScalarValue('true', 'next'), 'false')
  expect('true flips backward', cycleScalarValue('true', 'prev'), 'false')
  expect('FALSE flips', cycleScalarValue('FALSE', 'next'), 'true')
  expect('True flips', cycleScalarValue('True', 'prev'), 'false')
}

group('integer')
{
  expect('zero increments', cycleScalarValue('0', 'next'), '1')
  expect('one decrements', cycleScalarValue('1', 'prev'), '0')
  expect('negative increments', cycleScalarValue('-3', 'next'), '-2')
  expect('negative decrements', cycleScalarValue('-3', 'prev'), '-4')
}

group('enum')
{
  const choices = ['DRAFT', 'PUBLISHED', 'ARCHIVED']

  expect('empty lands on first forward', cycleScalarValue('', 'next', { enumChoices: choices }), '"DRAFT"')
  expect('empty lands on last backward', cycleScalarValue('', 'prev', { enumChoices: choices }), '"ARCHIVED"')
  expect('quoted enum advances', cycleScalarValue('"DRAFT"', 'next', { enumChoices: choices }), '"PUBLISHED"')
  expect('bare enum wraps backward', cycleScalarValue('DRAFT', 'prev', { enumChoices: choices }), '"ARCHIVED"')
  expect('last wraps forward', cycleScalarValue('"ARCHIVED"', 'next', { enumChoices: choices }), '"DRAFT"')
  expect('null encodes empty', cycleScalarValue('"DRAFT"', 'prev', { enumChoices: choices }), '"ARCHIVED"')
}

group('normalizeEnumSelection')
{
  expect('json string', normalizeEnumSelection('"ACTIVE"'), 'ACTIVE')
  expect('bare name', normalizeEnumSelection('ACTIVE'), 'ACTIVE')
  expect('empty', normalizeEnumSelection(''), '')
}

group('non-cyclable')
{
  expect('plain text', cycleScalarValue('hello', 'next'), null)
  expect('float', cycleScalarValue('3.14', 'next'), null)
  expect('empty without enum', cycleScalarValue('', 'next'), null)
  expect('enum wins over bool when choices include true', cycleScalarValue('true', 'next', { enumChoices: ['true', 'false'] }), '"false"')
}

group('plain format')
{
  expect('enum stays unquoted', cycleScalarValue('DRAFT', 'next', { enumChoices: ['DRAFT', 'LIVE'], format: 'plain' }), 'LIVE')
}

group('graphql enum resolution')
{
  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      fields: {
        item: {
          type: GraphQLString,
          args: {
            status: {
              type: new GraphQLNonNull(
                new GraphQLEnumType({
                  name: 'Status',
                  values: { DRAFT: { value: 'DRAFT' }, LIVE: { value: 'LIVE' } },
                }),
              ),
            },
          },
        },
      },
    }),
  })

  const query = 'query { item(status: DRAFT) { id } }'
  const pos = query.indexOf('DRAFT')
  expect(
    'TypeInfo resolves argument enum',
    resolveGraphqlEnumChoicesAt(query, pos, schema),
    ['DRAFT', 'LIVE'],
  )
  expect('guess when value is unique', guessGraphqlEnumChoices(schema, 'DRAFT'), ['DRAFT', 'LIVE'])
}

await close()
summary()
