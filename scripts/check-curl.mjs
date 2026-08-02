import { createHarness, loadModules } from './harness.mjs'

const { modules, close } = await loadModules(['/src/lib/curl.ts', '/src/lib/graphql.ts'])
const { parseCurl, toCurl } = modules
const { buildGraphqlBody } = modules
const { group, detail, expect, pass, fail, summary } = createHarness('curl round-trip')

/**
 * A case is `[label, command]`, optionally followed by fields of the imported
 * request to assert on. Every case is also checked for round-trip stability.
 */
const cases = [
  ['basic GET', `curl https://api.example.com/v1/things`],
  [
    'multiline POST with JSON',
    `curl -X POST 'https://api.example.com/v1/things' \\
  -H 'Content-Type: application/json' \\
  -H "x-api-key: $API_KEY" \\
  -d '{"name":"widget","tags":["a","b"]}'`,
  ],
  [
    'clustered short flags, attached values, repeated -d',
    `curl -sSL -XPUT -H'Accept: application/json' https://api.example.com/v1/things/7 -d 'a=1' -d 'b=2'`,
  ],
  [
    'implicit POST from data, basic auth, insecure',
    `curl -k -u admin:hunter2 --data-raw 'hello=world' https://localhost:8443/login`,
  ],
  [
    '--get promotes data to query string',
    `curl -G --data-urlencode 'q=hello world' https://api.example.com/search`,
  ],
  [
    'braced variable and max-time',
    `curl -m 5 -H 'Authorization: Bearer \${TOKEN}' \${BASE_URL}/me`,
  ],
  ['HEAD via -I with --compressed', `curl -I --compressed https://example.com`],
  ['form fields', `curl -F 'file=@x' -F 'name=bob' https://api.example.com/upload`],
  [
    // What a browser puts on the clipboard for a GraphQL request: ANSI-C
    // quoting, reached for because of the `!`, with every backslash in the
    // payload doubled to survive it.
    'ANSI-C quoted GraphQL body',
    String.raw`curl 'https://api.example.com/graphql' \
  -H 'content-type: application/json' \
  --data-raw $'{"operationName":"Hero","query":"mutation Hero {\\n  rename(name: \\"Ada!\\")\\n}","variables":{}}'`,
    {
      method: 'POST',
      bodyMode: 'graphql',
      body: 'mutation Hero {\n  rename(name: "Ada!")\n}',
    },
  ],
  [
    // The escaped quote is what makes this form dangerous to guess at: read as
    // ordinary quoting it closes the string and splits the word in two.
    'ANSI-C escapes: quote, newline, tab, hex, octal, unicode',
    String.raw`curl 'https://api.example.com/echo' --data-raw $'it\'s\there\n\x41\101\u00e9 \\n'`,
    { bodyMode: 'text', body: "it's\there\nAAé " + String.raw`\n` },
  ],
  [
    'ANSI-C quoting used for the URL and a header',
    String.raw`curl $'https://api.example.com/v1/things' -H $'x-note: a\tb'`,
    { url: 'https://api.example.com/v1/things', headers: 'x-note: a\tb' },
  ],
  [
    // The whole reason `${NAME}` is the only reference syntax: a GraphQL query
    // declares `$id` itself, and no shell would have expanded it from inside
    // these quotes either.
    'GraphQL variables in the query survive as literal text',
    String.raw`curl 'https://api.example.com/graphql' \
  -H 'content-type: application/json' \
  --data-raw $'{"query":"query Hero($id: ID!) {\\n  hero(id: $id) {\\n    name\\n  }\\n}","variables":{"id":"1"}}'`,
    {
      bodyMode: 'graphql',
      body: 'query Hero($id: ID!) {\n  hero(id: $id) {\n    name\n  }\n}',
      graphqlVariables: [['id', '1']],
    },
  ],
  [
    'a single-quoted $ is literal, an expandable one is not',
    `curl 'https://api.example.com/graphql' -d '{"q":"$id"}' -H "x-api-key: $API_KEY"`,
    {
      body: '{"q":"$id"}',
      headers: 'x-api-key: ${API_KEY} | Content-Type: application/json',
    },
  ],
  [
    'locale-translation quoting is read as an ordinary double-quoted string',
    String.raw`curl $"https://api.example.com/v1/things" -d $"{\"a\":\"b\\nc\"}"`,
    { url: 'https://api.example.com/v1/things', body: String.raw`{"a":"b\nc"}` },
  ],
]

for (const [label, input, wanted] of cases) {
  const { request, warnings } = parseCurl(input)
  const headers = request.headers
    .filter((h) => h.name)
    .map((h) => `${h.name}: ${h.value}`)
    .join(' | ')

  group(label)
  detail(`method   ${request.method}`)
  detail(`url      ${request.url}`)
  detail(`headers  ${headers || '(none)'}`)
  detail(
    `body     [${request.body.mode}] ${
      request.body.mode === 'graphql' ? request.body.graphql.query : request.body.text || '(empty)'
    }`,
  )
  if (request.options.insecure) detail('insecure true')
  if (warnings.length) detail(`warnings ${warnings.join('; ')}`)

  if (wanted?.method !== undefined) expect('method', request.method, wanted.method)
  if (wanted?.url !== undefined) expect('url', request.url, wanted.url)
  if (wanted?.headers !== undefined) expect('headers', headers, wanted.headers)
  if (wanted?.bodyMode !== undefined) expect('body mode', request.body.mode, wanted.bodyMode)
  if (wanted?.body !== undefined) {
    const got = request.body.mode === 'graphql' ? request.body.graphql.query : request.body.text
    expect('body', got, wanted.body)
  }
  if (wanted?.graphqlVariables !== undefined) {
    const got = request.body.graphql.variables
      .filter((row) => row.enabled && row.name.trim())
      .map((row) => [row.name, row.value])
    expect('graphql variables', got, wanted.graphqlVariables)
  }

  // Form bodies are exported as a URL-encoded -d payload, so compare what
  // actually goes over the wire rather than the editor representation.
  const wireBody = (model) => {
    if (model.body.mode === 'form') {
      return model.body.form
        .filter((field) => field.enabled && field.name.trim())
        .map((field) => `${encodeURIComponent(field.name)}=${encodeURIComponent(field.value)}`)
        .join('&')
    }
    if (model.body.mode === 'graphql') {
      return (
        buildGraphqlBody(
          model.body.graphql.query,
          model.body.graphql.variables,
          (value) => value,
        ) ?? ''
      )
    }
    return model.body.text
  }

  const roundTrip = parseCurl(toCurl(request)).request
  const stable =
    roundTrip.method === request.method &&
    roundTrip.url === request.url &&
    wireBody(roundTrip) === wireBody(request)
  if (stable) {
    pass('round-trips unchanged')
  } else {
    fail(
      'round-trip mismatch',
      `got    ${roundTrip.method} ${roundTrip.url} ${wireBody(roundTrip)}`,
      `wanted ${request.method} ${request.url} ${wireBody(request)}`,
    )
  }
}

const failures = summary()

await close()
process.exit(failures === 0 ? 0 : 1)
