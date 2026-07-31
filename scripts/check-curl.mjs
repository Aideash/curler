import { createHarness, loadModules } from './harness.mjs'

const { modules, close } = await loadModules(['/src/lib/curl.ts'])
const { parseCurl, toCurl } = modules
const { group, detail, pass, fail, summary } = createHarness('curl round-trip')

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
  ['--get promotes data to query string', `curl -G --data-urlencode 'q=hello world' https://api.example.com/search`],
  ['braced variable and max-time', `curl -m 5 -H 'Authorization: Bearer \${TOKEN}' \${BASE_URL}/me`],
  ['HEAD via -I with --compressed', `curl -I --compressed https://example.com`],
  ['form fields', `curl -F 'file=@x' -F 'name=bob' https://api.example.com/upload`],
]

for (const [label, input] of cases) {
  const { request, warnings } = parseCurl(input)
  const headers = request.headers
    .filter((h) => h.name)
    .map((h) => `${h.name}: ${h.value}`)
    .join(' | ')

  group(label)
  detail(`method   ${request.method}`)
  detail(`url      ${request.url}`)
  detail(`headers  ${headers || '(none)'}`)
  detail(`body     [${request.body.mode}] ${request.body.text || '(empty)'}`)
  if (request.options.insecure) detail('insecure true')
  if (warnings.length) detail(`warnings ${warnings.join('; ')}`)

  // Form bodies are exported as a URL-encoded -d payload, so compare what
  // actually goes over the wire rather than the editor representation.
  const wireBody = (model) =>
    model.body.mode === 'form'
      ? model.body.form
          .filter((field) => field.enabled && field.name.trim())
          .map((field) => `${encodeURIComponent(field.name)}=${encodeURIComponent(field.value)}`)
          .join('&')
      : model.body.text

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
