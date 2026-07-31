import os from 'node:os'
import path from 'node:path'
import { createHarness } from './harness.mjs'
import {
  DEFAULT_API_PORT,
  DEFAULT_UI_PORT,
  resolvePorts,
  resolveWorkspaceHome,
} from '../config.mjs'

const h = createHarness('config')

const rejects = (env) => {
  try {
    resolvePorts(env)
    return null
  } catch (error) {
    return error.message
  }
}

// -- Ports ------------------------------------------------------------------

h.group('ports')

h.expect('an empty environment uses the defaults', resolvePorts({}), {
  api: DEFAULT_API_PORT,
  ui: DEFAULT_UI_PORT,
})
h.expect('the defaults are the documented ones', [DEFAULT_API_PORT, DEFAULT_UI_PORT], [5174, 5173])

h.expect('API_PORT is honoured', resolvePorts({ API_PORT: '9000' }).api, 9000)
h.expect('UI_PORT is honoured', resolvePorts({ UI_PORT: '9001' }).ui, 9001)
h.expect(
  'each port is independent',
  resolvePorts({ API_PORT: '9000' }).ui,
  DEFAULT_UI_PORT,
)
h.expect('surrounding whitespace is tolerated', resolvePorts({ API_PORT: ' 9000 ' }).api, 9000)
h.expect('a blank value falls back', resolvePorts({ API_PORT: '   ' }).api, DEFAULT_API_PORT)

h.group('PORT compatibility')

h.expect('the older PORT spelling still works', resolvePorts({ PORT: '9002' }).api, 9002)
h.expect(
  'API_PORT wins when both are set',
  resolvePorts({ API_PORT: '9000', PORT: '9002' }).api,
  9000,
)
h.expect('PORT does not affect the UI', resolvePorts({ PORT: '9002' }).ui, DEFAULT_UI_PORT)

// -- Bad values fail loudly -------------------------------------------------

h.group('bad values')

// Number('5174;') is NaN, and listening on NaN binds a random port instead of
// failing, so this has to be an error rather than a shrug.
const semicolon = rejects({ API_PORT: '5174;' })
h.expect('a trailing semicolon is rejected', semicolon !== null, true)
h.expect('and the message names the variable', /API_PORT/.test(semicolon ?? ''), true)
h.expect('and shows the offending value', /5174;/.test(semicolon ?? ''), true)
h.expect('and says what to fix', /semicolon/i.test(semicolon ?? ''), true)

h.expect('quotes are rejected', rejects({ UI_PORT: '"5173"' }) !== null, true)
h.expect('words are rejected', rejects({ API_PORT: 'yes' }) !== null, true)
h.expect('fractions are rejected', rejects({ API_PORT: '80.5' }) !== null, true)
h.expect('zero is rejected', rejects({ API_PORT: '0' }) !== null, true)
h.expect('negatives are rejected', rejects({ API_PORT: '-1' }) !== null, true)
h.expect('out of range is rejected', rejects({ API_PORT: '70000' }) !== null, true)
h.expect('the top of the range is allowed', resolvePorts({ API_PORT: '65535' }).api, 65535)
h.expect('the bottom of the range is allowed', resolvePorts({ API_PORT: '1' }).api, 1)

// -- Workspace home ---------------------------------------------------------

h.group('workspace home')

h.expect(
  'the default sits in the home directory',
  resolveWorkspaceHome({}),
  path.join(os.homedir(), '.curler'),
)
h.expect(
  'CURLER_HOME overrides it',
  resolveWorkspaceHome({ CURLER_HOME: '/tmp/somewhere' }),
  '/tmp/somewhere',
)
h.expect(
  'a leading tilde is expanded, since no shell has seen the .env',
  resolveWorkspaceHome({ CURLER_HOME: '~/.curler-agent' }),
  path.join(os.homedir(), '.curler-agent'),
)
h.expect(
  'a relative path is made absolute',
  path.isAbsolute(resolveWorkspaceHome({ CURLER_HOME: './scratch' })),
  true,
)
h.expect(
  'whitespace only falls back to the default',
  resolveWorkspaceHome({ CURLER_HOME: '  ' }),
  path.join(os.homedir(), '.curler'),
)

process.exit(h.summary() === 0 ? 0 : 1)
