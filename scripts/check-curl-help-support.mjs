import { createHarness, loadModules } from './harness.mjs'

const { modules, close } = await loadModules([
  '/src/lib/curlHelpData.ts',
  '/src/lib/curlOptionSupport.ts',
  '/src/lib/terminalFlags.ts',
])
const { CURL_HELP_PAGES } = modules
const { curlOptionTier } = modules
const { TERMINAL_FLAGS } = modules
const { group, expect, pass, summary } = createHarness('curl help support tiers')

/** Spot-check tiers against flags we know the importer handles. */
const spotChecks = [
  [{ short: '-d,', long: '--data <data>', description: '' }, 'send'],
  [{ short: '-u,', long: '--user <user:password>', description: '' }, 'send'],
  [{ short: '-L,', long: '--location', description: '' }, 'send'],
  [{ short: '-s,', long: '--silent', description: '' }, 'copy'],
  [{ short: '-o,', long: '--output <file>', description: '' }, 'copy'],
  [{ short: '-i,', long: '--include', description: '' }, 'copy'],
  [{ long: '--compressed', description: '' }, 'ignored'],
  [{ long: '--ntlm', description: '' }, 'none'],
] 

group('spot checks')
for (const [option, tier] of spotChecks) {
  expect(`${option.long || option.short} → ${tier}`, curlOptionTier(option), tier)
}

group('terminal flags are copy tier')
for (const flag of TERMINAL_FLAGS) {
  const long = { long: flag.flag, description: '' }
  expect(flag.flag, curlOptionTier(long), 'copy')
  if (flag.short) {
    const short = { short: `${flag.short},`, long: flag.flag, description: '' }
    expect(flag.short, curlOptionTier(short), 'copy')
  }
}

group('main help page')
const main = CURL_HELP_PAGES['']
let sendCount = 0
let copyCount = 0
for (const option of main.options ?? []) {
  const tier = curlOptionTier(option)
  if (tier === 'send') sendCount += 1
  if (tier === 'copy') copyCount += 1
}
if (sendCount >= 3) pass(`marks ${sendCount} send flags on the main page`)
else expect('send flags on main page', sendCount >= 3, true)
if (copyCount >= 4) pass(`marks ${copyCount} copy flags on the main page`)
else expect('copy flags on main page', copyCount >= 4, true)

const failures = summary()
await close()
process.exit(failures === 0 ? 0 : 1)
