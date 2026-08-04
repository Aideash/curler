import { createHarness, loadModules } from './harness.mjs'

const { modules, close } = await loadModules([
  '/src/lib/vars.ts',
  '/src/lib/curl.ts',
  '/src/lib/graphql.ts',
  '/src/lib/store.ts',
  '/src/types.ts',
])

const {
  resolveRequest,
  requestVariableIssues,
  resolveUrl,
  environmentMap,
  mergeScopes,
  inspect,
  bareReferencedNames,
  braceBareReferences,
  braceRequestReferences,
  traceRequest,
  toCurl,
  variablesForCurlCopy,
  pathVariablesForCurlCopy,
  newRequest,
  uid,
  buildVariableSet,
  buildGraphqlBody,
  parseCurl,
  state,
} = modules
const { group, expect, detail, summary } = createHarness('variables')

function rows(pairs) {
  return pairs.map(([name, value, enabled = true, defined]) => {
    const row = { id: uid(), name, value, enabled }
    if (defined !== undefined) row.defined = defined
    return row
  })
}

function row(name, value, enabled = true, defined) {
  const item = { id: uid(), name, value, enabled }
  if (defined !== undefined) item.defined = defined
  return item
}

function env(pairs) {
  return { id: 'e1', name: 'Local', variables: rows(pairs) }
}

function request(headerValue) {
  return newRequest({
    method: 'GET',
    url: 'https://news-services-d.bindg.com/v1/email-distribution/features',
    headers: [{ id: uid(), name: 'x-api-key', value: headerValue, enabled: true }],
    options: { followRedirects: true, insecure: false, timeoutSecs: 30 },
  })
}

group('resolution')
{
  const map = environmentMap(env([['API_KEY', 'secret-abc']]))
  expect('braced reference', resolveRequest(request('${API_KEY}'), map).headers, [
    ['x-api-key', 'secret-abc'],
  ])
  // Only the braced form is a reference. A bare `$NAME` is literal text, which
  // is what lets a GraphQL query keep its own `$id` variables.
  expect('bare reference is literal', resolveRequest(request('$API_KEY'), map).headers, [
    ['x-api-key', '$API_KEY'],
  ])
  expect(
    'a bare name is never reported as missing',
    resolveRequest(request('$API_KEY'), map).missing,
    [],
  )
}

group('GraphQL body mode')
{
  const map = environmentMap(
    env([
      ['API_KEY', 'secret-abc'],
      ['id', 'nope'],
    ]),
  )
  const gql = newRequest({
    method: 'POST',
    url: 'https://api.example.com/graphql',
    body: {
      mode: 'graphql',
      text: '',
      form: [],
      graphql: {
        query: 'query Hero($id: ID!) { hero(id: $id) { name } }',
        variables: [
          row('role', '"admin"'),
          row('count', '2'),
          row('flag', 'true'),
          row('token', '${API_KEY}'),
          row('label', 'plain'),
        ],
      },
    },
  })

  const resolved = resolveRequest(gql, map)
  const parsed = JSON.parse(resolved.body)
  expect('query keeps literal GraphQL $id', parsed.query.includes('$id'), true)
  expect('a curler variable resolves in the table', parsed.variables.token, 'secret-abc')
  expect('a JSON string stays a string', parsed.variables.role, 'admin')
  expect('a bare number coerces', parsed.variables.count, 2)
  expect('a bare boolean coerces', parsed.variables.flag, true)
  expect('unparseable text becomes a string', parsed.variables.label, 'plain')
  expect('nothing is reported as unresolved', [resolved.missing, resolved.empty], [[], []])

  const shareable = toCurl(gql)
  const roundTrip = parseCurl(shareable).request
  expect('curl import picks GraphQL mode', roundTrip.body.mode, 'graphql')
  expect('the query round-trips', roundTrip.body.graphql.query, gql.body.graphql.query)
  const wire = (model) =>
    JSON.parse(
      buildGraphqlBody(model.body.graphql.query, model.body.graphql.variables, (value) => value) ??
        '{}',
    )
  expect('the payload round-trips on the wire', wire(roundTrip), wire(gql))

  expect(
    'an empty variables table is omitted from the wire JSON',
    buildGraphqlBody('query { ping }', [], (value) => value),
    '{"query":"query { ping }"}',
  )
}

group('literal $ in a body')
{
  const map = environmentMap(env([['id', 'nope']]))
  const query =
    '{"query":"query Hero($id: ID!) {\\n  hero(id: $id) {\\n    name\\n  }\\n}","variables":{"id":"1"}}'
  const graphql = newRequest({
    method: 'POST',
    url: 'https://api.example.com/graphql',
    body: { mode: 'json', text: query, form: [], graphql: { query: '', variables: [] } },
  })

  const resolved = resolveRequest(graphql, map)
  // A variable happening to be named `id` must not reach into the query text.
  expect('the query is sent untouched', resolved.body, query)
  expect('nothing is reported as unresolved', [resolved.missing, resolved.empty], [[], []])

  const shareable = toCurl(graphql)
  expect(
    'the shareable form single-quotes it, so no shell expands $id',
    shareable.includes(`-d '${query}'`),
    true,
  )
  expect('the ready-to-run form keeps it too', toCurl(graphql, map).includes(query), true)

  const mixed = newRequest({
    method: 'POST',
    url: 'https://api.example.com/graphql',
    body: {
      mode: 'json',
      text: '{"token":"${API_KEY}","q":"$id"}',
      form: [],
      graphql: { query: '', variables: [] },
    },
  })
  // A real reference alongside forces double quotes, where the literal `$`
  // has to be escaped or the reader's shell would eat it.
  expect(
    'a literal $ is escaped when a real reference forces double quotes',
    toCurl(mixed).includes('\\"q\\":\\"\\$id\\"'),
    true,
  )
  expect('the real reference stays expandable', toCurl(mixed).includes('$API_KEY'), true)
}

group('bare references are offered as a suggestion')
{
  const map = environmentMap(env([['API_KEY', 'secret-abc']]))
  expect('inspect flags a bare name', inspect('$API_KEY', map), [{ name: 'API_KEY', kind: 'bare' }])
  expect('a braced name alongside is not double-counted', inspect('${API_KEY}', map), [])
  expect('both are reported when both appear', inspect('${MISSING} and $API_KEY', map), [
    { name: 'MISSING', kind: 'missing' },
    { name: 'API_KEY', kind: 'bare' },
  ])
  expect('suggestions can be turned off', inspect('$API_KEY', map, false, false), [])

  expect('the fix braces one name', braceBareReferences('$a/$b', 'a'), '${a}/$b')
  expect('or every name', braceBareReferences('$a/$b'), '${a}/${b}')
  expect('and leaves a braced name alone', braceBareReferences('${a}/$b'), '${a}/${b}')
  expect('bare names are listed', bareReferencedNames('$a/${b}/$c'), ['a', 'c'])
}

group('bringing an older workspace forward')
{
  const older = newRequest({
    url: '$BASE_URL/things/$id',
    headers: [row('x-$part', '$API_KEY'), row('x-braced', '${API_KEY}')],
    variables: [row('API_KEY', 'literal-$dollar')],
    body: {
      mode: 'json',
      text: '{"q":"query Hero($id: ID!)"}',
      form: [],
      graphql: { query: '', variables: [] },
    },
  })
  braceRequestReferences(older)

  expect('the URL is braced', older.url, '${BASE_URL}/things/${id}')
  expect(
    'header names and values are both braced',
    older.headers.map((h) => [h.name, h.value]),
    [
      ['x-${part}', '${API_KEY}'],
      ['x-braced', '${API_KEY}'],
    ],
  )
  // The two places a bare `$` is likely to be meant literally.
  expect('the body is left alone', older.body.text, '{"q":"query Hero($id: ID!)"}')
  expect('and so is a variable definition', older.variables[0].value, 'literal-$dollar')

  const twice = newRequest({ url: '$BASE_URL/me' })
  braceRequestReferences(twice)
  braceRequestReferences(twice)
  expect('running it again changes nothing', twice.url, '${BASE_URL}/me')
}

group('warnings for values that would silently break the request')
{
  const emptyMap = environmentMap(env([['API_KEY', '', true, true]]))
  const resolved = resolveRequest(request('${API_KEY}'), emptyMap)
  expect('empty value is reported', resolved.empty, ['API_KEY'])
  expect('empty value is not reported as missing', resolved.missing, [])
  expect('inspect flags empty', inspect('${API_KEY}', emptyMap), [
    { name: 'API_KEY', kind: 'empty' },
  ])

  const noneMap = environmentMap(env([]))
  expect('undefined is reported', resolveRequest(request('${API_KEY}'), noneMap).missing, [
    'API_KEY',
  ])
  expect('inspect flags missing', inspect('${API_KEY}', noneMap), [
    { name: 'API_KEY', kind: 'missing' },
  ])

  const disabledMap = environmentMap(env([['API_KEY', 'secret-abc', false]]))
  expect(
    'disabled row counts as undefined',
    resolveRequest(request('${API_KEY}'), disabledMap).missing,
    ['API_KEY'],
  )
}

group('copy as curl')
{
  const map = environmentMap(env([['API_KEY', 'secret-abc']]))
  const runnable = toCurl(request('${API_KEY}'), map)
  const shareable = toCurl(request('${API_KEY}'))

  expect('resolved form carries the value', runnable.includes('secret-abc'), true)
  expect('resolved form drops the placeholder', runnable.includes('${API_KEY}'), false)
  expect(
    'resolved form single-quotes, so nothing re-expands',
    runnable.includes("-H 'x-api-key: secret-abc'"),
    true,
  )

  // The shareable form has to survive being pasted into a shell that has
  // API_KEY exported, which single quotes would prevent.
  expect(
    'shareable form double-quotes and expands',
    shareable.includes('-H "x-api-key: $API_KEY"'),
    true,
  )
  expect('shareable form drops the braces', shareable.includes('${API_KEY}'), false)

  const trailing = newRequest({ url: '${BASE_URL}/me' })
  expect(
    'braces dropped when the next character is safe',
    toCurl(trailing).includes('"$BASE_URL/me"'),
    true,
  )

  const glued = newRequest({ url: '${BASE_URL}v1' })
  expect('braces kept when the name would run on', toCurl(glued).includes('"${BASE_URL}v1"'), true)

  detail('runnable output:\n', runnable)
  detail('shareable output:\n', shareable)
}

group('the pre-filled trailing row must not shadow a real value')
{
  // What the editor actually produces: a real API_KEY, then the blank row it
  // appends underneath, carrying the same default name.
  const shadowed = environmentMap(
    env([
      ['API_KEY', 'secret-abc'],
      ['API_KEY', ''],
    ]),
  )
  expect('valued row survives the trailing blank', shadowed, { API_KEY: 'secret-abc' })
  expect('request still resolves', resolveRequest(request('${API_KEY}'), shadowed).headers, [
    ['x-api-key', 'secret-abc'],
  ])

  const reversed = environmentMap(
    env([
      ['API_KEY', ''],
      ['API_KEY', 'secret-abc'],
    ]),
  )
  expect('a later real value wins over an earlier blank', reversed, {
    API_KEY: 'secret-abc',
  })

  expect('a lone blank placeholder is not a definition', environmentMap(env([['API_KEY', '']])), {})
  expect(
    'a committed empty value is still defined',
    environmentMap(env([['API_KEY', '', true, true]])),
    {
      API_KEY: '',
    },
  )
}

group('half-filled rows are not sent')
{
  const map = environmentMap(env([['API_KEY', 'secret-abc']]))

  const missingValue = newRequest({
    url: 'https://example.com',
    headers: [
      { id: uid(), name: 'x-api-key', value: '', enabled: true },
      { id: uid(), name: 'Accept', value: 'application/json', enabled: true },
    ],
  })
  expect('header with no value is dropped', resolveRequest(missingValue, map).headers, [
    ['Accept', 'application/json'],
  ])
  expect(
    'header with no value is left out of curl',
    toCurl(missingValue, map).includes('x-api-key'),
    false,
  )

  const missingName = newRequest({
    url: 'https://example.com',
    headers: [{ id: uid(), name: '', value: 'orphaned', enabled: true }],
  })
  expect('header with no name is dropped', resolveRequest(missingName, map).headers, [])
}

group('scope precedence: narrowest wins')
{
  const scoped = mergeScopes([
    { scope: 'request', rows: rows([['ID', '1']]) },
    {
      scope: 'collection',
      rows: rows([
        ['API_KEY', 'collection-key'],
        ['ID', '2'],
      ]),
    },
    { scope: 'environment', rows: rows([['BASE_URL', 'https://dev.example.com']]) },
    {
      scope: 'global',
      rows: rows([
        ['USER', 'global-user'],
        ['API_KEY', 'global-key'],
      ]),
    },
    { scope: 'builtin', rows: rows([['USER', 'builtin-user']]) },
  ])

  expect('request beats collection', scoped.values.ID, '1')
  expect('collection beats global', scoped.values.API_KEY, 'collection-key')
  expect('global beats builtin', scoped.values.USER, 'global-user')
  expect(
    'a name only the environment defines still resolves',
    scoped.values.BASE_URL,
    'https://dev.example.com',
  )

  expect('origins name the winning scope', scoped.origins, {
    ID: 'request',
    API_KEY: 'collection',
    BASE_URL: 'environment',
    USER: 'global',
  })

  // The editor keeps a blank trailing row in every list, including the
  // narrowest one, and it must not blank out a real value further out.
  const trailing = mergeScopes([
    { scope: 'request', rows: rows([['API_KEY', '']]) },
    { scope: 'global', rows: rows([['API_KEY', 'real-key']]) },
  ])
  expect('a blank narrow row does not shadow a real wide one', trailing.values.API_KEY, 'real-key')
  expect('and the origin follows the value', trailing.origins.API_KEY, 'global')

  const onlyBlank = mergeScopes([{ scope: 'request', rows: rows([['API_KEY', '', true, true]]) }])
  expect('a name defined only blank is still defined', 'API_KEY' in onlyBlank.values, true)
  expect('and keeps the empty value', onlyBlank.values.API_KEY, '')

  const overrideEmpty = mergeScopes([
    { scope: 'request', rows: rows([['API_KEY', '', true, true]]) },
    { scope: 'global', rows: rows([['API_KEY', 'real-key']]) },
  ])
  expect('a committed empty narrow row beats a real wide one', overrideEmpty.values.API_KEY, '')
  expect('and the origin follows the winner', overrideEmpty.origins.API_KEY, 'request')

  const disabled = mergeScopes([
    { scope: 'request', rows: rows([['ID', '1', false]]) },
    { scope: 'global', rows: rows([['ID', '9']]) },
  ])
  expect('a toggled-off row defers to the wider scope', disabled.values.ID, '9')
}

group('path parameters in the url')
{
  const map = { id: '42', BASE_URL: 'https://api.example.com' }

  expect(
    'a path parameter is replaced',
    resolveUrl('${BASE_URL}/things/:id', map).value,
    'https://api.example.com/things/42',
  )
  expect(
    'a query parameter is replaced',
    resolveUrl('https://api.example.com/things?only=:id', map).value,
    'https://api.example.com/things?only=42',
  )
  expect(
    'the scheme separator is left alone',
    resolveUrl('https://api.example.com/x', map).value,
    'https://api.example.com/x',
  )
  expect(
    'a port is left alone',
    resolveUrl('http://localhost:8080/things/:id', map).value,
    'http://localhost:8080/things/42',
  )
  expect(
    'credentials in the authority are left alone',
    resolveUrl('https://admin:hunter2@example.com/x', map).value,
    'https://admin:hunter2@example.com/x',
  )
  expect(
    'an undefined path parameter is reported and left in place',
    resolveUrl('https://example.com/things/:missing', map),
    { value: 'https://example.com/things/:missing', missing: ['missing'], empty: [] },
  )

  // Only the URL gets this treatment; a JSON body is full of colons.
  const body = newRequest({
    url: 'https://example.com/things/:id',
    body: { mode: 'json', text: '{"at":"noon","who":"${USER}"}', form: [] },
  })
  const resolved = resolveRequest(body, { ...map, USER: 'ada' })
  expect('the url expands', resolved.url, 'https://example.com/things/42')
  expect('json keys are not mistaken for parameters', resolved.body, '{"at":"noon","who":"ada"}')

  expect('inspect only looks for them when asked', inspect('/things/:id', {}, false), [])
  expect('inspect finds them in a url', inspect('/things/:id', {}, true), [
    { name: 'id', kind: 'missing' },
  ])
}

group('path parameters survive copy as curl')
{
  const secretId = uid()
  const set = mergeScopes(
    [
      {
        scope: 'environment',
        rows: [
          { id: secretId, name: 'API_KEY', value: '', enabled: true, secret: true },
          row('id', '42'),
        ],
      },
    ],
    { [secretId]: 'secret-abc' },
  )
  const model = newRequest({
    url: 'https://example.com/things/:id',
    headers: [{ id: uid(), name: 'x-api-key', value: '${API_KEY}', enabled: true }],
  })

  const runnable = toCurl(
    model,
    variablesForCurlCopy(set, 'ready'),
    pathVariablesForCurlCopy(set, 'ready'),
  )
  const shareable = toCurl(
    model,
    variablesForCurlCopy(set, 'shareable'),
    pathVariablesForCurlCopy(set, 'shareable'),
  )
  const general = toCurl(
    model,
    variablesForCurlCopy(set, 'general'),
    pathVariablesForCurlCopy(set, 'general'),
  )

  expect('the runnable form expands the path', runnable.includes('/things/42'), true)
  expect('the shareable form also expands the path', shareable.includes('/things/42'), true)
  expect(
    'the shareable form still defers the secret to the shell',
    shareable.includes('-H "x-api-key: $API_KEY"'),
    true,
  )
  expect('the general form keeps the path parameter', general.includes('/things/:id'), true)
  expect(
    'the general form also defers the secret',
    general.includes('-H "x-api-key: $API_KEY"'),
    true,
  )
  detail('shareable output:\n', shareable)
}

group('shareable copy expands public vars only')
{
  const secretId = uid()
  const set = mergeScopes(
    [
      {
        scope: 'environment',
        rows: [
          { id: secretId, name: 'API_KEY', value: '', enabled: true, secret: true },
          row('BASE_URL', 'https://api.example.com'),
        ],
      },
    ],
    { [secretId]: 'secret-abc' },
  )
  const model = newRequest({
    url: '${BASE_URL}/things',
    headers: [{ id: uid(), name: 'x-api-key', value: '${API_KEY}', enabled: true }],
  })

  const shareable = toCurl(
    model,
    variablesForCurlCopy(set, 'shareable'),
    pathVariablesForCurlCopy(set, 'shareable'),
  )
  const general = toCurl(
    model,
    variablesForCurlCopy(set, 'general'),
    pathVariablesForCurlCopy(set, 'general'),
  )
  const ready = toCurl(
    model,
    variablesForCurlCopy(set, 'ready'),
    pathVariablesForCurlCopy(set, 'ready'),
  )

  expect(
    'shareable expands the public url',
    shareable.includes('https://api.example.com/things'),
    true,
  )
  expect('shareable defers the secret', shareable.includes('-H "x-api-key: $API_KEY"'), true)
  expect('shareable does not leak the secret value', shareable.includes('secret-abc'), false)
  expect('general keeps every placeholder', general.includes('"$BASE_URL/things"'), true)
  expect('ready expands everything', ready.includes('secret-abc'), true)
  detail('shareable output:\n', shareable)
}

// -- Build trace ------------------------------------------------------------

group('build trace')

{
  const set = mergeScopes([
    { scope: 'request', rows: [row('TOKEN', 'req-token')] },
    { scope: 'environment', rows: [row('TOKEN', 'env-token'), row('HOST', 'example.com')] },
    { scope: 'global', rows: [row('EMPTY', '', true, true)] },
  ])

  const model = newRequest({
    url: 'https://${HOST}/things/:id',
    headers: [
      { id: uid(), name: 'Authorization', value: 'Bearer ${TOKEN}', enabled: true },
      { id: uid(), name: 'X-Nothing', value: '', enabled: true },
    ],
    body: { mode: 'json', text: '{"who":"${MISSING}","pad":"${EMPTY}"}', form: [] },
  })

  const trace = traceRequest(model, set)
  const byName = Object.fromEntries(trace.variables.map((entry) => [entry.name, entry]))

  expect('the narrowest scope is credited', byName.TOKEN.scope, 'request')
  expect('and its value is the one used', byName.TOKEN.value, 'req-token')
  expect('an environment-only name is credited there', byName.HOST.scope, 'environment')
  expect('a path parameter is traced', byName.id?.scope ?? null, null)
  expect('an undefined name has no scope', byName.MISSING.scope, null)
  expect('an empty global is still credited', byName.EMPTY.scope, 'global')
  expect('and reports its blankness', byName.EMPTY.value, '')

  expect('usage sites are recorded', byName.HOST.usedIn, ['URL'])
  expect('header usage names the header', byName.TOKEN.usedIn, ['header Authorization'])
  expect('body usage is recorded', byName.MISSING.usedIn, ['body'])

  expect('a valueless header is reported as dropped', trace.droppedHeaders, ['X-Nothing'])
  expect('nothing spurious is dropped', trace.droppedFields, [])
}

// -- Scoped resolution against a chosen environment -------------------------

// This is what a comparison lane relies on: the same request resolved against
// an environment other than the active one, without the sidebar's selection
// getting a say.
group('buildVariableSet')

{
  state.globals = rows([
    ['SHARED', 'from-globals'],
    ['BASE_URL', 'http://global'],
  ])
  state.builtins = { USER: 'someone' }

  const lower = env([['BASE_URL', 'http://lower.test']])
  const prod = { id: 'e2', name: 'Prod', variables: rows([['BASE_URL', 'https://prod.test']]) }
  const collection = {
    id: 'c1',
    name: 'Service',
    requests: [],
    variables: rows([['API_KEY', 'collection-key']]),
  }
  const model = newRequest({ url: '${BASE_URL}/things' })

  const lowerSet = buildVariableSet(model, collection, lower)
  const prodSet = buildVariableSet(model, collection, prod)

  expect('the chosen environment answers', lowerSet.values.BASE_URL, 'http://lower.test')
  expect('a different one answers differently', prodSet.values.BASE_URL, 'https://prod.test')
  expect('and the environment beats globals', prodSet.origins.BASE_URL, 'environment')

  expect('collection scope still applies', prodSet.values.API_KEY, 'collection-key')
  expect('globals still apply', prodSet.values.SHARED, 'from-globals')
  expect('built-ins still apply', prodSet.values.USER, 'someone')

  expect(
    'the same request resolves to two different URLs',
    [resolveRequest(model, lowerSet.values).url, resolveRequest(model, prodSet.values).url],
    ['http://lower.test/things', 'https://prod.test/things'],
  )

  // A lane seeded from an unsaved request has no collection behind it, and must
  // not inherit one by accident.
  const orphan = buildVariableSet(model, null, prod)
  expect('no collection means no collection-scoped values', 'API_KEY' in orphan.values, false)

  // Request scope is still narrowest, whichever environment is in play.
  const overridden = newRequest({
    url: '${BASE_URL}/things',
    variables: rows([['BASE_URL', 'http://request']]),
  })
  expect(
    'a request-level value overrides the chosen environment',
    buildVariableSet(overridden, collection, prod).values.BASE_URL,
    'http://request',
  )

  state.globals = []
  state.builtins = {}
}

group('request readiness for an environment')

{
  const ready = newRequest({
    url: '${BASE_URL}/ping',
    headers: [{ id: uid(), name: 'x-api-key', value: '${API_KEY}', enabled: true }],
  })
  const configured = environmentMap(
    env([
      ['BASE_URL', 'https://api.test'],
      ['API_KEY', 'secret'],
    ]),
  )
  expect('all referenced vars resolve', requestVariableIssues(ready, configured), [])

  const sparse = environmentMap(env([['BASE_URL', 'https://api.test']]))
  expect(
    'a missing referenced var is reported',
    requestVariableIssues(ready, sparse).map((issue) => issue.name),
    ['API_KEY'],
  )

  const blank = environmentMap(
    env([
      ['BASE_URL', 'https://api.test'],
      ['API_KEY', '', true, true],
    ]),
  )
  expect(
    'an empty referenced var is reported',
    requestVariableIssues(ready, blank).map((issue) => issue.kind),
    ['empty'],
  )

  const literal = newRequest({ url: 'https://api.test/ping' })
  expect('no references means ready', requestVariableIssues(literal, {}), [])
}

const failures = summary()

await close()
process.exit(failures === 0 ? 0 : 1)
