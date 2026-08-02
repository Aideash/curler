import http from 'node:http'
import { createHarness, loadModules } from './harness.mjs'
import { performRequest } from '../server/client.mjs'

const { group, expect, detail, summary } = createHarness('compare')

/**
 * Two endpoints standing in for two environments of one API. `/v1` and `/v2`
 * differ in a couple of fields and in key order, which is the shape of the
 * comparison this feature exists for.
 */
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  const json = (body) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }

  if (url.pathname === '/v1/things') return json({ id: 1, name: 'widget' })
  // Deliberately a different key order from v1, plus one extra field.
  if (url.pathname === '/v2/things') return json({ name: 'widget', id: 1, extra: true })

  if (url.pathname === '/boom') {
    response.writeHead(500, { 'Content-Type': 'application/json' })
    response.end('{"error":"nope"}')
    return
  }

  response.writeHead(404, { 'Content-Type': 'text/plain' })
  response.end('not found')
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

/**
 * The lane code reaches the engine through `fetch('/api/send')`, which has no
 * origin to resolve against outside a browser. This stands in for the API
 * server's route, running the same `performRequest` it does, so everything below
 * the stub is the real socket path.
 */
globalThis.fetch = async (path, init) => {
  if (!String(path).endsWith('/api/send')) {
    return { ok: false, json: async () => ({ error: `unexpected call to ${path}` }) }
  }
  const spec = JSON.parse(init.body)
  try {
    return { ok: true, json: async () => await performRequest(spec) }
    // eslint-disable-next-line no-unreachable
  } catch (error) {
    return { ok: true, json: async () => ({ error: error.message }) }
  }
}

const { modules, close } = await loadModules([
  '/src/lib/compare.ts',
  '/src/lib/store.ts',
  '/src/lib/diff.ts',
  '/src/lib/response.ts',
  '/src/types.ts',
])

const {
  compare,
  MAX_LANES,
  addLane,
  removeLane,
  duplicateLane,
  seedLane,
  startComparison,
  ensureLanes,
  laneVariables,
  laneIsStale,
  sendLane,
  sendAll,
  state,
  newRequest,
  uid,
  diffLines,
  normalizeJson,
  prettyBody,
} = modules

const row = (name, value) => ({ id: uid(), name, value, enabled: true })

const lower = { id: 'env-lower', name: 'Lower', variables: [row('BASE_URL', `${base}/v1`)] }
const prod = { id: 'env-prod', name: 'Prod', variables: [row('BASE_URL', `${base}/v2`)] }

function resetWorkspace() {
  state.environments = [lower, prod]
  state.activeEnvironmentId = lower.id
  state.globals = []
  state.builtins = {}
  state.collections = [
    {
      id: 'c1',
      name: 'Service',
      variables: [row('API_KEY', 'collection-key')],
      requests: [newRequest({ id: 'saved-1', name: 'List things', url: '${BASE_URL}/things' })],
    },
  ]
  state.activeRequestId = 'saved-1'
  compare.lanes = []
}

const saved = () => state.collections[0].requests[0]

/* Lane bookkeeping -------------------------------------------------------- */

group('lanes')

resetWorkspace()
startComparison(saved(), 'saved-1')

expect('a comparison opens with two lanes', compare.lanes.length, 2)
expect(
  'labelled A and B',
  compare.lanes.map((lane) => lane.label),
  ['A', 'B'],
)
expect(
  'both seeded from the same request',
  compare.lanes.map((lane) => lane.request.url),
  ['${BASE_URL}/things', '${BASE_URL}/things'],
)
expect(
  'each lane starts on the active environment',
  compare.lanes.every((lane) => lane.environmentId === lower.id),
  true,
)

// The whole reason lanes hold copies: an edit here must not reach the workspace,
// where autosave would write it to disk.
compare.lanes[1].request.url = '${BASE_URL}/somewhere-else'
expect('editing a lane leaves the saved request alone', saved().url, '${BASE_URL}/things')
expect('and does not leak into the other lane', compare.lanes[0].request.url, '${BASE_URL}/things')
expect('lane requests get their own ids', compare.lanes[0].request.id === saved().id, false)

// Headers are the case a shallow copy would get wrong.
compare.lanes[1].request.headers.push(row('X-Lane', 'B'))
expect('header lists are copies too', saved().headers.length, 0)

group('adding and removing')

resetWorkspace()
ensureLanes()
expect('a comparison started from nothing still has two lanes', compare.lanes.length, 2)

removeLane(compare.lanes[0].id)
expect('the last two lanes cannot be removed', compare.lanes.length, 2)

addLane()
addLane()
expect('lanes can be added up to the limit', compare.lanes.length, MAX_LANES)
addLane()
expect('and no further', compare.lanes.length, MAX_LANES)
expect(
  'labels stay positional',
  compare.lanes.map((lane) => lane.label),
  ['A', 'B', 'C', 'D'],
)

removeLane(compare.lanes[1].id)
expect(
  'removing a lane relabels the rest',
  compare.lanes.map((lane) => lane.label),
  ['A', 'B', 'C'],
)

group('seeding and duplicating')

resetWorkspace()
ensureLanes()
seedLane(compare.lanes[0].id, 'saved-1')
expect('a saved request loads into a lane', compare.lanes[0].request.url, '${BASE_URL}/things')
expect('as a copy, not the original', compare.lanes[0].request.id === saved().id, false)
expect('and the lane remembers where it came from', compare.lanes[0].sourceRequestId, 'saved-1')

compare.lanes[0].environmentId = prod.id
duplicateLane(compare.lanes[0].id)
expect('duplicating adds a lane next to it', compare.lanes.length, 3)
expect('carrying the environment over', compare.lanes[1].environmentId, prod.id)
expect('and the request', compare.lanes[1].request.url, '${BASE_URL}/things')
expect('but not the identity', compare.lanes[1].request.id === compare.lanes[0].request.id, false)

group('lane variables')

resetWorkspace()
ensureLanes()
seedLane(compare.lanes[0].id, 'saved-1')
compare.lanes[1].environmentId = prod.id

expect(
  'each lane resolves its own environment',
  [
    laneVariables(compare.lanes[0]).values.BASE_URL,
    laneVariables(compare.lanes[1]).values.BASE_URL,
  ],
  [`${base}/v1`, `${base}/v2`],
)
expect(
  'a seeded lane keeps its collection scope',
  laneVariables(compare.lanes[0]).values.API_KEY,
  'collection-key',
)
expect(
  'a lane seeded from nothing has no collection scope',
  'API_KEY' in laneVariables(compare.lanes[1]).values,
  false,
)
expect(
  'the sidebar selection does not decide a lane environment',
  laneVariables(compare.lanes[1]).values.BASE_URL !==
    laneVariables(compare.lanes[0]).values.BASE_URL,
  true,
)

/* Sending ----------------------------------------------------------------- */

group('sending one lane at a time')

resetWorkspace()
startComparison(saved(), 'saved-1')
compare.lanes[1].environmentId = prod.id

await sendLane(compare.lanes[0].id)

expect('the lane that was sent has a response', compare.lanes[0].outcome?.response?.status, 200)
expect('and the other is untouched', compare.lanes[1].outcome, null)
expect('nothing is left marked in flight', compare.lanes[0].sending, false)

const lowerBody = compare.lanes[0].outcome.response.body
detail('lane A body:', lowerBody)

await sendLane(compare.lanes[1].id)
const prodBody = compare.lanes[1].outcome.response.body
detail('lane B body:', prodBody)

expect('the second lane answers too', compare.lanes[1].outcome?.response?.status, 200)
expect('the first keeps its own response', compare.lanes[0].outcome.response.body, lowerBody)
expect('and the two environments really did produce different bodies', lowerBody !== prodBody, true)

group('independence')

resetWorkspace()
startComparison(saved(), 'saved-1')
compare.lanes[1].request.url = `${base}/boom`

await sendAll()

expect('a good lane is good', compare.lanes[0].outcome?.response?.status, 200)
expect('a failing lane reports its own status', compare.lanes[1].outcome?.response?.status, 500)
expect('and the good lane is not disturbed by it', compare.lanes[0].outcome?.error, null)

// A transport failure, as opposed to an HTTP error status.
resetWorkspace()
startComparison(saved(), 'saved-1')
compare.lanes[1].request.url = 'http://127.0.0.1:1/nothing-listening'
await sendAll()
expect(
  'one lane failing outright leaves the other intact',
  compare.lanes[0].outcome?.response?.status,
  200,
)
expect(
  'and the failure is reported on its own lane',
  Boolean(compare.lanes[1].outcome?.error),
  true,
)
detail('transport error:', compare.lanes[1].outcome?.error)

group('refusing to send')

resetWorkspace()
startComparison(saved(), 'saved-1')
// No environment means ${BASE_URL} resolves to nothing.
compare.lanes[0].environmentId = null

await sendLane(compare.lanes[0].id)
expect('an unresolved variable is refused, not sent', compare.lanes[0].outcome?.response, null)
expect('and says so', compare.lanes[0].outcome?.errorChip, 'Not sent')
expect('naming the variable', compare.lanes[0].outcome?.error?.includes('$BASE_URL'), true)

group('staleness')

resetWorkspace()
startComparison(saved(), 'saved-1')

await sendLane(compare.lanes[0].id)
expect('a lane is not stale the moment it returns', laneIsStale(compare.lanes[0]), false)

compare.lanes[0].request.url = '${BASE_URL}/things?changed=1'
expect('editing the request makes it stale', laneIsStale(compare.lanes[0]), true)
expect('but the response is kept, not cleared', compare.lanes[0].outcome?.response?.status, 200)

compare.lanes[0].request.url = '${BASE_URL}/things'
expect('undoing the edit clears the stale mark', laneIsStale(compare.lanes[0]), false)

compare.lanes[0].environmentId = prod.id
expect('changing environment counts as an edit', laneIsStale(compare.lanes[0]), true)

expect('a lane that never sent is not stale', laneIsStale(compare.lanes[1]), false)

/* The two halves together ------------------------------------------------- */

// The v1-versus-v2 case end to end: two real responses that agree on everything
// but one field, and disagree on key order. Normalising has to leave exactly one
// difference, or the diff is reporting noise.
group('diffing two real responses')

resetWorkspace()
startComparison(saved(), 'saved-1')
compare.lanes[1].environmentId = prod.id
await sendAll()

const [aBody, bBody] = compare.lanes.map((lane) => lane.outcome.response.body)

const normalised = diffLines(normalizeJson(aBody), normalizeJson(bBody))
detail('normalised diff:\n', JSON.stringify(normalised.summary))
expect('normalised, only the new field differs', normalised.summary.added, 1)
expect('and nothing is reported as changed', normalised.summary.changed, 0)
expect('nor removed', normalised.summary.removed, 0)
expect(
  'the added line is the new field',
  normalised.rows.find((row) => row.kind === 'added')?.right?.trim(),
  '"extra": true,',
)

// With the diff off, the view pretty-prints but keeps the server's key order.
// Comparing that way turns the reordering alone into differences, which is the
// noise the Normalise toggle exists to remove.
const unsorted = diffLines(prettyBody(aBody), prettyBody(bBody))
detail('unsorted diff:', JSON.stringify(unsorted.summary))
expect(
  'left unsorted, key order alone reports more differences',
  unsorted.summary.added + unsorted.summary.removed + unsorted.summary.changed >
    normalised.summary.added + normalised.summary.removed + normalised.summary.changed,
  true,
)

const failures = summary()

await close()
server.close()
process.exit(failures === 0 ? 0 : 1)
