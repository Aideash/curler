import { createHarness, loadModules } from './harness.mjs'

const h = createHarness('terminal flags')
const { modules, close } = await loadModules([
  '/src/lib/terminalFlags.ts',
  '/src/lib/curl.ts',
  '/src/types.ts',
])

const {
  TERMINAL_FLAGS,
  blockedBy,
  ineffective,
  isActive,
  terminalFlagArgs,
  parseCurl,
  toCurl,
  newRequest,
} = modules

// -- Catalogue consistency --------------------------------------------------

h.group('catalogue')

const ids = new Set(TERMINAL_FLAGS.map((flag) => flag.id))
h.expect('ids are unique', ids.size, TERMINAL_FLAGS.length)

for (const flag of TERMINAL_FLAGS) {
  for (const other of flag.conflicts ?? []) {
    const partner = TERMINAL_FLAGS.find((candidate) => candidate.id === other)
    if (!partner) {
      h.fail(`${flag.id} conflicts with unknown "${other}"`)
      continue
    }
    // A one-sided conflict would let you reach the forbidden pair by ticking
    // the boxes in the other order, which defeats the whole point.
    if (partner.conflicts?.includes(flag.id)) h.pass(`${flag.id} <-> ${other} is mutual`)
    else h.fail(`${other} does not list ${flag.id} as a conflict`)
  }
  for (const other of flag.requires ?? []) {
    if (ids.has(other)) h.pass(`${flag.id} requires a known flag`)
    else h.fail(`${flag.id} requires unknown "${other}"`)
  }
}

// -- Conflicts are unreachable ---------------------------------------------

h.group('conflicts')

h.expect('silent blocks the progress bar', blockedBy({ silent: true }, 'progressBar'), ['silent'])
h.expect('the progress bar blocks silent', blockedBy({ progressBar: true }, 'silent'), ['progressBar'])
h.expect('silent is free when nothing else is on', blockedBy({}, 'silent'), [])
h.expect('fail blocks fail-with-body', blockedBy({ fail: true }, 'failWithBody'), ['fail'])
h.expect('ipv4 blocks ipv6', blockedBy({ ipv4: true }, 'ipv6'), ['ipv4'])
h.expect('-o blocks -O', blockedBy({ output: 'out.json' }, 'remoteName'), ['output'])
h.expect(
  'a blank -o blocks nothing',
  blockedBy({ output: '   ' }, 'remoteName'),
  [],
)

h.expect('show-error alone is inert', ineffective({ showError: true }, 'showError'), ['silent'])
h.expect(
  'show-error with silent is fine',
  ineffective({ showError: true, silent: true }, 'showError'),
  [],
)

// -- Active state -----------------------------------------------------------

h.group('active state')

h.expect('a true boolean is active', isActive({ silent: true }, 'silent'), true)
h.expect('a false boolean is not', isActive({ silent: false }, 'silent'), false)
h.expect('an absent flag is not', isActive({}, 'silent'), false)
h.expect('a valued flag needs text', isActive({ retry: '' }, 'retry'), false)
h.expect('a valued flag with text is active', isActive({ retry: '3' }, 'retry'), true)
h.expect('whitespace is not text', isActive({ retry: '  ' }, 'retry'), false)

h.expect(
  'args come out in catalogue order',
  terminalFlagArgs({ retry: '3', silent: true }),
  [{ flag: '--silent' }, { flag: '--retry', value: '3' }],
)

// -- Round trip through curl ------------------------------------------------

h.group('curl output')

const request = newRequest({ url: 'https://example.test/v1/thing' })
request.terminalFlags = { silent: true, showError: true, writeOut: '%{http_code}' }

const command = toCurl(request)
h.expect('silent appears', command.includes('--silent'), true)
h.expect('show-error appears', command.includes('--show-error'), true)
h.expect('write-out keeps its format quoted', command.includes(`-w '%{http_code}'`) || command.includes(`--write-out '%{http_code}'`), true)

const bare = newRequest({ url: 'https://example.test/' })
h.expect('no flags means no trimmings', toCurl(bare).includes('--silent'), false)

h.group('curl import')

const imported = parseCurl(`curl -s -o out.json --retry 3 https://example.test/v1/thing`)
h.expect('silent survives import', imported.request.terminalFlags.silent, true)
h.expect('-o keeps its filename', imported.request.terminalFlags.output, 'out.json')
h.expect('--retry keeps its count', imported.request.terminalFlags.retry, '3')
h.expect('no spurious warnings', imported.warnings, [])
h.expect(
  'the URL is not mistaken for a flag value',
  imported.request.url,
  'https://example.test/v1/thing',
)

const contradictory = parseCurl('curl -# -s https://example.test/')
h.expect('the later flag wins', contradictory.request.terminalFlags.silent, true)
h.expect(
  'the earlier conflicting flag is dropped',
  contradictory.request.terminalFlags.progressBar,
  undefined,
)

const roundTripped = parseCurl(toCurl(imported.request))
h.expect(
  'flags survive a round trip',
  roundTripped.request.terminalFlags,
  imported.request.terminalFlags,
)

await close()
process.exit(h.summary() === 0 ? 0 : 1)
